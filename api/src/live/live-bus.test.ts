import { describe, expect, it } from 'vitest'
import { LiveBus } from './live-bus'

function fakeSocket(readyState = 1) {
  const sent: string[] = []
  return { sent, readyState, send: (s: string) => sent.push(s) }
}

describe('LiveBus', () => {
  it('broadcasts non-delta events to all runId subscribers', () => {
    const bus = new LiveBus()
    const a = fakeSocket()
    const b = fakeSocket()
    bus.subscribe('run1', a as any)
    bus.subscribe('run1', b as any)
    bus.emit('run1', { type: 'session.started', runId: 'run1', sessionId: 's1', personaId: 'p1' })
    expect(a.sent).toHaveLength(1)
    expect(b.sent).toHaveLength(1)
  })

  it('sends turn.target.delta only to sockets watching that sessionId', () => {
    const bus = new LiveBus()
    const a = fakeSocket()
    const b = fakeSocket()
    bus.subscribe('run1', a as any)
    bus.subscribe('run1', b as any)
    bus.setWatch(a as any, 's1')    // a watches session s1
    // b has no watch set
    bus.emit('run1', { type: 'turn.target.delta', runId: 'run1', sessionId: 's1', idx: 0, deltaText: 'hi' })
    expect(a.sent).toHaveLength(1)  // a receives it
    expect(b.sent).toHaveLength(0)  // b does not
  })

  it('respects watch switch — old session delta not delivered after setWatch to new session', () => {
    const bus = new LiveBus()
    const a = fakeSocket()
    bus.subscribe('run1', a as any)
    bus.setWatch(a as any, 's1')
    bus.emit('run1', { type: 'turn.target.delta', runId: 'run1', sessionId: 's1', idx: 0, deltaText: 'a' })
    expect(a.sent).toHaveLength(1)
    bus.setWatch(a as any, 's2')     // switch to s2
    bus.emit('run1', { type: 'turn.target.delta', runId: 'run1', sessionId: 's1', idx: 1, deltaText: 'b' }) // still s1
    expect(a.sent).toHaveLength(1)   // not delivered
    bus.emit('run1', { type: 'turn.target.delta', runId: 'run1', sessionId: 's2', idx: 0, deltaText: 'c' }) // s2
    expect(a.sent).toHaveLength(2)   // delivered
  })

  it('unsubscribe removes socket from all runs', () => {
    const bus = new LiveBus()
    const a = fakeSocket()
    bus.subscribe('run1', a as any)
    bus.setWatch(a as any, 's1')
    bus.unsubscribe(a as any)
    bus.emit('run1', { type: 'session.started', runId: 'run1', sessionId: 's1', personaId: 'p1' })
    expect(a.sent).toHaveLength(0)
  })

  it('skips closed sockets (readyState !== 1)', () => {
    const bus = new LiveBus()
    const closed = fakeSocket(3) // 3 = CLOSED
    bus.subscribe('run1', closed as any)
    bus.emit('run1', { type: 'session.started', runId: 'run1', sessionId: 's1', personaId: 'p1' })
    expect(closed.sent).toHaveLength(0)
  })

  // default watch — session.started auto-assigns watch for unwatched sockets
  it('session.started auto-assigns watch so subsequent delta is delivered without explicit setWatch', () => {
    const bus = new LiveBus()
    const a = fakeSocket()
    bus.subscribe('run1', a as any)
    // no explicit setWatch — socket has no watch yet
    bus.emit('run1', { type: 'session.started', runId: 'run1', sessionId: 's1', personaId: 'p1' })
    expect(a.sent).toHaveLength(1) // session.started delivered
    // now delta for s1 must be delivered because auto-watch was set
    bus.emit('run1', { type: 'turn.target.delta', runId: 'run1', sessionId: 's1', idx: 0, deltaText: 'hi' })
    expect(a.sent).toHaveLength(2)
    // delta for a different session must NOT be delivered
    bus.emit('run1', { type: 'turn.target.delta', runId: 'run1', sessionId: 's2', idx: 0, deltaText: 'bye' })
    expect(a.sent).toHaveLength(2)
  })

  it('explicit setWatch overrides auto-assigned default watch', () => {
    const bus = new LiveBus()
    const a = fakeSocket()
    bus.subscribe('run1', a as any)
    // client explicitly watches s2 before any session.started fires
    bus.setWatch(a as any, 's2')
    // session.started for s1 must NOT overwrite the explicit watch
    bus.emit('run1', { type: 'session.started', runId: 'run1', sessionId: 's1', personaId: 'p1' })
    bus.emit('run1', { type: 'turn.target.delta', runId: 'run1', sessionId: 's1', idx: 0, deltaText: 'x' })
    expect(a.sent).toHaveLength(1) // only session.started, NOT the s1 delta
    bus.emit('run1', { type: 'turn.target.delta', runId: 'run1', sessionId: 's2', idx: 0, deltaText: 'y' })
    expect(a.sent).toHaveLength(2) // s2 delta delivered
  })

  // unsubscribe GC — byRun Set deleted when empty
  it('unsubscribe removes empty Set from byRun (GC)', () => {
    const bus = new LiveBus()
    const a = fakeSocket()
    bus.subscribe('run1', a as any)
    // expose internal map via cast for inspection
    const internal = bus as unknown as { byRun: Map<string, Set<unknown>> }
    expect(internal.byRun.has('run1')).toBe(true)
    bus.unsubscribe(a as any)
    // Set must be deleted once empty — no leak
    expect(internal.byRun.has('run1')).toBe(false)
  })

  it('byRun entry preserved when other sockets still subscribed', () => {
    const bus = new LiveBus()
    const a = fakeSocket()
    const b = fakeSocket()
    bus.subscribe('run1', a as any)
    bus.subscribe('run1', b as any)
    const internal = bus as unknown as { byRun: Map<string, Set<unknown>> }
    bus.unsubscribe(a as any)
    // b still subscribed — entry must stay
    expect(internal.byRun.has('run1')).toBe(true)
    expect(internal.byRun.get('run1')!.size).toBe(1)
  })
})
