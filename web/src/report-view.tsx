import { type ReactNode, useState } from 'react'
import { DonutChart, LineChart, RadarChart } from './charts'

// 评测报告的可视化视图（图表 + 卡片），数据来自报告 JSON 快照。

export interface ReportTurn {
  idx: number
  sessionId?: string
  personaName?: string
  repetitionIndex?: number
  userText: string
  targetText: string
  overall: number
  comment: string
  improvementSuggestion: string
  dims: Record<string, number>
  violation: boolean
  judgeError?: string | null
}
export interface ReportDimension { key: string; name: string; score: number | null; assessment: string; suggestion: string }
export interface ReportData {
  runId: string
  totalSessions: number
  totalTurns: number
  scoredTurns: number
  judgeFailedCount: number
  avgOverall: number | null
  violations: number
  memoryHitRate: number | null
  memoryMisses: number
  overallAssessment: string
  dimensions: ReportDimension[]
  distribution: { excellent: number; good: number; fair: number; weak: number }
  strengths: string[]
  weaknesses: string[]
  promptChanges: string
  originalPrompt: string | null
  revisedPrompt: string
  memoryIssues: string
  safetyIssues: string
  prioritizedActions: string[]
  worstTurns: ReportTurn[]
  bestTurns: ReportTurn[]
  violationTurns: ReportTurn[]
  dimMeans: Record<string, number | null>
  scoreSeries: number[]
}

export function parseReport(json: string): ReportData | null {
  try {
    const d = JSON.parse(json) as Partial<ReportData>
    if (!Array.isArray(d.dimensions)) return null
    return {
      runId: d.runId ?? '',
      totalSessions: d.totalSessions ?? 0,
      totalTurns: d.totalTurns ?? 0,
      scoredTurns: d.scoredTurns ?? d.totalTurns ?? 0,
      judgeFailedCount: d.judgeFailedCount ?? 0,
      avgOverall: d.avgOverall ?? null,
      violations: d.violations ?? 0,
      memoryHitRate: d.memoryHitRate ?? null,
      memoryMisses: d.memoryMisses ?? 0,
      overallAssessment: d.overallAssessment ?? '',
      dimensions: d.dimensions ?? [],
      distribution: d.distribution ?? { excellent: 0, good: 0, fair: 0, weak: 0 },
      strengths: d.strengths ?? [],
      weaknesses: d.weaknesses ?? [],
      promptChanges: d.promptChanges ?? '',
      originalPrompt: d.originalPrompt ?? null,
      revisedPrompt: d.revisedPrompt ?? '',
      memoryIssues: d.memoryIssues ?? '',
      safetyIssues: d.safetyIssues ?? '',
      prioritizedActions: d.prioritizedActions ?? [],
      worstTurns: d.worstTurns ?? [],
      bestTurns: d.bestTurns ?? [],
      violationTurns: d.violationTurns ?? [],
      dimMeans: d.dimMeans ?? {},
      scoreSeries: d.scoreSeries ?? [],
    }
  } catch { return null }
}

const cardShadow = { boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function Card({ id, title, hint, children, className = '' }: { id?: string; title?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div id={id} className={`rounded-xl border border-[#ECECF2] bg-white p-5 scroll-mt-20 ${className}`} style={cardShadow}>
      {title && (
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#15171E]">{title}</h3>
          {hint && <span className="text-[10px] text-[#9CA3AF]">{hint}</span>}
        </div>
      )}
      {children}
    </div>
  )
}

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-[#ECECF2] bg-white px-4 py-3 flex flex-col gap-1" style={cardShadow}>
      <span className="text-[10px] uppercase tracking-widest text-[#9CA3AF]">{label}</span>
      <span className={`text-xl font-semibold font-mono ${accent ? 'text-[#1664FF]' : 'text-[#15171E]'}`}>{value}</span>
    </div>
  )
}

function scoreColor(v: number): string {
  if (v >= 8) return '#1664FF'
  if (v >= 6) return '#36C5F0'
  if (v >= 4) return '#FFB020'
  return '#FF6B6B'
}

const DIM_ORDER = ['personaFit', 'empathy', 'memoryAccuracy', 'safety', 'naturalness', 'relevance']
const DIM_NAMES: Record<string, string> = {
  personaFit: '人设贴合', empathy: '情感共情', memoryAccuracy: '记忆准确',
  safety: '安全合规', naturalness: '自然流畅', relevance: '相关性',
}

function turnTag(t: ReportTurn): string {
  const persona = t.personaName?.trim() || '会话'
  const rep = typeof t.repetitionIndex === 'number' ? ` · 重复#${t.repetitionIndex + 1}` : ''
  return `${persona}${rep} · 第 ${t.idx + 1} 轮`
}
const turnKey = (t: ReportTurn, p: string) => `${p}-${t.sessionId ?? ''}-${t.idx}`

function TurnCard({ t }: { t: ReportTurn }) {
  const dimChips = DIM_ORDER.filter(k => fin(t.dims[k])).map(k => `${DIM_NAMES[k] ?? k} ${t.dims[k]}`)
  return (
    <div className="rounded-xl border border-[#ECECF2] bg-white p-4" style={cardShadow}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-[10px] uppercase tracking-widest text-[#C2C7D0] font-mono truncate">{turnTag(t)}</span>
        <span className="inline-flex items-baseline gap-1 shrink-0">
          <span className="text-lg font-bold font-mono" style={{ color: scoreColor(t.overall) }}>{t.overall.toFixed(1)}</span>
          <span className="text-[10px] text-[#9CA3AF]">/ 10</span>
          {t.violation && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-[#DC2626]/10 text-[#DC2626]">违规</span>}
        </span>
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="text-[#15171E]"><span className="text-[#9CA3AF] mr-1">用户</span>{t.userText}</div>
        <div className="text-[#15171E]"><span className="text-[#1664FF] mr-1 font-medium">被测 AI</span>{t.targetText}</div>
      </div>
      {dimChips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {dimChips.map(c => <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-[#F1F3F9] text-[#6B7280] font-mono">{c}</span>)}
        </div>
      )}
      {t.comment && <div className="mt-2 text-xs text-[#6B7280]">{t.comment}</div>}
      {t.improvementSuggestion && (
        <div className="mt-1 text-xs text-[#9CA3AF]"><span className="text-[#1664FF] font-medium mr-1">改进</span>{t.improvementSuggestion}</div>
      )}
    </div>
  )
}

// 违规清单：超过 5 条分页显示（父级用 key 在切换报告时重置页码）
const VIOLATIONS_PER_PAGE = 5

function ViolationList({ turns }: { turns: ReportTurn[] }) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(turns.length / VIOLATIONS_PER_PAGE))
  const cur = Math.min(page, pageCount - 1)
  const slice = turns.slice(cur * VIOLATIONS_PER_PAGE, (cur + 1) * VIOLATIONS_PER_PAGE)
  const pagerBtn = 'px-2.5 py-1 rounded-lg text-xs border border-[#E8E8EE] bg-white text-[#6B7280] hover:text-[#15171E] hover:border-[#1664FF]/40 disabled:opacity-40 disabled:hover:border-[#E8E8EE] disabled:hover:text-[#6B7280] transition-colors'
  return (
    <div className="mt-3 space-y-2">
      <div className="text-xs font-medium text-[#DC2626]">违规清单（{turns.length}）</div>
      {slice.map(t => <TurnCard key={turnKey(t, 'v')} t={t} />)}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <button type="button" className={pagerBtn} disabled={cur === 0} onClick={() => setPage(cur - 1)}>上一页</button>
          <span className="text-xs text-[#9CA3AF] font-mono">{cur + 1} / {pageCount}</span>
          <button type="button" className={pagerBtn} disabled={cur >= pageCount - 1} onClick={() => setPage(cur + 1)}>下一页</button>
        </div>
      )}
    </div>
  )
}

// 行级 diff（LCS）：标出原始/修订版中变化的行。
function lineDiff(a: string, b: string): { aCommon: boolean[]; bCommon: boolean[]; aLines: string[]; bLines: string[] } {
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  const m = aLines.length, n = bLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
    dp[i]![j] = aLines[i] === bLines[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
  }
  const aCommon = new Array(m).fill(false)
  const bCommon = new Array(n).fill(false)
  let i = 0, j = 0
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) { aCommon[i] = true; bCommon[j] = true; i++; j++ }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++
    else j++
  }
  return { aCommon, bCommon, aLines, bLines }
}

function PromptDiff({ original, revised }: { original: string; revised: string }) {
  const { aCommon, bCommon, aLines, bLines } = lineDiff(original, revised)
  const pane = (lines: string[], common: boolean[], side: 'l' | 'r') => (
    <pre className="flex-1 min-w-0 text-xs leading-relaxed bg-[#F7F8FB] border border-[#ECECF2] rounded-lg p-3 overflow-auto max-h-[50vh] whitespace-pre-wrap break-words font-mono">
      {lines.map((ln, i) => (
        <div
          key={i}
          className={!common[i]
            ? (side === 'l' ? 'bg-[#DC2626]/10 text-[#DC2626] line-through decoration-[#DC2626]/40' : 'bg-[#DC2626]/10 text-[#DC2626]')
            : 'text-[#374151]'}
        >
          {ln || ' '}
        </div>
      ))}
    </pre>
  )
  return (
    <div className="flex flex-col lg:flex-row gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-[#9CA3AF] mb-1">原始角色 Prompt</div>
        {pane(aLines, aCommon, 'l')}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] text-[#9CA3AF] mb-1">修订版（<span className="text-[#DC2626]">标红=改动</span>）</div>
        {pane(bLines, bCommon, 'r')}
      </div>
    </div>
  )
}

// 锚点导航
const ANCHORS: Array<{ id: string; label: string }> = [
  { id: 'sec-overall', label: '总体评价' },
  { id: 'sec-dims', label: '各维度评估' },
  { id: 'sec-dist', label: '评分分布' },
  { id: 'sec-sw', label: '亮点 / 问题' },
  { id: 'sec-actions', label: '优先改进' },
  { id: 'sec-prompt', label: 'Prompt 修订' },
  { id: 'sec-safety', label: '安全与边界' },
  { id: 'sec-replay', label: '回放样例' },
]

export function ReportView({ data }: { data: ReportData }) {
  const radarItems = data.dimensions.map(d => ({ label: d.name, value: fin(d.score) ? d.score : null }))
  const distSlices = [
    { label: '优秀 (≥8)', value: data.distribution.excellent, color: '#1664FF' },
    { label: '良好 [6,8)', value: data.distribution.good, color: '#36C5F0' },
    { label: '一般 [4,6)', value: data.distribution.fair, color: '#FFB020' },
    { label: '偏弱 (<4)', value: data.distribution.weak, color: '#FF6B6B' },
  ]
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="space-y-5">
      {/* 锚点 tag 条：上滑时吸顶，#前缀 + 蓝色标签风格 */}
      <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-white/85 backdrop-blur flex flex-wrap gap-1.5 rounded-b-lg">
        {ANCHORS.map(a => (
          <button
            key={a.id}
            onClick={() => jump(a.id)}
            className="text-xs px-2.5 py-1 rounded-full border border-[#1664FF]/20 bg-[#1664FF]/[0.06] text-[#1664FF] font-medium hover:bg-[#1664FF]/[0.12] hover:border-[#1664FF]/40 transition-colors"
          >
            <span className="text-[#1664FF]/55 mr-0.5">#</span>{a.label}
          </button>
        ))}
      </div>

      {/* 概览指标 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Chip label="平均综合分" accent value={data.avgOverall != null ? data.avgOverall.toFixed(2) : '—'} />
        <Chip label="会话数" value={String(data.totalSessions)} />
        <Chip label="有效评分" value={`${data.scoredTurns}/${data.totalTurns}`} />
        <Chip label="违规数" value={String(data.violations)} />
        <Chip label="记忆命中" value={data.memoryHitRate != null ? `${(data.memoryHitRate * 100).toFixed(0)}%` : '—'} />
        <Chip label="裁判失败" value={String(data.judgeFailedCount)} />
      </div>

      {/* 总体评价 */}
      {data.overallAssessment.trim() && (
        <Card id="sec-overall" title="总体评价">
          <p className="text-sm text-[#374151] leading-relaxed whitespace-pre-wrap">{data.overallAssessment}</p>
        </Card>
      )}

      {/* 评分档位占比 + 综合分趋势（维度均分挪到下方雷达，给档位图留足空间） */}
      <div id="sec-dist" className="grid grid-cols-1 lg:grid-cols-2 gap-5 scroll-mt-20">
        <Card title="评分档位占比" hint={`有效评分 ${data.scoredTurns} 轮`}>
          <DonutChart slices={distSlices} centerValue={data.avgOverall != null ? data.avgOverall.toFixed(1) : '—'} centerLabel="平均分" />
        </Card>
        <Card title="每轮综合分趋势" hint={data.scoreSeries.length > 1 ? `${data.scoreSeries.length} 轮 · 跨会话拼接` : undefined}>
          {data.scoreSeries.length > 1
            ? <LineChart values={data.scoreSeries} max={10} height={200} valueFmt={(v) => v.toFixed(0)} />
            : <div className="flex items-center justify-center text-xs text-[#9CA3AF]" style={{ height: 200 }}>评分轮数不足</div>}
        </Card>
      </div>

      {/* 各维度评估：仅雷达图（满分 10） */}
      <Card id="sec-dims" title="各维度评估" hint="满分 10">
        <div className="max-w-[420px] mx-auto w-full"><RadarChart items={radarItems} max={10} size={240} /></div>
      </Card>

      {/* 亮点 / 主要问题 */}
      <div id="sec-sw" className="grid grid-cols-1 sm:grid-cols-2 gap-5 scroll-mt-20">
        <Card title="亮点">
          {data.strengths.length ? (
            <ul className="space-y-1.5">{data.strengths.map((s, i) => <li key={i} className="text-sm text-[#374151] flex gap-2"><span className="text-[#059669] shrink-0">✓</span>{s}</li>)}</ul>
          ) : <p className="text-xs text-[#9CA3AF]">（无）</p>}
        </Card>
        <Card title="主要问题">
          {data.weaknesses.length ? (
            <ul className="space-y-1.5">{data.weaknesses.map((s, i) => <li key={i} className="text-sm text-[#374151] flex gap-2"><span className="text-[#DC2626] shrink-0">!</span>{s}</li>)}</ul>
          ) : <p className="text-xs text-[#9CA3AF]">（无）</p>}
        </Card>
      </div>

      {/* 优先改进清单 */}
      {data.prioritizedActions.length > 0 && (
        <Card id="sec-actions" title="优先改进清单">
          <ol className="space-y-2">
            {data.prioritizedActions.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm text-[#374151]">
                <span className="shrink-0 w-5 h-5 rounded-full bg-[#1664FF]/10 text-[#1664FF] text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                <span className="leading-relaxed">{s}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* 角色 Prompt 修订建议（左原始 / 右修订，标红 diff） */}
      <Card id="sec-prompt" title="角色 Prompt 修订建议">
        {data.promptChanges.trim() && <p className="text-sm text-[#374151] leading-relaxed whitespace-pre-wrap mb-4">{data.promptChanges}</p>}
        {data.originalPrompt && data.revisedPrompt
          ? <PromptDiff original={data.originalPrompt} revised={data.revisedPrompt} />
          : data.originalPrompt
            ? <div className="text-xs text-[#9CA3AF]">未生成修订版（LLM 不可用或未启用）。</div>
            : <div className="text-xs text-[#9CA3AF]">未能获取角色原始 Prompt（被测后端不可达），仅显示上面的文字改动建议。</div>}
      </Card>

      {/* 记忆 + 安全与边界（含违规清单） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="记忆系统"><p className="text-sm text-[#374151] leading-relaxed whitespace-pre-wrap">{data.memoryIssues.trim() || '无'}</p></Card>
        <Card id="sec-safety" title="安全与边界" hint={`违规 ${data.violationTurns.length}`}>
          <p className="text-sm text-[#374151] leading-relaxed whitespace-pre-wrap">{data.safetyIssues.trim() || '无'}</p>
          {data.violationTurns.length > 0 && <ViolationList key={data.runId} turns={data.violationTurns} />}
        </Card>
      </div>

      {/* 低分回放 / 高分样例 */}
      <div id="sec-replay" className="space-y-5 scroll-mt-20">
        {data.worstTurns.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-[#15171E] mb-2">低分回放（Top {data.worstTurns.length}）</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{data.worstTurns.map(t => <TurnCard key={turnKey(t, 'w')} t={t} />)}</div>
          </div>
        )}
        {data.bestTurns.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-[#15171E] mb-2">高分样例（Top {data.bestTurns.length}）</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{data.bestTurns.map(t => <TurnCard key={turnKey(t, 'b')} t={t} />)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
