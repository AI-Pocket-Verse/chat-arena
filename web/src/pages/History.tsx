import { Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type TargetRole, type PersonaRow, type RunAggregate } from '../api'
import { useUi } from '../ui-store'
import { UserTag } from '../user-tag'

// 历史 Run 列表：选中某条 → 写入 sessionStorage('runId') 并跳转观战页回放。
// 观战/看板/报告读的都是同一个 sessionStorage('runId')，因此切换 run 全局联动。

interface RunRow {
  id: string
  name: string | null
  targetLabel: string | null
  taGender: number
  userModel: string
  judgeModel: string
  status: string
  summaryJson: string | null
  createdByName: string | null
  createdAt: string
}

function runStatusBadge(status: string): { text: string; cls: string } {
  switch (status) {
    case 'finished': return { text: '已完成', cls: 'bg-[#059669]/10 text-[#059669]' }
    case 'failed': return { text: '失败', cls: 'bg-[#DC2626]/10 text-[#DC2626]' }
    case 'running':
    case 'pending': return { text: '进行中', cls: 'bg-[#1664FF]/10 text-[#1664FF]' }
    case 'stopped': return { text: '已终止', cls: 'bg-[#D97706]/10 text-[#D97706]' }
    default: return { text: status, cls: 'bg-[#9CA3AF]/15 text-[#6B7280]' }
  }
}

function fmtDate(s: string): string {
  try {
    // 固定北京时间展示,与运行环境/访问者时区无关。
    return new Date(s).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

const isRunning = (s: string) => s === 'running' || s === 'pending'

// 纯对话记录的 Markdown（不含任何评分/维度/裁判信息）
interface ExpTurn { idx: number; userText: string; targetText: string }
interface ExpSession { id: string; personaId?: string; turns: ExpTurn[] }

function buildConversationMarkdown(
  run: RunRow,
  sessions: ExpSession[],
  roleName: string,
  personaMap: Record<string, string>,
): string {
  const lines: string[] = []
  lines.push(`# ${run.name?.trim() || '未命名 Run'} · 对话记录`)
  lines.push('')
  const meta = [`角色：${roleName}`, `模型：${run.userModel}`, `时间：${fmtDate(run.createdAt)}`]
  if (run.targetLabel) meta.push(`版本：${run.targetLabel}`)
  lines.push(`> ${meta.join('｜')}`)
  lines.push('')
  sessions.forEach((s, i) => {
    const pname = (s.personaId && personaMap[s.personaId]) || '用户'
    if (sessions.length > 1) { lines.push(`## 会话 ${i + 1} · 人设：${pname}`); lines.push('') }
    for (const t of [...s.turns].sort((a, b) => a.idx - b.idx)) {
      if (t.userText?.trim()) { lines.push(`**${pname}**：${t.userText.trim()}`); lines.push('') }
      if (t.targetText?.trim()) { lines.push(`**${roleName}**：${t.targetText.trim()}`); lines.push('') }
    }
  })
  return lines.join('\n').trimEnd() + '\n'
}

function triggerDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function History() {
  const navigate = useNavigate()
  const { runId: storeRunId, setRunId } = useUi()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [scores, setScores] = useState<Record<string, number | null>>({})
  const [query, setQuery] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  // Bug 4: use store for selected run (reactive across pages)
  const selectedId = storeRunId

  // 轮询 run 列表（状态徽标随进行中的 run 实时更新）。
  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const { runs: rows } = (await api.listRuns()) as { runs: RunRow[] }
        if (!cancelled) { setRuns(rows); setLoaded(true) }
      } catch { /* ignore transient errors */ }
    }
    void poll()
    const timer = setInterval(poll, 2500)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  // 懒加载均分：首次见到的 run 各拉一次 metrics；进行中的 run 每轮刷新（数量通常 0–1）。
  // summaryJson 不含 avgOverall，故只能走 /metrics。已结束的 run 拉过一次就不再拉。
  const fetchedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const need = runs.filter((r) => isRunning(r.status) || !fetchedRef.current.has(r.id))
    if (need.length === 0) return
    let cancelled = false
    void Promise.allSettled(
      need.map(async (r) => {
        // Bug 3 fix: only mark as fetched after a successful response, so a
        // failed fetch for a finished run will be retried on the next poll cycle.
        const m = (await api.getRunMetrics(r.id)) as RunAggregate
        fetchedRef.current.add(r.id)
        return [r.id, m.avgOverall] as const
      }),
    ).then((results) => {
      if (cancelled) return
      const next: Record<string, number | null> = {}
      for (const res of results) {
        if (res.status === 'fulfilled') { const [id, v] = res.value; next[id] = v }
      }
      if (Object.keys(next).length) setScores((prev) => ({ ...prev, ...next }))
    })
    return () => { cancelled = true }
  }, [runs])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return runs
    return runs.filter((r) =>
      `${r.name ?? ''} ${r.targetLabel ?? ''} ${r.createdByName ?? ''} ${r.id} ${r.userModel} ${r.judgeModel}`.toLowerCase().includes(q),
    )
  }, [runs, query])

  // 导出该 Run 的纯对话记录为 Markdown（不含评分）。
  const exportRun = async (run: RunRow) => {
    if (exportingId) return
    setExportingId(run.id)
    try {
      const [turnsRes, rolesRes, personasRes] = await Promise.all([
        api.getRunTurns(run.id) as Promise<{ sessions: ExpSession[] }>,
        api.listRoles().catch(() => ({ roles: [] as TargetRole[] })),
        api.listPersonas().catch(() => ({ personas: [] as PersonaRow[] })),
      ])
      // Bug 6: prefer targetRoleId lookup; fall back to gender match
      const runDetail = (run as RunRow & { targetRoleId?: number | null })
      const role = (runDetail.targetRoleId != null
        ? rolesRes.roles.find((r) => r.id === runDetail.targetRoleId)
        : undefined)
        ?? rolesRes.roles.find((r) => r.gender === run.taGender)
        ?? rolesRes.roles[0]
      const roleName = role?.name || '被测 AI'
      const pmap: Record<string, string> = {}
      for (const p of personasRes.personas) pmap[p.id] = p.name
      const md = buildConversationMarkdown(run, turnsRes.sessions ?? [], roleName, pmap)
      triggerDownload(`${run.name?.trim() || run.id}-对话.md`, md)
    } catch { /* ignore — 导出失败不影响列表 */ }
    finally { setExportingId(null) }
  }

  const openRun = (id: string) => {
    // Bug 4: write through store so Dashboard/Observe/Reports subscribe reactively
    setRunId(id)
    // replay 标记：让观战页知道这是「显式回放历史」，即使该 run 已结束也照常展示对话
    // （区别于直接打开观战页——已结束时那里会显示「去配置」引导而非旧内容）。
    navigate('/', { state: { replay: id } })
  }

  return (
    <div
      className="p-6 min-h-screen"
      style={{
        background: 'radial-gradient(50rem 30rem at 100% -8%, rgba(22,100,255,0.05), transparent 60%), #ffffff',
      }}
    >
      <div className="flex items-center justify-between mb-6 gap-4">
        <h2 className="text-xl font-semibold text-[#15171E]">历史</h2>
        <div className="relative w-72 max-w-[50%]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 名称 / 版本标注 / ID / 模型…"
            className="w-full rounded-xl border border-[#E8E8EE] bg-white pl-9 pr-3 py-2 text-sm text-[#15171E] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#1664FF]"
          />
        </div>
      </div>

      {loaded && runs.length === 0 ? (
        <div className="mt-20 text-center text-[#9CA3AF] text-sm">
          还没有任何 Run。去「新建评测」创建一个 Run 后，这里会列出全部历史评测。
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-20 text-center text-[#9CA3AF] text-sm">无匹配的 Run</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const badge = runStatusBadge(r.status)
            const running = isRunning(r.status)
            const score = scores[r.id]
            const selected = r.id === selectedId
            return (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => openRun(r.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRun(r.id) } }}
                className={[
                  'w-full text-left flex items-center gap-4 rounded-2xl border bg-white px-5 py-4 transition-colors cursor-pointer',
                  selected ? 'border-[#1664FF]/50 bg-[#1664FF]/[0.03]' : 'border-[#ECECF2] hover:border-[#1664FF]/40 hover:bg-[#1664FF]/[0.02]',
                ].join(' ')}
                style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
              >
                {/* 运行中红点（与左导航一致） */}
                <span className="relative flex h-2.5 w-2.5 shrink-0" title={running ? '运行中' : undefined}>
                  {running && <span className="absolute inline-flex h-full w-full rounded-full bg-[#EF4444] opacity-60 animate-ping" />}
                  <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${running ? 'bg-[#EF4444]' : 'bg-[#D6D9E0]'}`} />
                </span>

                {/* 名称 + 元信息 */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#15171E] truncate">{r.name?.trim() || '未命名 Run'}</span>
                    {r.targetLabel && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1664FF]/10 text-[#1664FF] shrink-0">{r.targetLabel}</span>}
                    {selected && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1664FF] text-white shrink-0">当前查看</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 min-w-0">
                    <span className="text-[11px] text-[#9CA3AF] font-mono truncate">
                      …{r.id.slice(-8)} · {r.userModel} · {fmtDate(r.createdAt)}
                    </span>
                    <UserTag name={r.createdByName} />
                  </div>
                </div>

                {/* 均分 */}
                <div className="shrink-0 text-right w-16">
                  {score == null ? (
                    <span className="text-xs text-[#C2C7D0]">—</span>
                  ) : (
                    <>
                      <span className="text-lg font-bold font-mono text-[#1664FF] leading-none">{score.toFixed(1)}</span>
                      <span className="text-[10px] text-[#9CA3AF] ml-0.5">/10</span>
                    </>
                  )}
                  <div className="text-[10px] text-[#C2C7D0] mt-0.5">均分</div>
                </div>

                {/* 状态徽标 */}
                <span className={`shrink-0 text-[11px] px-2 py-1 rounded-lg ${badge.cls}`}>{badge.text}</span>

                {/* 导出对话记录（Markdown，纯对话不含评分） */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void exportRun(r) }}
                  disabled={exportingId === r.id}
                  title="导出对话记录（Markdown，纯对话不含评分）"
                  aria-label="导出对话记录"
                  className="shrink-0 w-8 h-8 rounded-lg border border-[#E8E8EE] text-[#6B7280] hover:text-[#1664FF] hover:border-[#1664FF]/40 flex items-center justify-center transition-colors disabled:opacity-50"
                >
                  {exportingId === r.id
                    ? <span className="inline-block w-3.5 h-3.5 border-2 border-[#C2C7D0] border-t-[#1664FF] rounded-full animate-spin" />
                    : <Download className="w-4 h-4" />}
                </button>

                <svg className="w-4 h-4 text-[#C2C7D0] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
