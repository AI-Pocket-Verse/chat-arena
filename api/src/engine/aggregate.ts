import type { ScoreDims } from '@chat-arena/shared'

export interface TurnAgg {
  firstTokenMs: number | null
  totalMs: number
  errorType: string | null
  dims: ScoreDims
  overall: number
  violation: boolean
  memoryHit: boolean | null
}

// Each dimension is null when no valid-scored turns exist for that dimension,
// distinguishing "no data" from a genuine score of 0.
export type DimMeans = { [K in keyof ScoreDims]: number | null }

export interface RunAggregate {
  turnCount: number
  avgOverall: number | null  // turn-weighted (v2 H)
  dimMeans: DimMeans
  errorRate: number
  violationCount: number
  memoryHitRate: number | null
  avgFirstTokenMs: number | null
}

export function aggregateTurns(turns: TurnAgg[]): RunAggregate {
  const n = turns.length
  const nullDims: DimMeans = { personaFit: null, empathy: null, memoryAccuracy: null, safety: null, naturalness: null, relevance: null }
  if (n === 0) {
    return { turnCount: 0, avgOverall: null, dimMeans: nullDims, errorRate: 0, violationCount: 0, memoryHitRate: null, avgFirstTokenMs: null }
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const dimKeys: (keyof ScoreDims)[] = ['personaFit', 'empathy', 'memoryAccuracy', 'safety', 'naturalness', 'relevance']

  // 仅用「有有效裁判维度分」的轮计算维度均值与综合分；
  // 裁判失败 / 空回复的轮 dims 为 {}（无 personaFit 数字），不能参与，否则会把均值算成 NaN。
  const scored = turns.filter(t => t.dims && typeof t.dims.personaFit === 'number')
  // null when scored.length === 0 so downstream can distinguish "no data" from a true 0.
  const dimMeans: DimMeans = scored.length === 0
    ? nullDims
    : Object.fromEntries(dimKeys.map(k => [k, mean(scored.map(t => t.dims[k]))])) as DimMeans

  const ft = turns.map(t => t.firstTokenMs).filter((x): x is number => x != null)
  const probed = turns.filter(t => t.memoryHit != null)

  return {
    turnCount: n,
    avgOverall: scored.length ? mean(scored.map(t => t.overall)) : null,   // turn-weighted，仅计有效评分轮
    dimMeans,
    errorRate: turns.filter(t => t.errorType != null).length / n,
    violationCount: turns.filter(t => t.violation).length,
    memoryHitRate: probed.length ? probed.filter(t => t.memoryHit).length / probed.length : null,
    avgFirstTokenMs: ft.length ? mean(ft) : null,
  }
}
