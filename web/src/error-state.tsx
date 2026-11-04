import { HttpError } from '@chat-arena/http-client'
import { useState } from 'react'
import { useI18n, translator, currentLang, type TFunction } from './i18n'

// 统一的异常展示组件：友好摘要 + 状态/错误码徽标 + 可展开的详细异常信息 + 可选重试。
// 用于替代项目里零散的「加载失败 / String(err)」红字。

interface ErrorInfo { status?: number; code?: string; summary: string; detail: string }

function statusSummary(t: TFunction, status: number, msg: string): string {
  if (status === 502 || status === 503 || status === 504) return t('error.unavailable')
  if (status >= 500) return t('error.server')
  if (status === 401) return t('error.unauthorized')
  if (status === 403) return t('error.forbidden')
  if (status === 404) return t('error.notFound')
  if (status === 429) return t('error.tooMany')
  if (status >= 400) return t('error.badRequest')
  return msg || t('error.requestFailed')
}

export function describeError(error: unknown, t: TFunction = translator(currentLang())): ErrorInfo {
  if (error instanceof HttpError) {
    const detail = [
      `message: ${error.message}`,
      `status: ${error.status}`,
      error.code ? `code: ${error.code}` : '',
      error.details != null ? `details: ${typeof error.details === 'string' ? error.details : JSON.stringify(error.details, null, 2)}` : '',
    ].filter(Boolean).join('\n')
    // 后端返回 { error, message } 时，message 是给人看的具体原因（如缺哪个 API Key），优先展示
    const body = error.details as { error?: unknown; message?: unknown } | null | undefined
    if (body && typeof body === 'object' && typeof body.message === 'string' && body.message) {
      const code = typeof body.error === 'string' ? body.error : error.code
      return { status: error.status, code, summary: body.message, detail }
    }
    return { status: error.status, code: error.code, summary: statusSummary(t, error.status, error.message), detail }
  }
  if (error instanceof Error) {
    const isNetwork = /fetch|network|Failed to fetch|NetworkError/i.test(error.message)
    const summary = isNetwork ? t('error.network') : error.message
    return { summary, detail: `${error.name}: ${error.message}${error.stack ? `\n\n${error.stack}` : ''}` }
  }
  const s = String(error)
  return { summary: s, detail: s }
}

export function ErrorState({ error, title, onRetry, className = '' }: {
  error: unknown
  title?: string
  onRetry?: () => void
  className?: string
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const info = describeError(error, t)
  return (
    <div className={`rounded-2xl border border-[#DC2626]/20 bg-[#DC2626]/[0.03] p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#DC2626]/10 text-[#DC2626] flex items-center justify-center shrink-0">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4" /><path d="M12 17h.01" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[#15171E]">{title ?? t('error.loadFailed')}</span>
            {info.status != null && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#DC2626]/10 text-[#DC2626] font-mono">HTTP {info.status}</span>}
            {info.code && info.code !== 'http_error' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#9CA3AF]/15 text-[#6B7280] font-mono">{info.code}</span>}
          </div>
          <p className="text-sm text-[#6B7280] mt-1 leading-relaxed">{info.summary}</p>
          <div className="flex items-center gap-3 mt-3">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="text-xs px-3 py-1.5 rounded-lg bg-[#DC2626] text-white font-medium hover:opacity-90 transition-opacity"
              >
                {t('common.retry')}
              </button>
            )}
            {info.detail && (
              <button type="button" onClick={() => setOpen(o => !o)} className="text-xs text-[#6B7280] hover:text-[#15171E] transition-colors">
                {open ? t('error.hideDetails') : t('error.showDetails')}
              </button>
            )}
          </div>
          {open && info.detail && (
            <pre className="mt-3 text-[11px] font-mono text-[#6B7280] bg-white border border-[#ECECF2] rounded-lg p-3 overflow-auto max-h-72 whitespace-pre-wrap break-all">{info.detail}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
