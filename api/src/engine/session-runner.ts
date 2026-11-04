import { randomUUID } from 'node:crypto'
import type { TargetChatResult, Dialogue, Persona, RecallProbe } from '../types'
import { shouldEnd, type EndCondition, type EndReason } from './end-condition'
import type { JudgeEngine, JudgeResult } from './judge-engine'
import type { LiveEvent } from './live-events'
import type { PersonaEngine } from './persona-engine'

export interface SessionMeta {
  targetUid?: number
  targetMemoryId?: number
  targetRoleId?: number
  targetToken?: string
  repetitionIndex?: number
}

export interface MemoryCheckData {
  id: string
  sessionId: string
  factKey: string
  factValue: string
  injectTurn: number
  probeTurn: number
  injected: boolean
  recalled: boolean
  evidenceText?: string | null
}

export interface SessionRunnerDeps {
  runId: string
  target: { chat: (token: string, content: string, cmid: string, opts?: { onDelta?: (t: string) => void }) => Promise<TargetChatResult> }
  persona: PersonaEngine
  judge: JudgeEngine
  now: () => number
  emit: (e: LiveEvent) => void
  saveTurn: (t: SavedTurn) => Promise<void>
  ensureSession: (sessionId: string, personaId: string, meta: SessionMeta) => Promise<void>
  finalizeSession: (result: SessionResult) => Promise<void>
  retryDelayMs?: (attempt: number) => number
  maxRetries?: number
  isManualStop?: () => boolean
  saveMemoryCheck?: (data: MemoryCheckData) => Promise<void>
  judgeRecall?: (input: { factValue: string; reply: string }) => Promise<boolean>
}

export interface SavedTurn {
  id: string
  sessionId: string
  idx: number
  userText: string
  targetText: string
  targetMessageId?: number
  targetSessionId?: string
  firstTokenMs: number | null
  totalMs: number
  errorType: string | null
  replyLen: number
  rawMetaJson: string
  score?: {
    dims: JudgeResult['dims'] | null
    overall: number | null
    comment: string | null
    improvementSuggestion: string | null
    violation: boolean
    memoryHit: boolean | null
    judgeError?: string
  }
}

export interface RunSessionInput {
  sessionId: string
  persona: Persona
  token: string
  cond: EndCondition
  personaSummary: string
  sessionMeta: SessionMeta
  // no 'watched' boolean — live-bus decides per-connection
  // replay mode — reuse source-run user turns verbatim
  scriptedUserTurns?: string[]
}

export interface SessionResult {
  sessionId: string
  endReason: EndReason
  turnCount: number
  avgScore: number | null
}

async function chatWithRetry(
  deps: SessionRunnerDeps,
  input: RunSessionInput,
  userText: string,
  idx: number,
): Promise<TargetChatResult> {
  const maxRetries = Math.max(0, deps.maxRetries ?? 2)
  const delay = deps.retryDelayMs ?? ((a: number) => 500 * 2 ** a)
  let last: TargetChatResult | null = null
  let anyDelta = false
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 重试前通知实时页清掉上一次尝试推送的半截文本
    if (attempt > 0 && anyDelta) {
      deps.emit({ type: 'turn.target.reset', runId: deps.runId, sessionId: input.sessionId, idx })
      anyDelta = false
    }
    let deltaEmitted = false
    const startMs = deps.now()
    // Bug 2 fix: wrap target.chat in try/catch so thrown exceptions (fetch reject /
    // SSE disconnect) are converted to structured errors instead of bubbling out
    // of runSession and bypassing the MAX_CONSECUTIVE_TARGET_ERRORS guard.
    let r: TargetChatResult
    try {
      r = await deps.target.chat(input.token, userText, randomUUID(), {
        onDelta: (d) => {
          deltaEmitted = true
          anyDelta = true
          deps.emit({ type: 'turn.target.delta', runId: deps.runId, sessionId: input.sessionId, idx, deltaText: d })
        },
      })
    } catch (err) {
      const totalMs = deps.now() - startMs
      r = {
        text: '',
        firstTokenMs: null,
        totalMs,
        done: false,
        error: { errorType: 'network_disconnect', message: String(err), retryable: true },
        meta: {},
      }
    }
    last = r
    if (!r.error) {
      // always emit at least one delta (non-streaming fallback)
      if (!deltaEmitted && r.text) {
        deps.emit({ type: 'turn.target.delta', runId: deps.runId, sessionId: input.sessionId, idx, deltaText: r.text })
      }
      return r
    }
    if (!r.error.retryable) return r
    await new Promise(res => setTimeout(res, delay(attempt)))
  }
  return last as TargetChatResult
}

// 连续这么多轮 target 都失败才放弃整局（疑似 target/网络持续不可用）；
// 单次/偶发错误不再直接 target_fatal_error，让会话继续跑到设定的结束条件（轮数/时长）。
const MAX_CONSECUTIVE_TARGET_ERRORS = 5

export async function runSession(deps: SessionRunnerDeps, input: RunSessionInput): Promise<SessionResult> {
  const start = deps.now()

  // create session row before any turns (FK dependency)
  await deps.ensureSession(input.sessionId, input.persona.id, input.sessionMeta)
  deps.emit({ type: 'session.started', runId: deps.runId, sessionId: input.sessionId, personaId: input.persona.id })

  const history: Dialogue[] = []
  const overalls: number[] = []
  let idx = 0
  let consecutiveTargetErrors = 0

  // Bug 1 fix: maintain injection confirmation per fact key across turns.
  // injectAtTurn/probeAtTurn are 1-based turn numbers (see Bug 5a).
  // injectedConfirmed maps factKey → true when that fact was actually spoken.
  const injectedConfirmed = new Map<string, boolean>()

  // Bug 5b fix (non-replay only): carry-over probe when it lands on an error/
  // empty-reply turn so it gets a chance to be checked on the next good turn.
  let pendingProbe: RecallProbe | null = null

  const finish = async (reason: EndReason): Promise<SessionResult> => {
    const result: SessionResult = {
      sessionId: input.sessionId,
      endReason: reason,
      turnCount: idx,
      avgScore: overalls.length ? overalls.reduce((a, b) => a + b, 0) / overalls.length : null,
    }
    deps.emit({ type: 'session.ended', runId: deps.runId, sessionId: input.sessionId, endReason: reason, turnCount: idx, avgScore: result.avgScore })
    await deps.finalizeSession(result)
    return result
  }

  try {
  for (;;) {
    const endReason = shouldEnd({
      turnCount: idx,
      elapsedSec: (deps.now() - start) / 1000,
      manualStop: deps.isManualStop?.() ?? false,
      fatal: false,
      cond: input.cond,
    })
    if (endReason) return finish(endReason)

    // inject fact or probe as extraInstruction (non-replay only).
    // Bug 5a fix: injectAtTurn / probeAtTurn are 1-based turn numbers;
    // idx is 0-based, so match with idx + 1.
    const injectFact = input.persona.injectedFacts?.find(f => f.injectAtTurn === idx + 1)

    // Bug 5b fix: carry-over probe from a previous failed turn (non-replay only),
    // or find the probe scheduled for this turn (1-based matching).
    const probeFact: RecallProbe | null = !input.scriptedUserTurns
      ? (pendingProbe ?? input.persona.recallProbes?.find(p => p.probeAtTurn === idx + 1) ?? null)
      : (input.persona.recallProbes?.find(p => p.probeAtTurn === idx + 1) ?? null)

    let userText: string
    if (input.scriptedUserTurns) {
      // replay mode — reuse source-run user turn verbatim
      if (idx < input.scriptedUserTurns.length) {
        userText = input.scriptedUserTurns[idx]!
      } else {
        // source run had fewer turns — end session cleanly
        return finish('max_turns')
      }
    } else {
      const extraInstruction = injectFact
        ? `自然地提到：${injectFact.key}是${injectFact.value}`
        : probeFact
          ? `自然地问对方：${probeFact.question}`
          : undefined
      userText = await deps.persona.nextUserMessage(input.persona, history, extraInstruction)
      // 模拟用户模型偶尔返回空串（如推理类模型 content 为 null）：重试一次，仍为空则让会话失败，
      // 不能把空消息发给被测后端，否则责任会算到被测方头上。
      if (userText.trim() === '') userText = await deps.persona.nextUserMessage(input.persona, history, extraInstruction)
      if (userText.trim() === '') throw new Error('模拟用户模型连续两次返回空消息')
    }

    // Bug 3a fix: check manual stop AFTER persona generates the user message but
    // BEFORE emitting or pushing it. The user message is discarded (not pushed to
    // history, not emitted) so the session ends cleanly.
    if (deps.isManualStop?.()) return finish('manual_stop')

    history.push({ role: 'persona', text: userText })
    deps.emit({ type: 'turn.user', runId: deps.runId, sessionId: input.sessionId, idx, text: userText })

    // track whether fact was actually spoken by the persona.
    // Bug 1 fix: store confirmation in the outer Map keyed by factKey so probe
    // turns (which come later) can read it correctly.
    // Bug 1 replay fix: in replay mode, use isInjected on the scripted text too.
    if (injectFact) {
      const { isInjected } = await import('./memory-checker')
      const confirmed = isInjected(injectFact.value, userText)
      injectedConfirmed.set(injectFact.key, confirmed)
    }

    // always emit delta — onDelta is wired unconditionally in chatWithRetry
    const reply = await chatWithRetry(deps, input, userText, idx)
    deps.emit({ type: 'turn.target.done', runId: deps.runId, sessionId: input.sessionId, idx, fullText: reply.text, firstTokenMs: reply.firstTokenMs, totalMs: reply.totalMs })

    // Bug 3b fix: check manual stop AFTER target reply is complete but BEFORE
    // calling the judge. Save the turn with hard metrics (no score) then finish.
    if (deps.isManualStop?.()) {
      if (!reply.error && reply.text.trim() !== '') {
        history.push({ role: 'target', text: reply.text })
      }
      await deps.saveTurn(buildSavedTurn(input.sessionId, idx, userText, reply, null, undefined, null))
      return finish('manual_stop')
    }

    // 单轮 target 错误：记录该轮、继续下一轮（不再直接终止整局），让会话跑到设定的结束条件。
    // 仅当【连续】多轮失败才放弃。错误轮不写入对话历史，避免污染后续上下文。
    if (reply.error) {
      // Bug 4 fix: pop the persona entry we just pushed so history only contains
      // complete exchanges (matching the "error turns don't write target line" intent).
      history.pop()
      await deps.saveTurn(buildSavedTurn(input.sessionId, idx, userText, reply, null, reply.error.errorType))
      deps.emit({ type: 'turn.score', runId: deps.runId, sessionId: input.sessionId, idx, dims: null, overall: null, comment: null, suggestion: null, memoryHit: null, violation: false, judgeError: reply.error.errorType })
      // Bug 5b fix: carry over any pending probe to the next turn (non-replay only).
      if (!input.scriptedUserTurns && probeFact) {
        pendingProbe = probeFact
      }
      idx++
      consecutiveTargetErrors++
      if (consecutiveTargetErrors >= MAX_CONSECUTIVE_TARGET_ERRORS) return finish('target_fatal_error')
      continue
    }
    consecutiveTargetErrors = 0
    history.push({ role: 'target', text: reply.text })

    // check recall on probe turns
    let memoryHit: boolean | null = null
    if (probeFact) {
      const injectedFact = input.persona.injectedFacts?.find(f => f.key === probeFact.factKey)
      const expectedValue = injectedFact?.value ?? probeFact.factKey // fallback: key string
      const { checkRecall } = await import('./memory-checker')
      const result = await checkRecall({ factValue: expectedValue, reply: reply.text }, deps.judgeRecall)
      memoryHit = result.recalled
      if (deps.saveMemoryCheck) {
        // Bug 1 fix: read injection confirmation from the outer Map by factKey
        // (not the per-turn local variable that was always false on probe turns).
        const wasInjected = injectedConfirmed.get(probeFact.factKey) ?? false
        await deps.saveMemoryCheck({
          id: randomUUID(),
          sessionId: input.sessionId,
          factKey: probeFact.factKey,
          factValue: expectedValue,
          injectTurn: injectedFact?.injectAtTurn ?? -1,
          probeTurn: probeFact.probeAtTurn,
          injected: wasInjected,
          recalled: result.recalled,
          evidenceText: result.evidence ?? null,
        }).catch(() => { /* memory_check persistence is best-effort */ })
      }
      // Bug 5b fix: probe was successfully processed — clear the carry-over.
      if (!input.scriptedUserTurns) {
        pendingProbe = null
      }
    }

    // empty reply → skip judge, record with judgeError, exclude from scoring
    if (reply.text.trim() === '') {
      // Bug 5b fix: carry over probe on empty-reply turns too (non-replay only).
      if (!input.scriptedUserTurns && probeFact && memoryHit === null) {
        pendingProbe = probeFact
      }
      deps.emit({
        type: 'turn.score',
        runId: deps.runId,
        sessionId: input.sessionId,
        idx,
        dims: null,
        overall: null,
        comment: null,
        suggestion: null,
        memoryHit,
        violation: false,
        judgeError: 'empty_reply',
      })
      await deps.saveTurn(buildSavedTurn(input.sessionId, idx, userText, reply, null, 'empty_reply', memoryHit))
      idx++
      continue
    }

    // judge failure → null judge, hard metrics still saved
    const { judge: judgeResult, judgeError } = await deps.judge.judgeTurn({
      personaSummary: input.personaSummary,
      userText,
      targetText: reply.text,
      recentHistory: history.slice(-6),
      timing: { firstTokenMs: reply.firstTokenMs, totalMs: reply.totalMs, errorType: null, replyText: reply.text },
      redteam: input.persona.category === 'redteam',
    })

    // only accumulate overall when judge succeeded
    if (judgeResult) overalls.push(judgeResult.overall)

    deps.emit({
      type: 'turn.score',
      runId: deps.runId,
      sessionId: input.sessionId,
      idx,
      dims: judgeResult?.dims ?? null,
      overall: judgeResult?.overall ?? null,
      comment: judgeResult?.comment ?? null,
      suggestion: judgeResult?.improvementSuggestion ?? null,
      memoryHit,
      violation: judgeResult?.violation ?? false,
      judgeError,
    })

    await deps.saveTurn(buildSavedTurn(input.sessionId, idx, userText, reply, judgeResult, judgeError, memoryHit))
    idx++
  }
  } catch (err) {
    // 模拟用户模型 / 落库等抛错：先把会话落成失败终态并通知前端，再抛给 orchestrator 记录原因，
    // 否则会话会一直停在 running。
    await finish('session_error').catch((e) => console.error('[session] finalize after error failed', e))
    throw err
  }
}

// target_message_id 列是 Prisma Int（32 位）。很多后端用时间戳或雪花算法生成 64 位消息 id，
// 直接写入会让整轮保存失败、会话中断；超出范围时只留在 rawMetaJson 里（该列只做记录，没有读取方）。
function fitsInt32(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= -2_147_483_648 && v <= 2_147_483_647
}

function buildSavedTurn(
  sessionId: string,
  idx: number,
  userText: string,
  reply: TargetChatResult,
  judge?: JudgeResult | null,
  judgeError?: string,
  memoryHit: boolean | null = null,
): SavedTurn {
  return {
    id: randomUUID(),
    sessionId,
    idx,
    userText,
    targetText: reply.text,
    targetMessageId: fitsInt32(reply.meta.messageId) ? reply.meta.messageId : undefined,
    targetSessionId: typeof reply.meta.sessionId === 'string' ? reply.meta.sessionId : undefined,
    firstTokenMs: reply.firstTokenMs,
    totalMs: reply.totalMs,
    errorType: reply.error?.errorType ?? null,
    replyLen: [...reply.text].length,
    rawMetaJson: JSON.stringify(reply.meta),
    score: {
      dims: judge?.dims ?? null,
      overall: judge?.overall ?? null,
      comment: judge?.comment ?? null,
      improvementSuggestion: judge?.improvementSuggestion ?? null,
      violation: judge?.violation ?? false,
      memoryHit,
      judgeError,
    },
  }
}
