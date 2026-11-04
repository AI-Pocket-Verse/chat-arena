import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PrismaClient } from '../../generated/prisma'
import { createTargetClient } from '../clients/target-client'
import { buildModelRegistry, createModelClient } from '../clients/model-client'
import { createJudgeEngine } from '../engine/judge-engine'
import { createPersonaEngine } from '../engine/persona-engine'
import { orchestrateRun } from '../engine/run-orchestrator'
import { runSession, type SavedTurn, type SessionMeta, type SessionResult, type SessionRunnerDeps } from '../engine/session-runner'
import { liveBus } from '../live/live-bus'
import { env } from '../env'
import type { Persona } from '../types'
import { stopRegistry } from '../engine/stop-registry'
import { parseLang } from '../i18n'

const RecallVerdict = z.object({ recalled: z.boolean() })

// zod schema for persona structuredJson — validates based on shared PersonaStructured fields
const PersonaStructuredSchema = z.object({
  age: z.number().optional(),
  gender: z.string().optional(),
  hometown: z.string().optional(),
  occupation: z.string().optional(),
  personality: z.string().optional(),
  speakingStyle: z.string().optional(),
  intent: z.string().optional(),
  maxChars: z.number().optional(),
  innerOS: z.boolean().optional(),
  avatar: z.string().optional(),
}).passthrough()  // allow unknown keys without failing

function rowToPersona(row: { id: string; name: string; category: string; structuredJson: string; systemPrompt: string; redteamTacticsJson: string | null; injectedFactsJson: string | null; recallProbesJson: string | null }): Persona {
  // validate structuredJson via zod instead of bare cast
  let rawStructured: unknown
  try {
    rawStructured = JSON.parse(row.structuredJson)
  } catch (e) {
    throw new Error(`Persona id="${row.id}": structuredJson is not valid JSON — ${String(e)}`)
  }
  const structuredResult = PersonaStructuredSchema.safeParse(rawStructured)
  if (!structuredResult.success) {
    throw new Error(`Persona id="${row.id}": structuredJson failed validation — ${structuredResult.error.message}`)
  }

  return {
    id: row.id, name: row.name,
    category: row.category === 'redteam' ? 'redteam' : 'normal',
    structured: structuredResult.data,
    systemPrompt: row.systemPrompt,
    redteamTactics: row.redteamTacticsJson ? (JSON.parse(row.redteamTacticsJson) as string[]) : undefined,
    injectedFacts: row.injectedFactsJson ? JSON.parse(row.injectedFactsJson) : undefined,
    recallProbes: row.recallProbesJson ? JSON.parse(row.recallProbesJson) : undefined,
  }
}

export function makeStartRun(prisma: PrismaClient) {
  return async function startRun(runId: string): Promise<void> {
    // ensure stopRegistry is always cleared, even if setup throws before the inner try
    try {
      const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } })
      const personaIds = JSON.parse(run.personaSetJson) as string[]
      const rows = await prisma.persona.findMany({ where: { id: { in: personaIds } } })
      const personas = rows.map(rowToPersona)

      console.log(`[run] start ${runId.slice(-8)} userModel=${run.userModel} judgeModel=${run.judgeModel} personas=${personas.length} rep=${run.repetitions} conc=${run.concurrency}`)
      // 评测语言：模拟用户台词、裁判点评跟随发起评测时的界面语言，并以 Accept-Language 告诉被测后端
      const lang = parseLang(run.lang)
      const target = createTargetClient({ baseUrl: run.targetBaseUrl, debugKey: env.TARGET_DEBUG_KEY, headers: env.TARGET_HEADERS, lang })
      const model = createModelClient(buildModelRegistry(process.env))
      const personaEngine = createPersonaEngine(model, run.userModel, undefined, lang)
      const judge = createJudgeEngine(model, run.judgeModel, lang)

      // saveTurn with retry on SQLITE_BUSY / SQLITE_LOCKED
      const saveTurn = async (t: SavedTurn) => {
        const score = t.score
        const maxAttempts = 3
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            await prisma.$transaction(async (tx) => {
              await tx.turn.create({
                data: {
                  id: t.id, sessionId: t.sessionId, idx: t.idx,
                  userText: t.userText, targetText: t.targetText,
                  targetMessageId: t.targetMessageId, targetSessionId: t.targetSessionId,
                  firstTokenMs: t.firstTokenMs ?? undefined,
                  totalMs: t.totalMs, errorType: t.errorType ?? undefined,
                  replyLen: t.replyLen, rawMetaJson: t.rawMetaJson, createdAt: new Date(),
                },
              })
              if (score) {
                await tx.turnScore.create({
                  data: {
                    turnId: t.id, dimsJson: score.dims ? JSON.stringify(score.dims) : '{}',
                    overall: score.overall ?? 0, comment: score.comment ?? '',
                    improvementSuggestion: score.improvementSuggestion ?? '',
                    violation: score.violation,
                    memoryHit: score.memoryHit ?? undefined,
                    judgeError: score.judgeError,
                  },
                })
              }
            })
            return  // success
          } catch (err) {
            const errMsg = String(err).toLowerCase()
            const isBusy = errMsg.includes('sqlite_busy') || errMsg.includes('sqlite_locked') || errMsg.includes('database is locked')
            if (isBusy && attempt < maxAttempts) {
              // exponential backoff: 50ms, 150ms
              await new Promise(resolve => setTimeout(resolve, 50 * attempt))
              continue
            }
            // final failure or non-busy error — log with context and rethrow
            console.error(`[chat-arena] saveTurn failed (sessionId=${t.sessionId} idx=${t.idx} attempt=${attempt}):`, err)
            throw err
          }
        }
      }

      // ensureSession creates the DB row before any turns
      const ensureSession = async (sessionId: string, personaId: string, meta: SessionMeta) => {
        await prisma.session.create({
          data: {
            id: sessionId, runId, personaId,
            targetUid: meta.targetUid, targetMemoryId: meta.targetMemoryId,
            // targetRoleId = taGender (gender 1→roleId 1, gender 2→roleId 2)
            targetRoleId: meta.targetRoleId ?? run.taGender,
            targetToken: meta.targetToken,
            repetitionIndex: meta.repetitionIndex,
            status: 'running', createdAt: new Date(),
          },
        })
      }

      // finalizeSession writes end state
      const finalizeSession = async (result: SessionResult) => {
        await prisma.session.update({
          where: { id: result.sessionId },
          data: {
            status: result.endReason === 'target_fatal_error' || result.endReason === 'session_error' ? 'failed' : 'finished',
            endReason: result.endReason, turnCount: result.turnCount,
            avgScore: result.avgScore, finishedAt: new Date(),
          },
        })
      }

      const saveMemoryCheck = async (data: Parameters<SessionRunnerDeps['saveMemoryCheck'] & {}>[0]) => {
        await prisma.memoryCheck.create({ data })
      }

      // 记忆命中：子串未命中时让裁判模型判断同义改写（如「喜欢吃辣」vs「你爱吃辣」）
      const judgeRecall: SessionRunnerDeps['judgeRecall'] = async ({ factValue, reply }) => {
        try {
        const out = await model.chatJson(run.judgeModel, [
          { role: 'system', content: '判断「回复」是否表达了与「事实」相同的含义（允许同义改写、人称变化；只是相关或模糊提及不算）。只输出 JSON：{"recalled": true|false}' },
          { role: 'user', content: JSON.stringify({ 事实: factValue, 回复: reply }) },
        ], RecallVerdict, { temperature: 0 })
        return out.recalled
        } catch (err) {
          // 裁判不可用时退回子串判定的结果（未命中），不让记忆考核拖垮整个会话
          console.warn('[chat-arena] judgeRecall failed, treat as not recalled:', err instanceof Error ? err.message : String(err))
          return false
        }
      }

      const makeSessionDeps = (sessionId: string): SessionRunnerDeps => ({
        runId, target, persona: personaEngine, judge, now: () => Date.now(),
        emit: (e) => liveBus.emit(runId, e),
        saveTurn, ensureSession, finalizeSession, saveMemoryCheck, judgeRecall,
        isManualStop: () => stopRegistry.isStopped(runId),
      })

      // build scripted-turns map when replayFromRunId is set
      let scriptedTurnsFor: ((personaId: string, repetitionIndex: number) => string[] | undefined) | undefined
      if (run.replayFromRunId) {
        const sourceSessions = await prisma.session.findMany({
          where: { runId: run.replayFromRunId },
          include: { turns: { orderBy: { idx: 'asc' } } },
        })
        const replayMap = new Map<string, string[]>()
        for (const s of sourceSessions) {
          const key = `${s.personaId}#${s.repetitionIndex ?? 0}`
          replayMap.set(key, s.turns.map(t => t.userText))
        }
        scriptedTurnsFor = (personaId, repetitionIndex) => replayMap.get(`${personaId}#${repetitionIndex}`)
      }

      await orchestrateRun({
        runId, personas,
        repetitions: run.repetitions,
        concurrency: run.concurrency,
        taGender: run.taGender as 1 | 2,
        cond: JSON.parse(run.endConditionJson) as { maxTurns?: number; maxDurationSec?: number },
        replayFromRunId: run.replayFromRunId ?? undefined,
        scriptedTurnsFor,
        newToken: (g) => target.generateDebugToken({ taGender: g }),
        makeSessionDeps,
        runSession,
        onRunUpdate: (patch) => prisma.run.update({ where: { id: runId }, data: patch }).then(() => {}).catch((err: unknown) => {
          console.error(`[chat-arena] onRunUpdate failed for run ${runId}:`, err)
        }),
        emit: (e) => liveBus.emit(runId, e),
        newId: () => randomUUID(),
        isManualStop: () => stopRegistry.isStopped(runId),  // 终止 → 状态记为 'stopped'
      })
    } catch (err) {
      // mark run failed on any unrecoverable error，并把原因写进 summary 供前端展示
      await prisma.run.update({
        where: { id: runId },
        data: { status: 'failed', finishedAt: new Date(), summaryJson: JSON.stringify({ sessionCount: 0, errorSample: String(err) }) },
      }).catch(() => {})
      throw err
    } finally {
      // always clear stop registry regardless of success/failure/early throw
      stopRegistry.clear(runId)
    }
  }
}
