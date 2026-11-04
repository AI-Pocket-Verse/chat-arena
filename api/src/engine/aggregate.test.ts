import { describe, expect, it } from 'vitest'
import { aggregateTurns } from './aggregate'

const turns = [
  { firstTokenMs: 100, totalMs: 500, errorType: null, dims: { personaFit: 4, empathy: 5, memoryAccuracy: 3, safety: 5, naturalness: 4, relevance: 5 }, overall: 4.3, violation: false, memoryHit: true as boolean | null },
  { firstTokenMs: 200, totalMs: 700, errorType: 'timeout', dims: { personaFit: 3, empathy: 3, memoryAccuracy: 3, safety: 4, naturalness: 3, relevance: 3 }, overall: 3.2, violation: true, memoryHit: false as boolean | null },
]

describe('aggregateTurns', () => {
  it('computes turn-weighted averages (v2 H), dim means, error/violation/memory rates, latency', () => {
    const a = aggregateTurns(turns)
    expect(a.turnCount).toBe(2)
    // turn-weighted: (4.3 + 3.2) / 2 = 3.75
    expect(a.avgOverall).toBeCloseTo(3.75)
    expect(a.dimMeans.empathy).toBeCloseTo(4)  // (5+3)/2
    expect(a.errorRate).toBeCloseTo(0.5)
    expect(a.violationCount).toBe(1)
    expect(a.memoryHitRate).toBeCloseTo(0.5)
    expect(a.avgFirstTokenMs).toBeCloseTo(150)
  })

  it('handles all-null memoryHit gracefully', () => {
    const a = aggregateTurns([{ firstTokenMs: null, totalMs: 300, errorType: null, dims: { personaFit: 3, empathy: 3, memoryAccuracy: 3, safety: 3, naturalness: 3, relevance: 3 }, overall: 3, violation: false, memoryHit: null }])
    expect(a.memoryHitRate).toBeNull()
    expect(a.avgFirstTokenMs).toBeNull()
    expect(a.avgOverall).toBeCloseTo(3)
  })

  it('returns null avgOverall for empty input', () => {
    const a = aggregateTurns([])
    expect(a.turnCount).toBe(0)
    expect(a.avgOverall).toBeNull()
  })

  it('returns null dimMeans for empty input (no data vs true 0 distinction)', () => {
    const a = aggregateTurns([])
    expect(a.dimMeans.personaFit).toBeNull()
    expect(a.dimMeans.empathy).toBeNull()
    expect(a.dimMeans.safety).toBeNull()
  })

  it('returns null dimMeans when all turns have no valid judge score', () => {
    // Turn with empty dims (judge failed) — personaFit is not a number
    const a = aggregateTurns([
      { firstTokenMs: null, totalMs: 300, errorType: 'judge_error', dims: {} as any, overall: 0, violation: false, memoryHit: null },
    ])
    expect(a.dimMeans.personaFit).toBeNull()
    expect(a.avgOverall).toBeNull()
  })

  it('returns numeric dimMeans when scored turns exist', () => {
    const a = aggregateTurns(turns)
    expect(typeof a.dimMeans.personaFit).toBe('number')
    expect(a.dimMeans.empathy).toBeCloseTo(4)  // (5+3)/2
  })
})
