import type { EndCondition } from './end-condition'
import type { LiveEvent } from './live-events'
import { buildPersonaSystemPrompt } from './persona-engine'
import { mapWithConcurrency } from './concurrency'
import type { RunSessionInput, SessionResult, SessionRunnerDeps } from './session-runner'
import type { Persona } from '../types'

export interface OrchestrateRunDeps {
  runId: string
  personas: Persona[]
  repetitions: number
  concurrency: number
  cond: EndCondition
  taGender: 1 | 2                                   // from run row, never hardcoded
  replayFromRunId?: string                           // optional replay source
  // returns scripted user turns for (personaId, repetitionIndex); undefined = normal generation
  scriptedTurnsFor?: (personaId: string, repetitionIndex: number) => string[] | undefined
  newToken: (taGender: 1 | 2) => Promise<{ token: string; uid: number; memoryId: number }>
  makeSessionDeps: (sessionId: string) => SessionRunnerDeps
  runSession: (deps: SessionRunnerDeps, input: RunSessionInput) => Promise<SessionResult>
  onRunUpdate: (patch: { status?: string; summaryJson?: string; startedAt?: Date; finishedAt?: Date }) => void | Promise<void>
  emit: (e: LiveEvent) => void
  newId: () => string
  now?: () => number
  isManualStop?: () => boolean   // 用户手动终止 → 最终状态记为 'stopped'（已终止）而非 finished/failed
}

// Only sessionCount is persisted here; turn-weighted avgScore and violations
// are authoritative from GET /api/runs/:id/metrics and GET /api/runs/:id/violations.
export interface RunSummary {
  sessionCount: number
  errorSample?: string   // 首个会话错误信息，run 失败时透传给前端展示
}

export async function orchestrateRun(deps: OrchestrateRunDeps): Promise<RunSummary> {
  const now = deps.now ?? (() => Date.now())
  deps.onRunUpdate({ status: 'running', startedAt: new Date(now()) })

  // Expand personas × repetitions into a flat job list with repetitionIndex (used by replay)
  const jobs: { persona: Persona; repetitionIndex: number }[] = []
  for (const p of deps.personas) {
    for (let r = 0; r < deps.repetitions; r++) {
      jobs.push({ persona: p, repetitionIndex: r }) // per-persona 0-based index for (personaId,repetitionIndex) replay keying
    }
  }

  let successCount = 0
  let errorSample: string | undefined

  await mapWithConcurrency(jobs, deps.concurrency, async (job) => {
    const sessionId = deps.newId()
    try {
      console.log(`[orchestrator] session start ${sessionId.slice(-8)} persona=${job.persona.name} rep=${job.repetitionIndex}`)
      const { token, uid, memoryId } = await deps.newToken(deps.taGender)
      const sdeps = deps.makeSessionDeps(sessionId)
      const result = await deps.runSession(sdeps, {
        sessionId,
        persona: job.persona,
        token,
        cond: deps.cond,
        personaSummary: buildPersonaSystemPrompt(job.persona).slice(0, 120),
        sessionMeta: { targetToken: token, targetUid: uid, targetMemoryId: memoryId, repetitionIndex: job.repetitionIndex },
        scriptedUserTurns: deps.scriptedTurnsFor?.(job.persona.id, job.repetitionIndex),
      })
      // 被测后端持续不可用（target_fatal_error）时会话正常返回，但不能算成功，否则整个 run 会被记成 finished
      if (result.endReason !== 'target_fatal_error') successCount++
      else if (!errorSample) errorSample = '被测后端连续多轮请求失败（target_fatal_error），请检查被测后端地址与 Debug Key'
      console.log(`[orchestrator] session done ${sessionId.slice(-8)} reason=${result.endReason} turns=${result.turnCount}`)
      return result
    } catch (err) {
      // absorb per-session errors — other sessions continue.
      // console.error is intentional: this runs in background (no req context), so Fastify req.log is unavailable.
      if (!errorSample) errorSample = String(err)
      console.error('[orchestrator] session error', { sessionId, error: String(err) })
      return null
    }
  })

  const allFailed = successCount === 0 && jobs.length > 0
  // avgScore and violations are authoritative from /metrics and /violations endpoints
  const summary: RunSummary = { sessionCount: jobs.length, ...(errorSample ? { errorSample } : {}) }

  // 用户手动终止优先记为 'stopped'（已终止）；否则按是否全失败记 failed/finished。
  const finalStatus = deps.isManualStop?.() ? 'stopped' : (allFailed ? 'failed' : 'finished')
  await deps.onRunUpdate({
    status: finalStatus,
    finishedAt: new Date(now()),
    summaryJson: JSON.stringify(summary),
  })

  return summary
}
