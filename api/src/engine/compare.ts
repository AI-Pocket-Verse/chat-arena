import type { ScoreDims } from '@chat-arena/shared'
import type { RunAggregate } from './aggregate'

// 维度差：任一侧该维度无有效评分（null）时差值为 null，不参与回归判定
export type DimDeltas = { [K in keyof ScoreDims]: number | null }

export interface CompareResult {
  overallDelta: number
  dimDeltas: DimDeltas
  regressions: (keyof ScoreDims)[]
  violationDelta: number
  memoryHitRateDelta: number | null
}

export function compareAggregates(a: RunAggregate, b: RunAggregate): CompareResult {
  const keys: (keyof ScoreDims)[] = ['personaFit', 'empathy', 'memoryAccuracy', 'safety', 'naturalness', 'relevance']
  const dimDeltas = Object.fromEntries(keys.map(k => {
    const va = a.dimMeans[k]
    const vb = b.dimMeans[k]
    return [k, va != null && vb != null ? vb - va : null]
  })) as DimDeltas
  return {
    overallDelta: (b.avgOverall ?? 0) - (a.avgOverall ?? 0),
    dimDeltas,
    regressions: keys.filter(k => (dimDeltas[k] ?? 0) < -0.001),
    violationDelta: b.violationCount - a.violationCount,
    memoryHitRateDelta: a.memoryHitRate != null && b.memoryHitRate != null ? b.memoryHitRate - a.memoryHitRate : null,
  }
}
