import { useEffect, useState } from 'react'
import { api, type RunAggregate } from '../api'
import { ErrorState } from '../error-state'
import { type MessageKey, useI18n } from '../i18n'
import { type RunRow, RunPicker } from '../run-picker'

interface CompareResult {
  overallDelta: number
  dimDeltas: Record<string, number>
  regressions: string[]
  violationDelta: number
  memoryHitRateDelta: number | null
}

interface CompareResponse {
  runA: RunAggregate
  runB: RunAggregate
  comparison: CompareResult
}

const DIM_KEYS = ['personaFit', 'empathy', 'memoryAccuracy', 'safety', 'naturalness', 'relevance'] as const
type DimKey = typeof DIM_KEYS[number]

const DIM_LABELS: Record<DimKey, MessageKey> = {
  personaFit: 'compare.dim.personaFit',
  empathy: 'compare.dim.empathy',
  memoryAccuracy: 'compare.dim.memoryAccuracy',
  safety: 'compare.dim.safety',
  naturalness: 'compare.dim.naturalness',
  relevance: 'compare.dim.relevance',
}

// SVG radar chart: pure inline, no deps
// dims: {key: value 1-10 | null}  null = no data for that dimension
function RadarChart({
  dataA,
  dataB,
  noDataA,
  noDataB,
}: {
  dataA: Partial<Record<DimKey, number | null>>
  dataB: Partial<Record<DimKey, number | null>>
  noDataA: boolean
  noDataB: boolean
}) {
  const { t } = useI18n()
  const cx = 120
  const cy = 120
  const r = 90
  const n = DIM_KEYS.length
  const scale = 10 // max value

  function polar(i: number, val: number): [number, number] {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2
    const radius = (val / scale) * r
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
  }

  function labelPos(i: number): [number, number] {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2
    const radius = r + 18
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
  }

  // Grid rings at 2,4,6,8,10
  const rings = [2, 4, 6, 8, 10].map(val => {
    const pts = DIM_KEYS.map((_, i) => polar(i, val).join(',')).join(' ')
    return <polygon key={val} points={pts} fill="none" stroke="#E8E8EE" strokeWidth="1" />
  })

  // Axis lines
  const axes = DIM_KEYS.map((_, i) => {
    const [x, y] = polar(i, scale)
    return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#E8E8EE" strokeWidth="1" />
  })

  // Labels
  const labels = DIM_KEYS.map((k, i) => {
    const [x, y] = labelPos(i)
    return (
      <text
        key={k}
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="9"
        fill="#6B7280"
      >
        {t(DIM_LABELS[k])}
      </text>
    )
  })

  // Bug 5: null means no data — use 0 as placeholder to keep polygon shape valid,
  // but the noDataA/noDataB flags drive the UI warning below the chart.
  const polyA = DIM_KEYS.map((k, i) => polar(i, dataA[k] ?? 0).join(',')).join(' ')
  const polyB = DIM_KEYS.map((k, i) => polar(i, dataB[k] ?? 0).join(',')).join(' ')

  return (
    <div className="flex flex-col items-center gap-2">
      {/* 左右各留 40 宽：英文维度名（如 Memory accuracy）比中文长，留白不够会被裁掉 */}
      <svg width="320" height="240" viewBox="-40 0 320 240" aria-label={t('compare.radar.aria')}>
        {rings}
        {axes}
        {/* Run A: muted gray */}
        {!noDataA && <polygon points={polyA} fill="rgba(107,114,128,0.18)" stroke="#9CA3AF" strokeWidth="1.5" />}
        {/* Run B: blue */}
        {!noDataB && <polygon points={polyB} fill="rgba(22,100,255,0.15)" stroke="#1664FF" strokeWidth="1.5" />}
        {labels}
        {/* Legend */}
        <rect x="8" y="224" width="10" height="3" fill="#9CA3AF" rx="1" />
        <text x="21" y="227" fontSize="8" fill="#6B7280" dominantBaseline="middle">Run A</text>
        <rect x="60" y="224" width="10" height="3" fill="#1664FF" rx="1" />
        <text x="73" y="227" fontSize="8" fill="#1664FF" dominantBaseline="middle">Run B</text>
      </svg>
      {(noDataA || noDataB) && (
        <p className="text-[11px] text-[#9CA3AF] text-center">
          {noDataA && noDataB ? t('compare.radar.noDataBoth') : noDataA ? t('compare.radar.noDataA') : t('compare.radar.noDataB')}
        </p>
      )}
    </div>
  )
}

export function Compare() {
  const { t } = useI18n()
  const [runA, setRunA] = useState('')
  const [runB, setRunB] = useState('')
  const [result, setResult] = useState<CompareResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [runs, setRuns] = useState<RunRow[]>([])

  useEffect(() => {
    void api.listRuns().then(r => setRuns((r as { runs: RunRow[] }).runs)).catch(() => { /* ignore */ })
  }, [])

  async function compare() {
    setError(null)
    try {
      const r = await api.compareRuns(runA, runB)
      setResult(r as CompareResponse)
    } catch (e) {
      setError(e)
    }
  }

  const sign = (n: number) => n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2)
  const isRegression = (key: string) => result?.comparison.regressions.includes(key)

  const latencyDelta = result
    ? ((result.runB.avgFirstTokenMs ?? 0) - (result.runA.avgFirstTokenMs ?? 0))
    : null

  // Bug 5: detect whether a side has all-null dimMeans (no scoring data)
  const noDataA = result ? DIM_KEYS.every(k => result.runA.dimMeans[k] == null) : false
  const noDataB = result ? DIM_KEYS.every(k => result.runB.dimMeans[k] == null) : false

  return (
    <div
      className="p-6 min-h-screen"
      style={{
        background: 'radial-gradient(60rem 40rem at 90% -10%, rgba(22,100,255,0.05), transparent 60%), #ffffff',
      }}
    >
      <h2 className="text-xl font-semibold mb-6 text-[#15171E]">{t('compare.title')}</h2>
      <div className="flex flex-col sm:flex-row gap-3 mb-6 max-w-3xl">
        <div className="flex-1 min-w-0"><RunPicker runs={runs} value={runA} onChange={setRunA} placeholder={t('compare.pickA')} /></div>
        <div className="flex-1 min-w-0"><RunPicker runs={runs} value={runB} onChange={setRunB} placeholder={t('compare.pickB')} /></div>
        <button
          className="px-4 py-2 rounded-xl text-sm text-white font-medium disabled:opacity-40 transition-opacity shrink-0"
          style={{ background: 'linear-gradient(135deg, #1664FF, #5B9CFF)' }}
          disabled={!runA || !runB || runA === runB}
          onClick={compare}
        >
          {t('compare.submit')}
        </button>
      </div>
      {runA && runB && runA === runB && (
        <p className="text-[#D97706] text-xs mb-4 -mt-3">{t('compare.same')}</p>
      )}
      {error != null && <ErrorState error={error} title={t('compare.error')} className="mb-4 max-w-2xl" />}
      {result && (
        <div className="space-y-4 max-w-2xl">
          {/* Top deltas row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Overall delta */}
            <div
              className="rounded-xl border border-[#ECECF2] bg-white p-4"
              style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
            >
              <div className="text-[10px] uppercase tracking-widest text-[#9CA3AF] mb-1">{t('compare.overallDelta')}</div>
              <span className={`text-2xl font-mono font-bold ${result.comparison.overallDelta >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                {sign(result.comparison.overallDelta)}
              </span>
            </div>
            {/* Violation delta */}
            <div
              className="rounded-xl border border-[#ECECF2] bg-white p-4"
              style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
            >
              <div className="text-[10px] uppercase tracking-widest text-[#9CA3AF] mb-1">{t('compare.violationDelta')}</div>
              <span className={`text-2xl font-mono font-bold ${result.comparison.violationDelta <= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                {sign(result.comparison.violationDelta)}
              </span>
            </div>
            {/* Memory hit delta */}
            {result.comparison.memoryHitRateDelta != null && (
              <div
                className="rounded-xl border border-[#ECECF2] bg-white p-4"
                style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
              >
                <div className="text-[10px] uppercase tracking-widest text-[#9CA3AF] mb-1">{t('compare.memoryDelta')}</div>
                <span className={`text-2xl font-mono font-bold ${result.comparison.memoryHitRateDelta >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                  {sign(result.comparison.memoryHitRateDelta * 100)}%
                </span>
              </div>
            )}
            {/* Latency delta */}
            {latencyDelta != null && (result.runA.avgFirstTokenMs != null || result.runB.avgFirstTokenMs != null) && (
              <div
                className="rounded-xl border border-[#ECECF2] bg-white p-4"
                style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
              >
                <div className="text-[10px] uppercase tracking-widest text-[#9CA3AF] mb-1">{t('compare.latencyDelta')}</div>
                <span className={`text-2xl font-mono font-bold ${latencyDelta <= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                  {latencyDelta > 0 ? '+' : ''}{Math.round(latencyDelta)}ms
                </span>
              </div>
            )}
          </div>

          {/* Dim deltas + radar side by side */}
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Dim deltas */}
            <div
              className="flex-1 rounded-xl border border-[#ECECF2] bg-white p-5 space-y-2"
              style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
            >
              <div className="text-sm font-medium text-[#15171E] mb-3">{t('compare.dimDeltas')}</div>
              {DIM_KEYS.map((k) => {
                // Bug 5: if either side has null for this dim, show — instead of a delta
                const vA = result.runA.dimMeans[k]
                const vB = result.runB.dimMeans[k]
                const hasData = vA != null && vB != null
                const delta = result.comparison.dimDeltas[k]
                return (
                  <div key={k} className="flex justify-between text-sm">
                    <span className={isRegression(k) ? 'text-[#DC2626]' : 'text-[#6B7280]'}>
                      {t(DIM_LABELS[k])}{isRegression(k) ? ' ⚠' : ''}
                    </span>
                    {hasData && delta != null
                      ? <span className={`font-mono ${delta >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>{sign(delta)}</span>
                      : <span className="font-mono text-[#C2C7D0]">—</span>
                    }
                  </div>
                )
              })}
            </div>

            {/* Radar chart */}
            <div
              className="rounded-xl border border-[#ECECF2] bg-white p-5 flex flex-col items-center"
              style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
            >
              <div className="text-sm font-medium text-[#15171E] mb-3 self-start">{t('compare.radarTitle')}</div>
              <RadarChart
                dataA={result.runA.dimMeans}
                dataB={result.runB.dimMeans}
                noDataA={noDataA}
                noDataB={noDataB}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
