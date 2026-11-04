import { useI18n } from './i18n'

const LOCAL_USER_NAME = '本地用户'

// 用户姓名标签：标注某条记录的创建者（或当前登录用户）。
// 用于评测记录、历史报告等列表项；name 为空则不渲染。
export function UserTag({ name, title }: { name?: string | null; title?: string }) {
  const { t } = useI18n()
  // 本地模式的创建者名固定存为 LOCAL_USER.name（packages/auth-core），按界面语言显示
  const label = name?.trim() === LOCAL_USER_NAME ? t('common.localUser') : name?.trim()
  if (!label) return null
  return (
    <span
      title={title ?? t('common.creator', { label })}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-[#F1F5F9] text-[#64748B] shrink-0 max-w-[10rem]"
    >
      <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
      <span className="truncate">{label}</span>
    </span>
  )
}
