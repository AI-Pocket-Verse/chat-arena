import { useEffect, useRef, useState } from 'react'
import { type MessageKey, type TFunction, useI18n } from './i18n'

// 可搜索的 Run 下拉选择器（Compare 的 A/B 选择 + Config 的回放源选择共用）。
// 按 名称 / 版本标注 / ID / 模型 过滤；展示状态徽标 + 时间。

export interface RunRow {
  id: string
  name: string | null
  targetLabel: string | null
  taGender: number
  userModel: string
  judgeModel: string
  status: string
  createdAt: string
}

export function runStatusBadge(status: string, t: TFunction): { text: string; cls: string } {
  const label = (key: MessageKey) => t(key)
  switch (status) {
    case 'finished': return { text: label('history.status.finished'), cls: 'bg-[#059669]/10 text-[#059669]' }
    case 'failed': return { text: label('history.status.failed'), cls: 'bg-[#DC2626]/10 text-[#DC2626]' }
    case 'running':
    case 'pending': return { text: label('history.status.running'), cls: 'bg-[#1664FF]/10 text-[#1664FF]' }
    case 'stopped': return { text: label('history.status.stopped'), cls: 'bg-[#D97706]/10 text-[#D97706]' }
    default: return { text: status, cls: 'bg-[#9CA3AF]/15 text-[#6B7280]' }
  }
}

export function fmtDate(s: string, locale: string): string {
  try {
    // 固定北京时间展示,与运行环境/访问者时区无关。
    return new Date(s).toLocaleString(locale, { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

export function RunPicker({ runs, value, onChange, placeholder, allowClear, clearLabel }: {
  runs: RunRow[]
  value: string
  onChange: (id: string) => void
  placeholder: string
  allowClear?: boolean
  clearLabel?: string
}) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  const selected = runs.find(r => r.id === value)
  const q = query.trim().toLowerCase()
  const filtered = q
    ? runs.filter(r => `${r.name ?? ''} ${r.targetLabel ?? ''} ${r.id} ${r.userModel}`.toLowerCase().includes(q))
    : runs
  return (
    <div ref={ref} className="relative w-full min-w-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 rounded-lg border border-[#E8E8EE] bg-white px-3 py-2 text-sm text-left hover:border-[#1664FF]/40 transition-colors"
      >
        <span className={`truncate flex-1 ${selected ? 'text-[#15171E]' : 'text-[#9CA3AF]'}`}>
          {selected ? (selected.name?.trim() || t('history.unnamed')) + (selected.targetLabel ? ` · ${selected.targetLabel}` : '') : placeholder}
        </span>
        <svg className="w-4 h-4 text-[#9CA3AF] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-[#ECECF2] bg-white shadow-lg overflow-hidden">
          <div className="p-2 border-b border-[#ECECF2]">
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('history.picker.search')}
              className="w-full rounded-lg border border-[#E8E8EE] px-3 py-1.5 text-sm text-[#15171E] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#1664FF]"
            />
          </div>
          <div className="max-h-64 overflow-auto">
            {allowClear && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); setQuery('') }}
                className={`w-full text-left px-3 py-2 border-b border-[#F4F5F8] text-sm transition-colors hover:bg-[#1664FF]/[0.04] ${!value ? 'text-[#1664FF]' : 'text-[#6B7280]'}`}
              >
                {clearLabel ?? t('history.picker.none')}
              </button>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-xs text-[#9CA3AF] text-center">{runs.length === 0 ? t('history.picker.empty') : t('history.picker.noMatch')}</div>
            ) : filtered.map(r => {
              const badge = runStatusBadge(r.status, t)
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { onChange(r.id); setOpen(false); setQuery('') }}
                  className={`w-full text-left px-3 py-2 border-b border-[#F4F5F8] last:border-0 transition-colors hover:bg-[#1664FF]/[0.04] ${r.id === value ? 'bg-[#1664FF]/[0.06]' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[#15171E] truncate">{r.name?.trim() || t('history.unnamed')}</span>
                    {r.targetLabel && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1664FF]/10 text-[#1664FF] shrink-0">{r.targetLabel}</span>}
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded shrink-0 ${badge.cls}`}>{badge.text}</span>
                  </div>
                  <div className="text-[10px] text-[#9CA3AF] font-mono mt-0.5 truncate">…{r.id.slice(-8)} · {r.userModel} · {fmtDate(r.createdAt, locale)}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
