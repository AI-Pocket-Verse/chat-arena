import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { renderToStaticMarkup } from 'react-dom/server'
import { api, type ReportRow } from '../api'
import { ConfirmDialog } from '../confirm-dialog'
import { ErrorState } from '../error-state'
import { useI18n } from '../i18n'
import { parseReport, type ReportData, ReportView } from '../report-view'
import { type RunRow, RunPicker } from '../run-picker'
import { useUi } from '../ui-store'
import { UserTag } from '../user-tag'

// 可生成报告的「已完成评测」：finished 正常结束 + stopped 手动终止（都有内容、可出报告）。
const TERMINAL = new Set(['finished', 'stopped'])

const MD_CLS = `rounded-xl border border-[#ECECF2] bg-white p-5 overflow-auto max-h-[68vh]
  [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-[#15171E] [&_h1]:mb-3 [&_h1]:mt-5
  [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-[#1664FF] [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:border-b [&_h2]:border-[#ECECF2] [&_h2]:pb-1
  [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-[#4D8AFF] [&_h3]:mb-1 [&_h3]:mt-3
  [&_p]:text-sm [&_p]:text-[#374151] [&_p]:leading-relaxed [&_p]:mb-2
  [&_strong]:text-[#15171E] [&_strong]:font-semibold
  [&_em]:text-[#6B7280] [&_em]:italic
  [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ul]:mb-2
  [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_ol]:mb-2
  [&_li]:text-sm [&_li]:text-[#374151]
  [&_code]:bg-[#F7F8FB] [&_code]:text-[#1664FF] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_code]:border [&_code]:border-[#ECECF2]
  [&_pre]:bg-[#F7F8FB] [&_pre]:border [&_pre]:border-[#ECECF2] [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:overflow-auto [&_pre]:mb-2
  [&_pre_code]:bg-transparent [&_pre_code]:text-[#15171E] [&_pre_code]:p-0 [&_pre_code]:border-0
  [&_blockquote]:border-l-2 [&_blockquote]:border-[#1664FF] [&_blockquote]:pl-3 [&_blockquote]:text-[#6B7280] [&_blockquote]:italic [&_blockquote]:mb-2
  [&_hr]:border-[#E8E8EE] [&_hr]:my-4`

// 生成中的占位动画：旋转光环 + 预估进度条。由 reportGenerating 驱动，
// 生成完成（成功或失败）后状态复位，面板自动消失。
// 进度说明：耗时几乎全在一次 LLM 综合分析调用上，服务端拿不到真实进度，
// 因此按典型耗时做渐近预估（前快后慢逼近 95%），完成时直接展示报告。
function GeneratingPanel() {
  const { t } = useI18n()
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const t0 = Date.now()
    const timer = setInterval(() => {
      const sec = (Date.now() - t0) / 1000
      // τ≈9s:9 秒约 60%,18 秒约 82%,之后缓慢爬向 95% 等待真实完成
      setPct(Math.min(95, Math.round(95 * (1 - Math.exp(-sec / 9)))))
    }, 200)
    return () => clearInterval(timer)
  }, [])
  const stage =
    pct < 20 ? t('reports.gen.stage1')
      : pct < 45 ? t('reports.gen.stage2')
        : pct < 90 ? t('reports.gen.stage3')
          : t('reports.gen.stage4')
  return (
    <div
      className="rounded-xl border border-[#ECECF2] bg-white px-8 py-14 flex flex-col items-center"
      style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
    >
      {/* 旋转光环（中心显示百分比） */}
      <div className="relative w-20 h-20 mb-5">
        <div className="absolute inset-0 rounded-full border-4 border-[#1664FF]/15 border-t-[#1664FF] animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-semibold font-mono text-[#1664FF]">{pct}%</span>
        </div>
      </div>
      <div className="text-sm font-medium text-[#15171E] mb-1">{t('reports.gen.title')}</div>
      <div className="text-xs text-[#9CA3AF] mb-6">{stage}</div>
      {/* 预估进度条 */}
      <div className="w-full max-w-md">
        <div className="h-1.5 rounded-full bg-[#1664FF]/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #1664FF, #5B9CFF)' }}
          />
        </div>
        <div className="mt-2 text-center text-[10px] text-[#C2C7D0]">{t('reports.gen.note')}</div>
      </div>
    </div>
  )
}

function fmtDate(s: string, locale: string): string {
  try {
    // 固定北京时间展示,与运行环境/访问者时区无关。
    return new Date(s).toLocaleString(locale, { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

// 列表项均分配色（与报告视图 scoreColor 同档位）
function avgColor(v: number): string {
  if (v >= 8) return '#1664FF'
  if (v >= 6) return '#36C5F0'
  if (v >= 4) return '#FFB020'
  return '#FF6B6B'
}

// 把报告 Markdown 渲染结果包成带内嵌样式的独立 HTML 文档（下载用）
function buildReportHtml(title: string, bodyHtml: string, locale: string): string {
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { max-width: 860px; margin: 0 auto; padding: 32px 24px; color: #374151;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 14px; line-height: 1.7; background: #fff; }
  h1 { font-size: 22px; color: #15171E; border-bottom: 2px solid #1664FF; padding-bottom: 8px; }
  h2 { font-size: 17px; color: #1664FF; border-bottom: 1px solid #ECECF2; padding-bottom: 4px; margin-top: 28px; }
  h3 { font-size: 14px; color: #4D8AFF; margin-top: 20px; }
  strong { color: #15171E; }
  em { color: #6B7280; }
  ul, ol { padding-left: 22px; }
  code { background: #F7F8FB; color: #1664FF; padding: 1px 5px; border-radius: 4px;
    border: 1px solid #ECECF2; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { background: #F7F8FB; border: 1px solid #ECECF2; border-radius: 8px; padding: 12px; overflow: auto; }
  pre code { background: transparent; color: #15171E; border: 0; padding: 0; }
  blockquote { border-left: 3px solid #1664FF; margin: 0; padding-left: 12px; color: #6B7280; font-style: italic; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #ECECF2; padding: 6px 10px; text-align: left; font-size: 13px; }
  th { background: #F7F8FB; color: #15171E; }
  hr { border: 0; border-top: 1px solid #E8E8EE; margin: 24px 0; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`
}

export function Reports() {
  const { t, locale } = useI18n()
  const { reportGenerating, setReportGenerating } = useUi()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [runs, setRuns] = useState<RunRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [showMd, setShowMd] = useState(false)
  const [viewRunId, setViewRunId] = useState<string | null>(null)
  const [pickRunId, setPickRunId] = useState('')
  const [error, setError] = useState<unknown>(null)
  // 管理员（手机号命中 ADMIN_MOBILES）才显示删除入口；后端独立鉴权兜底
  const [isAdmin, setIsAdmin] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ReportRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.getMe()
      .then((r) => { if (!cancelled) setIsAdmin(r.isAdmin) })
      .catch(() => { /* 接口失败按非管理员处理 */ })
    return () => { cancelled = true }
  }, [])

  async function confirmDeleteReport() {
    const r = pendingDelete
    if (!r) return
    setDeleting(true)
    try {
      await api.deleteReport(r.id)
      // 删的是正在查看的报告 → 清空右侧查看器
      if (r.id === selectedId) {
        setSelectedId(null); setMarkdown(null); setReportData(null); setViewRunId(null)
      }
      await Promise.all([loadList(), loadRuns()])  // runs 一起刷新：该评测重新变为「可生成」
    } catch (e) {
      setError(e)
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }

  const loadList = useCallback(async () => {
    try {
      const { reports: rows } = await api.listReports()
      setReports(rows)
      return rows
    } catch (e) { setError(e); return [] }
  }, [])

  const loadRuns = useCallback(async () => {
    try {
      const { runs: rows } = (await api.listRuns()) as { runs: RunRow[] }
      setRuns(rows)
      return rows
    } catch { return [] as RunRow[] }
  }, [])

  useEffect(() => { void loadList(); void loadRuns() }, [loadList, loadRuns])

  const reportedRunIds = useMemo(() => new Set(reports.map((r) => r.runId)), [reports])
  // 最新评测 = 最近一次「已完成」评测（runs 按 createdAt 倒序，[0]即最近）
  const latestTerminal = useMemo(() => runs.find((r) => TERMINAL.has(r.status)) ?? null, [runs])
  const latestHasReport = latestTerminal ? reportedRunIds.has(latestTerminal.id) : false
  // 下拉可选：已完成且尚未生成过报告的评测
  const eligibleRuns = useMemo(
    () => runs.filter((r) => TERMINAL.has(r.status) && !reportedRunIds.has(r.id)),
    [runs, reportedRunIds],
  )

  const openReport = useCallback(async (id: string) => {
    setSelectedId(id); setError(null)
    try {
      const { report } = await api.getReportById(id)
      setMarkdown(report.markdown)
      setReportData(parseReport(report.json))
      setViewRunId(report.runId)
      setShowMd(false)
    } catch (e) { setError(e) }
  }, [])

  async function generateFor(targetRunId: string | null) {
    if (!targetRunId || reportGenerating) return
    setReportGenerating(true); setError(null)
    try {
      const { reportId } = await api.generateReport(targetRunId)
      const [rows] = await Promise.all([loadList(), loadRuns()])
      const target = rows.find((r) => r.id === reportId) ?? rows.find((r) => r.runId === targetRunId)
      if (target) await openReport(target.id)
      setPickRunId('')
    } catch (e) { setError(e) }
    finally { setReportGenerating(false) }
  }

  function download(format: 'md' | 'html') {
    if (!viewRunId || markdown == null) return
    try {
      const title = reports.find((r) => r.id === selectedId)?.runName?.trim() || t('reports.title')
      const content = format === 'md'
        ? markdown
        : buildReportHtml(title, renderToStaticMarkup(<ReactMarkdown>{markdown}</ReactMarkdown>), locale)
      const blob = new Blob([content], { type: format === 'md' ? 'text/markdown' : 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `report-${viewRunId}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setError(e) }
  }

  return (
    <div
      className="p-6 min-h-screen"
      style={{ background: 'radial-gradient(50rem 30rem at 100% -8%, rgba(22,100,255,0.05), transparent 60%), #ffffff' }}
    >
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h2 className="text-xl font-semibold text-[#15171E]">{t('reports.title')}</h2>
        <div className="flex items-center gap-2">
          {/* 选某个「已完成且未生成报告」的评测生成 */}
          <div className="w-60">
            <RunPicker
              runs={eligibleRuns}
              value={pickRunId}
              onChange={setPickRunId}
              placeholder={t('reports.pickRun')}
            />
          </div>
          <button
            className="px-4 py-2 rounded-xl text-sm font-medium border border-[#E8E8EE] bg-white text-[#15171E] hover:border-[#1664FF]/40 disabled:opacity-40 transition-colors"
            disabled={!pickRunId || reportGenerating}
            onClick={() => void generateFor(pickRunId)}
          >
            {t('reports.generate')}
          </button>

          {/* 最新一次评测的报告 */}
          <button
            className="px-4 py-2 rounded-xl text-sm text-white font-medium transition-opacity disabled:opacity-40 inline-flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, #1664FF, #5B9CFF)' }}
            disabled={!latestTerminal || latestHasReport || reportGenerating}
            title={
              !latestTerminal ? t('reports.noFinishedRun')
                : latestHasReport ? t('reports.latestDone')
                : undefined
            }
            onClick={() => void generateFor(latestTerminal?.id ?? null)}
          >
            {reportGenerating && <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
            {reportGenerating ? t('reports.generating') : t('reports.generateLatest')}
          </button>
        </div>
      </div>

      {error != null && <ErrorState error={error} title={t('reports.actionFailed')} className="mb-4 max-w-2xl" />}

      <div className="flex gap-5 items-start">
        {/* 左：历史报告列表（整列吸顶，选中项在列表内置顶） */}
        <div className="w-72 shrink-0 sticky top-4 self-start">
          <div className="text-[10px] uppercase tracking-widest text-[#C2C7D0] font-mono mb-2 px-1">{t('reports.history')}</div>
          {reports.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#E8E8EE] px-4 py-8 text-center text-xs text-[#9CA3AF]">
              {t('reports.historyEmpty')}
            </div>
          ) : (
            <div className="space-y-1.5 overflow-auto max-h-[calc(100vh-11rem)] pr-1">
              {reports.map((r) => {
                const sel = r.id === selectedId
                return (
                  <div
                    key={r.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void openReport(r.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openReport(r.id) } }}
                    className={[
                      'group w-full text-left rounded-xl border px-3 py-2.5 transition-colors cursor-pointer',
                      sel
                        ? 'sticky top-0 z-10 border-[#1664FF]/50 bg-[#EEF4FF] shadow-sm'
                        : 'border-[#ECECF2] bg-white hover:border-[#1664FF]/40 hover:bg-[#1664FF]/[0.02]',
                    ].join(' ')}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0 text-sm text-[#15171E] leading-snug break-words line-clamp-3">{r.runName?.trim() || t('reports.unnamedRun')}</div>
                      {r.avgOverall != null && (
                        <span className="shrink-0 inline-flex items-baseline gap-0.5" title={t('reports.avgOverall')}>
                          <span className="text-sm font-bold font-mono" style={{ color: avgColor(r.avgOverall) }}>{r.avgOverall.toFixed(1)}</span>
                          <span className="text-[9px] text-[#C2C7D0]">/10</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center flex-wrap gap-1.5 mt-1">
                      {r.targetLabel && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1664FF]/10 text-[#1664FF] shrink-0 max-w-full truncate">{r.targetLabel}</span>}
                      <UserTag name={r.createdByName} />
                      <span className="text-[10px] text-[#9CA3AF] font-mono shrink-0">{fmtDate(r.createdAt, locale)}</span>
                      {/* 删除：仅管理员可见；悬停浮现，避免误触 */}
                      {isAdmin && (
                        <button
                          type="button"
                          title={t('reports.delete')}
                          aria-label={t('reports.delete')}
                          onClick={(e) => { e.stopPropagation(); setPendingDelete(r) }}
                          className="ml-auto shrink-0 p-1 rounded-md text-[#C2C7D0] opacity-0 group-hover:opacity-100 focus:opacity-100 group-focus-within:opacity-100 hover:text-[#DC2626] hover:bg-[#DC2626]/8 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 右：报告内容（生成期间整区显示生成动画，完成后展示新报告） */}
        <div className="flex-1 min-w-0">
          {reportGenerating ? (
            <GeneratingPanel />
          ) : markdown ? (
            <>
              <div className="flex items-center gap-2 mb-3">
                {/* 视图切换：图表 / Markdown */}
                {reportData && (
                  <div className="mr-auto flex items-center gap-0.5 bg-white border border-[#ECECF2] rounded-lg p-0.5">
                    {([[t('reports.viewChart'), false], ['Markdown', true]] as const).map(([label, md]) => (
                      <button
                        key={String(md)}
                        onClick={() => setShowMd(md)}
                        className={`px-3 py-1 rounded-md text-xs transition-colors ${showMd === md ? 'bg-[#1664FF] text-white' : 'text-[#6B7280] hover:text-[#15171E]'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  className="px-3 py-1.5 rounded-lg text-xs border border-[#E8E8EE] bg-white text-[#6B7280] hover:text-[#15171E] transition-colors"
                  onClick={() => download('md')}
                >
                  {t('reports.downloadMd')}
                </button>
                <button
                  className="px-3 py-1.5 rounded-lg text-xs border border-[#E8E8EE] bg-white text-[#6B7280] hover:text-[#15171E] transition-colors"
                  onClick={() => download('html')}
                >
                  {t('reports.downloadHtml')}
                </button>
              </div>
              {reportData && !showMd ? (
                <ReportView data={reportData} />
              ) : (
                <div className={MD_CLS} style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}>
                  <ReactMarkdown>{markdown}</ReactMarkdown>
                </div>
              )}
            </>
          ) : (
            <div className="mt-10 flex justify-center text-center text-sm text-[#9CA3AF]">
              {reports.length === 0
                ? t('reports.placeholderEmpty')
                : t('reports.placeholderSelect')}
            </div>
          )}
        </div>
      </div>

      {/* 删除报告确认（仅管理员入口可触达） */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('reports.deleteTitle')}
        message={pendingDelete ? (
          <>
            {t('reports.deleteMessage', { name: pendingDelete.runName?.trim() || t('reports.unnamedRun') })}
            <br />
            <span className="text-xs text-[#9CA3AF]">{t('reports.deleteNote')}</span>
          </>
        ) : null}
        confirmText={t('reports.deleteConfirm')}
        danger
        loading={deleting}
        onConfirm={() => void confirmDeleteReport()}
        onCancel={() => { if (!deleting) setPendingDelete(null) }}
      />
    </div>
  )
}
