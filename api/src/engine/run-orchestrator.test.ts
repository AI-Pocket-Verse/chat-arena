import { describe, expect, it, vi } from 'vitest'
import { orchestrateRun } from './run-orchestrator'

const persona = { id: 'p1', name: '小明', category: 'normal' as const, structured: {}, systemPrompt: 'x' }

describe('orchestrateRun', () => {
  it('creates personaSet × repetitions sessions, first is watched, aggregates avgScore', async () => {
    const createdSessions: string[] = []
    const runSessionMock = vi.fn(async (_deps: any, input: any) => {
      createdSessions.push(input.sessionId)
      return { sessionId: input.sessionId, endReason: 'max_turns', turnCount: 2, avgScore: 4 }
    })
    const summary = await orchestrateRun({
      runId: 'run1',
      personas: [persona],
      repetitions: 3,
      concurrency: 2,
      taGender: 2,
      cond: { maxTurns: 2 },
      newToken: vi.fn(async () => ({ token: 'jwt', uid: 1, memoryId: 9 })),
      makeSessionDeps: () => ({}) as any,
      runSession: runSessionMock as any,
      onRunUpdate: vi.fn(),
      emit: vi.fn(),
      newId: (() => { let n = 0; return () => `s${n++}` })(),
      now: () => 0,
    })
    expect(createdSessions).toHaveLength(3)
    expect(summary.sessionCount).toBe(3)
    // avgScore and violations removed from RunSummary — authoritative from /metrics and /violations
    expect('avgScore' in summary).toBe(false)
    expect('violations' in summary).toBe(false)
    // 'watched' field removed from RunSessionInput — live-bus decides per-connection
    expect((runSessionMock.mock.calls[0] as any)[1].watched).toBeUndefined()
    // taGender passed to newToken
    // (checked indirectly — newToken called 3 times with taGender:2)
  })

  it('per-session error does not crash other sessions; failed run if all fail', async () => {
    const runSessionMock = vi.fn(async () => { throw new Error('boom') })
    const onRunUpdate = vi.fn()
    const summary = await orchestrateRun({
      runId: 'run1',
      personas: [persona],
      repetitions: 2,
      concurrency: 2,
      taGender: 2,
      cond: { maxTurns: 1 },
      newToken: vi.fn(async () => ({ token: 'jwt', uid: 1, memoryId: 9 })),
      makeSessionDeps: () => ({}) as any,
      runSession: runSessionMock as any,
      onRunUpdate,
      emit: vi.fn(),
      newId: (() => { let n = 0; return () => `s${n++}` })(),
      now: () => 0,
    })
    // did not throw — per-session errors are absorbed
    expect(summary.sessionCount).toBe(2)
    // run marked failed since all sessions errored; terminal onRunUpdate is awaited
    const finalUpdate = onRunUpdate.mock.calls.at(-1)?.[0]
    expect(finalUpdate?.status).toBe('failed')
    // terminal update is the last call and is awaited (onRunUpdate called at start + at end)
    expect(onRunUpdate).toHaveBeenCalledTimes(2)
  })

  it('manual stop → terminal status is "stopped" (not finished/failed)', async () => {
    const onRunUpdate = vi.fn()
    await orchestrateRun({
      runId: 'run1',
      personas: [persona],
      repetitions: 1,
      concurrency: 1,
      taGender: 2,
      cond: { maxTurns: 1 },
      newToken: vi.fn(async () => ({ token: 'jwt', uid: 1, memoryId: 9 })),
      makeSessionDeps: () => ({}) as any,
      runSession: vi.fn(async (_d: any, input: any) => ({ sessionId: input.sessionId, endReason: 'manual_stop', turnCount: 1, avgScore: 4 })) as any,
      onRunUpdate,
      emit: vi.fn(),
      newId: () => 's0',
      now: () => 0,
      isManualStop: () => true,
    })
    expect(onRunUpdate.mock.calls.at(-1)?.[0]?.status).toBe('stopped')
  })

  it('scriptedTurnsFor is passed as scriptedUserTurns in RunSessionInput', async () => {
    const scriptedTurns = ['台词1', '台词2']
    const scriptedTurnsFor = vi.fn((_personaId: string, _repetitionIndex: number) => scriptedTurns)
    const runSessionMock = vi.fn(async (_deps: any, input: any) => ({
      sessionId: input.sessionId, endReason: 'max_turns', turnCount: 2, avgScore: null,
    }))
    await orchestrateRun({
      runId: 'run-replay',
      personas: [persona],
      repetitions: 1,
      concurrency: 1,
      taGender: 2,
      cond: { maxTurns: 2 },
      scriptedTurnsFor,
      newToken: vi.fn(async () => ({ token: 'jwt', uid: 1, memoryId: 9 })),
      makeSessionDeps: () => ({}) as any,
      runSession: runSessionMock as any,
      onRunUpdate: vi.fn(),
      emit: vi.fn(),
      newId: () => 's0',
      now: () => 0,
    })
    expect(scriptedTurnsFor).toHaveBeenCalledWith('p1', 0)
    const callInput = (runSessionMock.mock.calls[0] as any[])[1]
    expect(callInput.scriptedUserTurns).toEqual(['台词1', '台词2'])
  })

  it('passes taGender to newToken', async () => {
    const newToken = vi.fn(async () => ({ token: 'jwt', uid: 1, memoryId: 9 }))
    await orchestrateRun({
      runId: 'r1', personas: [persona], repetitions: 1, concurrency: 1, taGender: 1,
      cond: { maxTurns: 1 },
      newToken,
      makeSessionDeps: () => ({}) as any,
      runSession: vi.fn(async () => ({ sessionId: 's0', endReason: 'max_turns', turnCount: 1, avgScore: 3 })) as any,
      onRunUpdate: vi.fn(), emit: vi.fn(),
      newId: () => 's0', now: () => 0,
    })
    expect(newToken).toHaveBeenCalledWith(1) // taGender=1
  })

  it('所有会话都 target_fatal_error 时 run 记为 failed 并带原因', async () => {
    const onRunUpdate = vi.fn()
    const summary = await orchestrateRun({
      runId: 'run1', personas: [persona], repetitions: 2, concurrency: 2, taGender: 2, cond: { maxTurns: 1 },
      newToken: vi.fn(async () => ({ token: 'jwt', uid: 1, memoryId: 9 })),
      makeSessionDeps: () => ({}) as any,
      runSession: (async (_d: any, input: any) => ({ sessionId: input.sessionId, endReason: 'target_fatal_error', turnCount: 5, avgScore: null })) as any,
      onRunUpdate, emit: vi.fn(),
      newId: (() => { let n = 0; return () => `s${n++}` })(), now: () => 0,
    })
    expect(onRunUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'failed' }))
    expect(summary.errorSample).toContain('target_fatal_error')
  })
})
