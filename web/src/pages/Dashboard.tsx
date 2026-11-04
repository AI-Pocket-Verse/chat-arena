import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { api, type RunAggregate } from '../api'
import { BarChart, DonutChart, LineChart } from '../charts'
import { ErrorState } from '../error-state'
import { type RunRow, RunPicker } from '../run-picker'
import { useI18n, type MessageKey } from '../i18n'
import { useUi } from '../ui-store'

const DIM_LABELS: Record<string, MessageKey> = {
  personaFit: 'dashboard.dim.personaFit',
  empathy: 'dashboard.dim.empathy',
  memoryAccuracy: 'dashboard.dim.memoryAccuracy',
  safety: 'dashboard.dim.safety',
  naturalness: 'dashboard.dim.naturalness',
  relevance: 'dashboard.dim.relevance',
}

const TERMINAL_STATUSES = new Set(['finished', 'failed', 'stopped'])

// getRunTurns 原始结构（比 store 的 HydrateTurn 更全：含延迟/长度/维度分）
interface RawScore { overall: number | null; dimsJson?: string; violation?: boolean; memoryHit?: boolean | null; judgeError?: string | null }
interface RawTurn { idx: number; firstTokenMs?: number | null; totalMs?: number | null; replyLen?: number | null; errorType?: string | null; score?: RawScore | null }
interface RawSession { id: string; createdAt?: string; turns: RawTurn[] }

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function MetricChip({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="rounded-xl border border-[#ECECF2] bg-white px-4 py-3 flex flex-col gap-1"
      style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
    >
      <span className="text-[10px] uppercase tracking-widest text-[#9CA3AF]">{label}</span>
      <span className={`text-xl font-semibold font-mono ${accent ? 'text-[#1664FF]' : 'text-[#15171E]'}`}>{value}</span>
    </div>
  )
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div
      className="rounded-xl border border-[#ECECF2] bg-white p-5"
      style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
    >
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-sm font-medium text-[#15171E]">{title}</h3>
        {hint && <span className="text-[10px] text-[#9CA3AF]">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export function Dashboard() {
  const { t } = useI18n()
  const { runId, setRunId } = useUi()
  const [metrics, setMetrics] = useState<RunAggregate | null>(null)
  const [sessions, setSessions] = useState<RawSession[] | null>(null)
  const [runs, setRuns] = useState<RunRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // 可选 Run 列表（选择哪次评测的看板；与观战/报告页共享同一个全局 runId）
  useEffect(() => {
    let cancelled = false
    void (api.listRuns() as Promise<{ runs: RunRow[] }>)
      .then((res) => { if (!cancelled) setRuns(res.runs) })
      .catch(() => { /* 列表加载失败不阻塞看板本体 */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!runId) return
    const activeRunId = runId
    let stopped = false
    let timer: ReturnType<typeof setInterval> | null = null
    // 切换 run 时清空上一个 run 的数据，避免新数据到达前展示串台的图表
    setMetrics(null); setSessions(null)
    setLoading(true); setError(null)

    async function fetchOnce(): Promise<boolean> {
      try {
        const [m, runResp, turnsResp] = await Promise.all([
          api.getRunMetrics(activeRunId),
          api.getRun(activeRunId),
          api.getRunTurns(activeRunId),
        ])
        if (stopped) return true
        setMetrics(m as RunAggregate)
        setSessions((turnsResp as { sessions: RawSession[] }).sessions)
        const run = (runResp as { run: { status: string } }).run
        return TERMINAL_STATUSES.has(run?.status)
      } catch (e) {
        if (!stopped) setError(e)
        return true
      }
    }

    void fetchOnce().then((terminal) => {
      if (!stopped) setLoading(false)
      if (terminal || stopped) return
      timer = setInterval(() => { void fetchOnce().then((done) => { if (done && timer) clearInterval(timer) }) }, 5000)
    })

    return () => { stopped = true; if (timer) clearInterval(timer) }
  }, [runId])

  // 从原始 turns 派生序列与统计
  const d = useMemo(() => {
    const flat: RawTurn[] = []
    const order = [...(sessions ?? [])].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
    for (const s of order) for (const t of [...s.turns].sort((a, b) => a.idx - b.idx)) flat.push(t)

    const scored = flat.filter((t) => t.score && isNum(t.score.overall) && !t.score.judgeError)
    const scoreSeries = scored.map((t) => t.score!.overall as number)
    const latencySeries = flat.map((t) => t.firstTokenMs).filter(isNum)
    const totalMsArr = flat.map((t) => t.totalMs).filter(isNum)
    const replyLens = flat.map((t) => t.replyLen).filter(isNum)

    // 评分档位（饼图）
    const grades = { excellent: 0, good: 0, fair: 0, weak: 0 }
    for (const v of scoreSeries) {
      if (v >= 8) grades.excellent++
      else if (v >= 6) grades.good++
      else if (v >= 4) grades.fair++
      else grades.weak++
    }

    return {
      totalTurns: flat.length,
      sessionCount: order.length,
      scoredCount: scored.length,
      scoreSeries,
      latencySeries,
      maxScore: scoreSeries.length ? Math.max(...scoreSeries) : null,
      minScore: scoreSeries.length ? Math.min(...scoreSeries) : null,
      avgTotalMs: mean(totalMsArr),
      avgReplyLen: mean(replyLens),
      grades,
    }
  }, [sessions])

  const dimItems = useMemo(() => {
    if (!metrics) return []
    return Object.entries(metrics.dimMeans)
      .filter(([, v]) => isNum(v))
      .map(([k, v]) => {
        const key = DIM_LABELS[k]
        return { label: key ? t(key) : k, value: v as number }
      })
  }, [metrics, t])

  const gradeSlices = [
    { label: t('dashboard.grade.excellent'), value: d.grades.excellent, color: '#1664FF' },
    { label: t('dashboard.grade.good'), value: d.grades.good, color: '#36C5F0' },
    { label: t('dashboard.grade.fair'), value: d.grades.fair, color: '#FFB020' },
    { label: t('dashboard.grade.weak'), value: d.grades.weak, color: '#FF6B6B' },
  ]

  const hasRun = !!runId

  return (
    <div
      className="p-6 min-h-screen"
      style={{ background: 'radial-gradient(60rem 40rem at 90% -10%, rgba(22,100,255,0.05), transparent 60%), #ffffff' }}
    >
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h2 className="text-xl font-semibold text-[#15171E]">{t('dashboard.title')}</h2>
        <div className="w-72">
          <RunPicker runs={runs} value={runId ?? ''} onChange={setRunId} placeholder={t('dashboard.runPlaceholder')} />
        </div>
      </div>
      {!hasRun && <p className="text-[#6B7280] text-sm">{t('dashboard.noRun')}</p>}
      {hasRun && loading && !metrics && <p className="text-[#6B7280] text-sm">{t('app.loading')}</p>}
      {error != null && <ErrorState error={error} title={t('dashboard.loadFailed')} className="mb-4 max-w-2xl" />}

      {metrics && (
        <div className="space-y-6">
          {/* 顶部指标卡 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricChip label={t('dashboard.metric.sessions')} value={String(d.sessionCount)} />
            <MetricChip label={t('dashboard.metric.turns')} value={String(d.totalTurns || metrics.turnCount)} />
            <MetricChip label={t('dashboard.metric.scoreCoverage')} value={d.totalTurns ? `${Math.round((d.scoredCount / d.totalTurns) * 100)}%` : '—'} />
            <MetricChip label={t('dashboard.metric.avgOverall')} accent value={metrics.avgOverall != null ? `${metrics.avgOverall.toFixed(2)}` : '—'} />
            <MetricChip label={t('dashboard.metric.maxScore')} value={d.maxScore != null ? d.maxScore.toFixed(1) : '—'} />
            <MetricChip label={t('dashboard.metric.minScore')} value={d.minScore != null ? d.minScore.toFixed(1) : '—'} />
            <MetricChip label={t('dashboard.metric.avgFirstToken')} value={metrics.avgFirstTokenMs != null ? `${Math.round(metrics.avgFirstTokenMs)}ms` : '—'} />
            <MetricChip label={t('dashboard.metric.avgTurnTime')} value={d.avgTotalMs != null ? `${Math.round(d.avgTotalMs)}ms` : '—'} />
            <MetricChip label={t('dashboard.metric.avgReplyLen')} value={d.avgReplyLen != null ? String(Math.round(d.avgReplyLen)) : '—'} />
            <MetricChip label={t('dashboard.metric.memoryHit')} value={metrics.memoryHitRate != null ? `${(metrics.memoryHitRate * 100).toFixed(0)}%` : '—'} />
            <MetricChip label={t('dashboard.metric.errorRate')} value={`${(metrics.errorRate * 100).toFixed(1)}%`} />
            <MetricChip label={t('dashboard.metric.violations')} value={String(metrics.violationCount)} />
          </div>

          {/* 折线（每轮综合分趋势） + 饼图（评分档位占比） */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2">
              <Card title={t('dashboard.card.scoreTrend')} hint={t('dashboard.card.scoreTrendHint', { n: d.scoredCount })}>
                <LineChart values={d.scoreSeries} max={10} height={220} valueFmt={(v) => v.toFixed(0)} />
              </Card>
            </div>
            <Card title={t('dashboard.card.gradeShare')} hint={t('dashboard.card.gradeShareHint', { n: d.scoredCount })}>
              <DonutChart
                slices={gradeSlices}
                centerValue={metrics.avgOverall != null ? metrics.avgOverall.toFixed(1) : '—'}
                centerLabel={t('dashboard.card.avgScore')}
              />
            </Card>
          </div>

          {/* 柱状（各维度均值） + 折线（首字延迟趋势） */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card title={t('dashboard.card.dimMeans')} hint={t('dashboard.card.dimMeansHint')}>
              <BarChart items={dimItems} max={10} height={220} />
            </Card>
            <Card title={t('dashboard.card.latencyTrend')} hint={d.latencySeries.length ? t('dashboard.card.latencyTrendHint', { n: d.latencySeries.length }) : undefined}>
              <LineChart
                values={d.latencySeries}
                max={Math.max(500, ...(d.latencySeries.length ? [Math.ceil(Math.max(...d.latencySeries) / 100) * 100] : []))}
                color="#00C2A8"
                height={220}
                unit="ms"
                valueFmt={(v) => String(Math.round(v))}
              />
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
