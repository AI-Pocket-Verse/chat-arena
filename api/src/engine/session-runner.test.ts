import { describe, expect, it, vi } from 'vitest'
import type { LiveEvent } from './live-events'
import { runSession } from './session-runner'

const persona = { id: 'p1', name: '小明', category: 'normal' as const, structured: {}, systemPrompt: 'x' }

function makeDeps(overrides: Record<string, unknown> = {}) {
  const events: LiveEvent[] = []
  const saved: unknown[] = []
  const ensureSession = vi.fn(async () => {})
  const finalizeSession = vi.fn(async () => {})
  const base = {
    runId: 'run1',
    target: {
      chat: vi.fn(async () => ({
        text: '在的', firstTokenMs: 100, totalMs: 400, done: true, error: null,
        meta: { messageId: 1, sessionId: 's9' },
      })),
    },
    persona: { nextUserMessage: vi.fn(async () => '在吗') },
    judge: {
      judgeTurn: vi.fn(async () => ({
        hard: { firstTokenMs: 100, totalMs: 400, hasError: false, replyLen: 2 },
        judge: { dims: { personaFit: 4, empathy: 4, memoryAccuracy: 4, safety: 5, naturalness: 4, relevance: 4 }, overall: 4.0, comment: 'ok', improvementSuggestion: 's', violation: false },
        judgeError: undefined,
      })),
    },
    now: (() => { let t = 0; return () => (t += 1000) })(),
    emit: (e: LiveEvent) => events.push(e),
    saveTurn: vi.fn(async (t: unknown) => saved.push(t)),
    ensureSession,
    finalizeSession,
    retryDelayMs: () => 0,
    ...overrides,
  }
  return { args: base as any, events, saved, ensureSession, finalizeSession }
}

const sessionInput = {
  sessionId: 's1', persona, token: 'jwt',
  cond: { maxTurns: 2 }, personaSummary: '小明',
  sessionMeta: {},
}

describe('runSession', () => {
  it('runs maxTurns, ensureSession once, finalizeSession once, computes avgScore', async () => {
    const { args, events, ensureSession, finalizeSession } = makeDeps()
    const res = await runSession(args, sessionInput)
    expect(args.persona.nextUserMessage).toHaveBeenCalledTimes(2)
    expect(args.target.chat).toHaveBeenCalledTimes(2)
    expect(ensureSession).toHaveBeenCalledTimes(1)
    expect(finalizeSession).toHaveBeenCalledTimes(1)
    expect(res.endReason).toBe('max_turns')
    expect(res.avgScore).toBeCloseTo(4.0)
    expect(events.map(e => e.type)).toContain('turn.score')
    expect(events.at(-1)?.type).toBe('session.ended')
  })

  it('a 64-bit message_id from the backend does not break saving: column left empty, raw meta keeps it', async () => {
    const chat = vi.fn(async () => ({ text: '在的', firstTokenMs: 100, totalMs: 400, done: true, error: null, meta: { messageId: 1793777001705, sessionId: 's9' } }))
    const { args, saved } = makeDeps({ target: { chat } })
    await runSession(args, { ...sessionInput, cond: { maxTurns: 1 } })
    const turn = saved[0] as { targetMessageId?: number; rawMetaJson: string }
    expect(turn.targetMessageId).toBeUndefined()
    expect(JSON.parse(turn.rawMetaJson).messageId).toBe(1793777001705)
  })

  it('always emits turn.target.delta (no watched gate)', async () => {
    const { args, events } = makeDeps()
    await runSession(args, { ...sessionInput, cond: { maxTurns: 1 } })
    // delta events should be emitted regardless (live-bus filters by watch)
    expect(events.some(e => e.type === 'turn.target.delta')).toBe(true)
  })

  it('retries retryable target error then continues', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: '', firstTokenMs: null, totalMs: 10, done: true, error: { errorType: 'timeout', message: 'x', retryable: true }, meta: {} })
      .mockResolvedValue({ text: '在的', firstTokenMs: 100, totalMs: 400, done: true, error: null, meta: {} })
    const { args } = makeDeps({ target: { chat } })
    const res = await runSession(args, { ...sessionInput, cond: { maxTurns: 1 } })
    expect(chat).toHaveBeenCalledTimes(2)
    expect(res.endReason).toBe('max_turns')
  })

  it('stops on non-retryable target error and finalizes', async () => {
    const chat = vi.fn(async () => ({ text: '', firstTokenMs: null, totalMs: 10, done: true, error: { errorType: 'param_error', message: 'x', retryable: false }, meta: {} }))
    const { args, finalizeSession } = makeDeps({ target: { chat } })
    const res = await runSession(args, { ...sessionInput, cond: { maxTurns: 5 } })
    expect(res.endReason).toBe('target_fatal_error')
    expect(finalizeSession).toHaveBeenCalledTimes(1)
  })

  // [HIGH fix] exhausted retryable errors also terminate the session
  it('ends with target_fatal_error when retryable error persists through all retries', async () => {
    const chat = vi.fn(async () => ({ text: '', firstTokenMs: null, totalMs: 10, done: true, error: { errorType: 'timeout', message: 'x', retryable: true }, meta: {} }))
    const { args, finalizeSession } = makeDeps({ target: { chat }, retryDelayMs: () => 0, maxRetries: 1 })
    const res = await runSession(args, { ...sessionInput, cond: { maxTurns: 5 } })
    expect(res.endReason).toBe('target_fatal_error')
    expect(res.avgScore).toBeNull()
    expect(finalizeSession).toHaveBeenCalledTimes(1)
  })

  it('single target error does NOT end the session — continues to maxTurns', async () => {
    // turn 0 errors (non-retryable), turns 1+ succeed → should reach max_turns, not target_fatal_error
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: '', firstTokenMs: null, totalMs: 10, done: true, error: { errorType: 'param_error', message: 'too long', retryable: false }, meta: {} })
      .mockResolvedValue({ text: '在的', firstTokenMs: 100, totalMs: 400, done: true, error: null, meta: { messageId: 2, sessionId: 's9' } })
    const { args, saved } = makeDeps({ target: { chat } })
    const res = await runSession(args, { ...sessionInput, cond: { maxTurns: 3 } })
    expect(res.endReason).toBe('max_turns')        // not target_fatal_error
    expect(saved).toHaveLength(3)                   // errored turn + 2 good turns all persisted
  })

  it('judge:null does not crash, turn still saved, no overall accumulated', async () => {
    const judgeEngine = { judgeTurn: vi.fn(async () => ({ hard: { firstTokenMs: 100, totalMs: 400, hasError: false, replyLen: 2 }, judge: null, judgeError: 'rate limit' })) }
    const { args, saved } = makeDeps({ judge: judgeEngine })
    const res = await runSession(args, { ...sessionInput, cond: { maxTurns: 1 } })
    expect(saved).toHaveLength(1)
    expect(res.avgScore).toBeNull() // no overalls accumulated
  })

  it('recall uses injected fact value not key', async () => {
    // 1-based: injectAtTurn=1 fires at idx=0; probeAtTurn=2 fires at idx=1
    // target reply on probe turn contains the VALUE '苏州'
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: '好的', firstTokenMs: 100, totalMs: 400, done: true, error: null, meta: { messageId: 1, sessionId: 's9' } })
      .mockResolvedValueOnce({ text: '你老家苏州的嘛', firstTokenMs: 100, totalMs: 400, done: true, error: null, meta: { messageId: 2, sessionId: 's9' } })
    const saveMemoryCheck = vi.fn(async () => {})
    const personaWithFacts = {
      ...persona,
      // 1-based turn numbers (Bug 5a convention)
      injectedFacts: [{ key: 'hometown', value: '苏州', injectAtTurn: 1 }],
      recallProbes: [{ factKey: 'hometown', probeAtTurn: 2, question: '老家哪里' }],
    }
    const { args, events } = makeDeps({ target: { chat }, saveMemoryCheck })
    await runSession(args, {
      ...sessionInput,
      persona: personaWithFacts,
      cond: { maxTurns: 2 },
    })
    expect(saveMemoryCheck).toHaveBeenCalledTimes(1)
    const calls = saveMemoryCheck.mock.calls as any[][]
    const call = calls[0]?.[0]
    expect(call?.factValue).toBe('苏州')   // value, not key
    expect(call?.factKey).toBe('hometown')
    expect(call?.recalled).toBe(true)
    const scoreEvent = events.find(e => e.type === 'turn.score' && (e as any).idx === 1)
    expect((scoreEvent as any).memoryHit).toBe(true)
  })

  it('empty reply skips judge, saves turn with judgeError=empty_reply, excluded from avgScore', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: '', firstTokenMs: null, totalMs: 50, done: true, error: null, meta: {} })
      .mockResolvedValueOnce({ text: '在的', firstTokenMs: 100, totalMs: 400, done: true, error: null, meta: { messageId: 2, sessionId: 's9' } })
    const { args, events, saved } = makeDeps({ target: { chat } })
    const res = await runSession(args, { ...sessionInput, cond: { maxTurns: 2 } })
    // Judge should only be called for the non-empty turn
    expect(args.judge.judgeTurn).toHaveBeenCalledTimes(1)
    // Both turns saved
    expect(saved).toHaveLength(2)
    const emptyTurn = saved.find((t: any) => t.targetText === '') as any
    expect(emptyTurn.score.judgeError).toBe('empty_reply')
    expect(emptyTurn.score.overall).toBeNull()
    // avgScore only from the scored turn
    expect(res.avgScore).toBeCloseTo(4.0)
    const emptyScoreEvent = events.find(e => e.type === 'turn.score' && (e as any).judgeError === 'empty_reply')
    expect(emptyScoreEvent).toBeTruthy()
    expect((emptyScoreEvent as any).overall).toBeNull()
  })

  it('scriptedUserTurns replaces persona generation; session ends when turns exhausted', async () => {
    const targetChat = vi.fn()
      .mockResolvedValueOnce({ text: '你好呀', firstTokenMs: 100, totalMs: 300, done: true, error: null, meta: { messageId: 1, sessionId: 's9' } })
      .mockResolvedValueOnce({ text: '在的', firstTokenMs: 100, totalMs: 300, done: true, error: null, meta: { messageId: 2, sessionId: 's9' } })
    const { args } = makeDeps({ target: { chat: targetChat } })
    const res = await runSession(args, {
      ...sessionInput,
      cond: { maxTurns: 5 }, // higher than scripted turns count
      scriptedUserTurns: ['你好', '在吗'],
    })
    // persona.nextUserMessage must NOT be called in replay mode
    expect(args.persona.nextUserMessage).not.toHaveBeenCalled()
    // target receives the scripted texts in order
    expect(targetChat).toHaveBeenCalledTimes(2)
    expect((targetChat.mock.calls[0] as any[])[1]).toBe('你好')
    expect((targetChat.mock.calls[1] as any[])[1]).toBe('在吗')
    // session ends when scripted turns exhausted (not at maxTurns:5)
    expect(res.endReason).toBe('max_turns')
    expect(res.turnCount).toBe(2)
  })

  it('judgeRecall fallback — literal miss but judgeRecall returns true → memoryHit true', async () => {
    // Target reply does NOT literally contain '苏州' but uses paraphrase
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: '好的', firstTokenMs: 100, totalMs: 400, done: true, error: null, meta: { messageId: 1, sessionId: 's9' } })
      .mockResolvedValueOnce({ text: '你来自那个著名的园林城市', firstTokenMs: 100, totalMs: 400, done: true, error: null, meta: { messageId: 2, sessionId: 's9' } })
    const saveMemoryCheck = vi.fn(async () => {})
    const judgeRecall = vi.fn(async () => true)
    const personaWithFacts = {
      ...persona,
      // 1-based turn numbers (Bug 5a convention)
      injectedFacts: [{ key: 'hometown', value: '苏州', injectAtTurn: 1 }],
      recallProbes: [{ factKey: 'hometown', probeAtTurn: 2, question: '老家哪里' }],
    }
    const { args } = makeDeps({ target: { chat }, saveMemoryCheck, judgeRecall })
    await runSession(args, {
      ...sessionInput,
      persona: personaWithFacts,
      cond: { maxTurns: 2 },
    })
    expect(judgeRecall).toHaveBeenCalledTimes(1)
    const calls = saveMemoryCheck.mock.calls as any[][]
    const call = calls[0]?.[0]
    expect(call?.recalled).toBe(true)
  })

  // ── NEW TESTS for the 5 bugs ────────────────────────────────────────────────

  // Bug 1: injected flag is correctly read on probe turn (was always false before)
  it('[Bug1] injected=true in saveMemoryCheck when fact was said on injection turn', async () => {
    // persona nextUserMessage returns something containing the fact value on turn 1 (1-based inject)
    const nextUserMessage = vi.fn()
      .mockResolvedValueOnce('我老家在苏州，挺美的') // turn idx=0 → injectAtTurn=1
      .mockResolvedValueOnce('你还记得我老家吗')     // turn idx=1 → probeAtTurn=2
    const chat = vi.fn()
      .mockResolvedValue({ text: '记得，苏州', firstTokenMs: 100, totalMs: 300, done: true, error: null, meta: { messageId: 1, sessionId: 's9' } })
    const saveMemoryCheck = vi.fn(async () => {})
    const personaWithFacts = {
      ...persona,
      // 1-based: inject on turn 1, probe on turn 2
      injectedFacts: [{ key: 'hometown', value: '苏州', injectAtTurn: 1 }],
      recallProbes: [{ factKey: 'hometown', probeAtTurn: 2, question: '老家哪里' }],
    }
    const { args } = makeDeps({ target: { chat }, saveMemoryCheck, persona: { nextUserMessage } })
    await runSession(args, { ...sessionInput, persona: personaWithFacts, cond: { maxTurns: 2 } })
    expect(saveMemoryCheck).toHaveBeenCalledTimes(1)
    const call = (saveMemoryCheck.mock.calls as any[][])[0]?.[0]
    // Fact was spoken (userText contains '苏州') → injected must be true
    expect(call?.injected).toBe(true)
  })

  it('[Bug1] injected=false when persona did NOT actually say the fact', async () => {
    const nextUserMessage = vi.fn()
      .mockResolvedValueOnce('今天天气不错啊')        // does NOT contain '苏州'
      .mockResolvedValueOnce('你还记得我老家吗')
    const chat = vi.fn()
      .mockResolvedValue({ text: '不太记得了', firstTokenMs: 100, totalMs: 300, done: true, error: null, meta: {} })
    const saveMemoryCheck = vi.fn(async () => {})
    const personaWithFacts = {
      ...persona,
      injectedFacts: [{ key: 'hometown', value: '苏州', injectAtTurn: 1 }],
      recallProbes: [{ factKey: 'hometown', probeAtTurn: 2, question: '老家哪里' }],
    }
    const { args } = makeDeps({ target: { chat }, saveMemoryCheck, persona: { nextUserMessage } })
    await runSession(args, { ...sessionInput, persona: personaWithFacts, cond: { maxTurns: 2 } })
    expect(saveMemoryCheck).toHaveBeenCalledTimes(1)
    const call = (saveMemoryCheck.mock.calls as any[][])[0]?.[0]
    expect(call?.injected).toBe(false)
  })

  // Bug 2: thrown exception from target.chat is converted to structured error
  it('[Bug2] target.chat thrown exception is caught and treated as network_disconnect error', async () => {
    const chat = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))  // throws on turn 0
      .mockResolvedValue({ text: '在的', firstTokenMs: 100, totalMs: 400, done: true, error: null, meta: { messageId: 2, sessionId: 's9' } })
    const { args, saved } = makeDeps({ target: { chat }, maxRetries: 0 })
    // Should NOT throw — the exception is converted to a structured error turn
    const res = await runSession(args, { ...sessionInput, cond: { maxTurns: 2 } })
    expect(res.endReason).toBe('max_turns')  // session continues
    // First turn was an error turn, second was good
    expect(saved).toHaveLength(2)
    const errTurn = (saved as any[])[0]
    expect(errTurn.errorType).toBe('network_disconnect')
  })

  it('[Bug2] repeated thrown exceptions count toward MAX_CONSECUTIVE_TARGET_ERRORS', async () => {
    const chat = vi.fn().mockRejectedValue(new Error('SSE broken'))
    const { args } = makeDeps({ target: { chat }, maxRetries: 0 })
    const res = await runSession(args, { ...sessionInput, cond: { maxTurns: 20 } })
    expect(res.endReason).toBe('target_fatal_error')
  })

  // Bug 3a: manual stop detected after persona generates message (before emit/push)
  it('[Bug3a] manual stop after persona generation discards the unsent message and finishes', async () => {
    let callCount = 0
    // isManualStop returns true only after the first turn completes (to let turn 0 succeed)
    // then on turn 1 persona generates a message but stop fires before target call
    const isManualStop = vi.fn(() => {
      callCount++
      // Loop top check (idx=0): false, loop top check (idx=1): false,
      // post-persona check (idx=1): true
      return callCount >= 3
    })
    const { args, events } = makeDeps({ isManualStop })
    const res = await runSession(args, { ...sessionInput, cond: { maxTurns: 10 } })
    expect(res.endReason).toBe('manual_stop')
    // target.chat should only have been called once (turn 0), not for the stopped turn
    expect(args.target.chat).toHaveBeenCalledTimes(1)
    // No turn.user event for the discarded message
    const userEvents = events.filter(e => e.type === 'turn.user')
    expect(userEvents).toHaveLength(1) // only turn 0
  })

  // Bug 3b: manual stop after target reply, before judge — turn saved without score
  it('[Bug3b] manual stop after target reply saves the turn (no score) then finishes', async () => {
    let callCount = 0
    // Returns true on the post-target check for turn 0
    // Sequence: loop-top(idx=0)=false, post-persona(idx=0)=false, post-target(idx=0)=true
    const isManualStop = vi.fn(() => {
      callCount++
      return callCount >= 3
    })
    const { args, saved } = makeDeps({ isManualStop })
    const res = await runSession(args, { ...sessionInput, cond: { maxTurns: 10 } })
    expect(res.endReason).toBe('manual_stop')
    // Judge must NOT have been called
    expect(args.judge.judgeTurn).not.toHaveBeenCalled()
    // The turn is still saved (with target text but no score dims)
    expect(saved).toHaveLength(1)
    const savedTurn = (saved as any[])[0]
    expect(savedTurn.targetText).toBe('在的')
    expect(savedTurn.score.dims).toBeNull()
    expect(savedTurn.score.overall).toBeNull()
  })

  // Bug 4: error turn pops the persona history entry
  it('[Bug4] error turn does not leave a dangling persona entry in history', async () => {
    // Turn 0: target error (non-retryable) → persona entry should be popped
    // Turn 1: target succeeds → history should have exactly [persona, target] after turn 1
    const capturedHistories: Array<{ role: string }[]> = []
    const judgeCapture = vi.fn(async (input: any) => {
      capturedHistories.push(input.recentHistory.slice())
      return {
        hard: { firstTokenMs: 100, totalMs: 400, hasError: false, replyLen: 2 },
        judge: { dims: { personaFit: 4, empathy: 4, memoryAccuracy: 4, safety: 5, naturalness: 4, relevance: 4 }, overall: 4.0, comment: 'ok', improvementSuggestion: 's', violation: false },
        judgeError: undefined,
      }
    })
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: '', firstTokenMs: null, totalMs: 10, done: true, error: { errorType: 'param_error', message: 'x', retryable: false }, meta: {} })
      .mockResolvedValue({ text: '在的', firstTokenMs: 100, totalMs: 400, done: true, error: null, meta: { messageId: 2, sessionId: 's9' } })
    const { args } = makeDeps({ target: { chat }, judge: { judgeTurn: judgeCapture } })
    await runSession(args, { ...sessionInput, cond: { maxTurns: 2 } })
    // After turn 0 error (popped), turn 1 succeeds; history passed to judge
    // should be exactly: [persona(turn1), target(turn1)] — no dangling turn0 persona
    expect(capturedHistories).toHaveLength(1)
    const capturedHistory = capturedHistories[0]!
    expect(capturedHistory.length).toBe(2)
    expect(capturedHistory[0]!.role).toBe('persona')
    expect(capturedHistory[1]!.role).toBe('target')
  })

  // Bug 5a: 1-based turn scheduling
  it('[Bug5a] injectAtTurn=1 fires on idx=0 (1-based scheduling)', async () => {
    const nextUserMessage = vi.fn().mockResolvedValue('在吗')
    const { args } = makeDeps({ persona: { nextUserMessage } })
    const personaWithInject = {
      ...persona,
      injectedFacts: [{ key: 'pet', value: '橘子猫', injectAtTurn: 1 }], // 1-based → idx=0
    }
    await runSession(args, { ...sessionInput, persona: personaWithInject, cond: { maxTurns: 1 } })
    // the inject cue should have been provided on the first call (idx=0)
    const calls = nextUserMessage.mock.calls as any[][]
    expect(calls[0]?.[2]).toEqual({ kind: 'inject', key: 'pet', value: '橘子猫' })
  })

  it('[Bug5a] probeAtTurn=2 fires on idx=1 (1-based scheduling)', async () => {
    const nextUserMessage = vi.fn().mockResolvedValue('在吗')
    const chat = vi.fn()
      .mockResolvedValue({ text: '好的', firstTokenMs: 100, totalMs: 300, done: true, error: null, meta: {} })
    const saveMemoryCheck = vi.fn(async () => {})
    const personaWithProbe = {
      ...persona,
      injectedFacts: [{ key: 'pet', value: '橘子猫', injectAtTurn: 1 }],
      recallProbes: [{ factKey: 'pet', probeAtTurn: 2, question: '我的宠物叫什么' }], // 1-based → idx=1
    }
    const { args } = makeDeps({ target: { chat }, saveMemoryCheck, persona: { nextUserMessage } })
    await runSession(args, { ...sessionInput, persona: personaWithProbe, cond: { maxTurns: 2 } })
    // probeAtTurn=2 → should fire on second turn (idx=1)
    const calls = nextUserMessage.mock.calls as any[][]
    expect(calls[1]?.[2]).toEqual({ kind: 'probe', question: '我的宠物叫什么' })
    // saveMemoryCheck called once (on probe turn)
    expect(saveMemoryCheck).toHaveBeenCalledTimes(1)
  })

  // Bug 5b: probe carry-over when error/empty-reply on probe turn
  it('[Bug5b] probe carries over to next turn when probe turn is an error turn', async () => {
    // probeAtTurn=1 (1-based → idx=0) but idx=0 is an error → carry to idx=1
    const nextUserMessage = vi.fn()
      .mockResolvedValueOnce('在吗')
      .mockResolvedValueOnce('你记得我说的吗')
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: '', firstTokenMs: null, totalMs: 10, done: true, error: { errorType: 'timeout', message: 'x', retryable: false }, meta: {} }) // error on idx=0
      .mockResolvedValueOnce({ text: '记得，苏州', firstTokenMs: 100, totalMs: 300, done: true, error: null, meta: { messageId: 2, sessionId: 's9' } })
    const saveMemoryCheck = vi.fn(async () => {})
    const personaWithProbe = {
      ...persona,
      injectedFacts: [{ key: 'hometown', value: '苏州', injectAtTurn: 0 }], // 0-based would miss; but we test carry-over here separately
      recallProbes: [{ factKey: 'hometown', probeAtTurn: 1, question: '老家哪里' }], // 1-based → idx=0, but error → carry to idx=1
    }
    const { args } = makeDeps({ target: { chat }, saveMemoryCheck, persona: { nextUserMessage } })
    await runSession(args, { ...sessionInput, persona: personaWithProbe, cond: { maxTurns: 2 } })
    // Even though idx=0 was an error, the probe should be carried to idx=1 and checked
    expect(saveMemoryCheck).toHaveBeenCalledTimes(1)
    const call = (saveMemoryCheck.mock.calls as any[][])[0]?.[0]
    expect(call?.factKey).toBe('hometown')
    // target said '记得，苏州' → recalled=true
    expect(call?.recalled).toBe(true)
    // The question was given as a probe cue on the carry-over turn
    const personaCalls = nextUserMessage.mock.calls as any[][]
    expect(personaCalls[1]?.[2]).toEqual({ kind: 'probe', question: '老家哪里' })
  })

  it('[Bug5b] probe is NOT carried over in replay mode (scripted turns are fixed)', async () => {
    // In replay mode, probes don't carry over since scripted text is fixed per turn
    const chat = vi.fn()
      .mockResolvedValueOnce({ text: '', firstTokenMs: null, totalMs: 10, done: true, error: { errorType: 'timeout', message: 'x', retryable: false }, meta: {} }) // error on idx=0
      .mockResolvedValueOnce({ text: '在的', firstTokenMs: 100, totalMs: 300, done: true, error: null, meta: { messageId: 2, sessionId: 's9' } })
    const saveMemoryCheck = vi.fn(async () => {})
    const personaWithProbe = {
      ...persona,
      recallProbes: [{ factKey: 'hometown', probeAtTurn: 1, question: '老家哪里' }], // 1-based → idx=0 errors
    }
    const { args } = makeDeps({ target: { chat }, saveMemoryCheck })
    await runSession(args, {
      ...sessionInput,
      persona: personaWithProbe,
      cond: { maxTurns: 2 },
      scriptedUserTurns: ['你好', '在吗'],
    })
    // In replay mode, probe carry-over is disabled — saveMemoryCheck not called on idx=1
    expect(saveMemoryCheck).not.toHaveBeenCalled()
  })

  it('模拟用户抛错：会话落成 session_error 终态并发 session.ended，错误继续抛出', async () => {
    const { args, events, finalizeSession } = makeDeps({
      persona: { nextUserMessage: vi.fn(async () => { throw new Error('model 500') }) },
    })
    await expect(runSession(args, sessionInput)).rejects.toThrow('model 500')
    expect(finalizeSession).toHaveBeenCalledTimes(1)
    expect((finalizeSession.mock.calls as unknown as unknown[][])[0]![0]).toMatchObject({ endReason: 'session_error' })
    expect(events.at(-1)).toMatchObject({ type: 'session.ended', endReason: 'session_error' })
  })

  it('模拟用户返回空串：重试一次生成，仍为空则失败，不把空消息发给被测后端', async () => {
    const next = vi.fn().mockResolvedValueOnce('  ').mockResolvedValue('在吗')
    const a = makeDeps({ persona: { nextUserMessage: next } })
    await runSession(a.args, { ...sessionInput, cond: { maxTurns: 1 } })
    expect(a.args.target.chat.mock.calls[0][1]).toBe('在吗')

    const b = makeDeps({ persona: { nextUserMessage: vi.fn(async () => '') } })
    await expect(runSession(b.args, sessionInput)).rejects.toThrow('空消息')
    expect(b.args.target.chat).not.toHaveBeenCalled()
  })

  it('重试前发 turn.target.reset，实时页据此清掉上一次的半截文本', async () => {
    const chat = vi.fn()
      .mockImplementationOnce(async (_t: string, _c: string, _id: string, o: any) => {
        o.onDelta('半截')
        return { text: '半截', firstTokenMs: 1, totalMs: 10, done: false, error: { errorType: 'stream_incomplete', message: 'x', retryable: true }, meta: {} }
      })
      .mockImplementation(async (_t: string, _c: string, _id: string, o: any) => {
        o.onDelta('完整')
        return { text: '完整', firstTokenMs: 1, totalMs: 10, done: true, error: null, meta: {} }
      })
    const { args, events } = makeDeps({ target: { chat } })
    await runSession(args, { ...sessionInput, cond: { maxTurns: 1 } })
    const types = events.map(e => e.type)
    expect(types.indexOf('turn.target.reset')).toBeGreaterThan(types.indexOf('turn.target.delta'))
    expect(types.indexOf('turn.target.reset')).toBeLessThan(types.lastIndexOf('turn.target.delta'))
  })
})
