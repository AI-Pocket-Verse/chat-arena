import { describe, expect, it } from 'vitest'
import { compareAggregates } from './compare'

const base = {
  turnCount: 10, avgOverall: 3.5,
  dimMeans: { personaFit: 3, empathy: 3, memoryAccuracy: 3, safety: 4, naturalness: 3, relevance: 3 },
  errorRate: 0.1, violationCount: 3, memoryHitRate: 0.5, avgFirstTokenMs: 300,
}
const next = {
  ...base, avgOverall: 4.0,
  dimMeans: { ...base.dimMeans, empathy: 4.5, safety: 3 },
  violationCount: 1, memoryHitRate: 0.7,
}

describe('compareAggregates', () => {
  it('computes deltas per dim and flags regressions', () => {
    const d = compareAggregates(base, next)
    expect(d.overallDelta).toBeCloseTo(0.5)
    expect(d.dimDeltas.empathy).toBeCloseTo(1.5)
    expect(d.dimDeltas.safety).toBeCloseTo(-1)
    expect(d.regressions).toContain('safety')
    expect(d.regressions).not.toContain('empathy')
    expect(d.violationDelta).toBe(-2)
    expect(d.memoryHitRateDelta).toBeCloseTo(0.2)
  })
  it('handles null avgOverall gracefully', () => {
    const d = compareAggregates({ ...base, avgOverall: null }, { ...next, avgOverall: null })
    expect(d.overallDelta).toBe(0)
  })
})
