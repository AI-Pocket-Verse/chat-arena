import { type ReactNode, useEffect } from 'react'

// 统一的应用内弹窗（替代浏览器原生 confirm/alert）。
// 样式与本应用其它弹窗一致：半透明遮罩 + 居中白卡 + 圆角阴影。
// hideCancel=true 时即「提示框」（只有一个确定按钮）。
interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  loading?: boolean
  hideCancel?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open, title, message, confirmText = '确定', cancelText = '取消',
  danger, loading, hideCancel, onConfirm, onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, loading, onCancel, onConfirm])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4"
      onClick={() => { if (!loading) onCancel() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white border border-[#ECECF2] p-5"
        style={{ boxShadow: '0 12px 48px rgba(16,24,40,0.20)' }}
      >
        <h3 className="text-base font-semibold text-[#15171E]">{title}</h3>
        {message && <div className="mt-2 text-sm text-[#6B7280] leading-relaxed">{message}</div>}
        <div className="mt-5 flex justify-end gap-2">
          {!hideCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="px-4 py-2 rounded-xl text-sm border border-[#E8E8EE] bg-white text-[#6B7280] hover:text-[#15171E] hover:bg-black/[0.03] transition-colors disabled:opacity-50"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={danger ? { background: '#DC2626' } : { background: 'linear-gradient(135deg, #1664FF, #5B9CFF)' }}
          >
            {loading ? '处理中…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
