import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { format, localeOf, readLangPref, resolveLang, setCurrentLang, writeLangPref, type Lang, type LangPref } from './lang'
import { MESSAGES, type MessageKey } from './messages'

export type { Lang, LangPref } from './lang'
export { currentLang, localeOf } from './lang'
export type { MessageKey } from './messages'

export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string

interface I18nValue {
  /** 当前生效的语言 */
  lang: Lang
  /** 用户偏好（含「跟随系统」） */
  pref: LangPref
  setPref: (pref: LangPref) => void
  t: TFunction
  /** Intl 用的 locale，如 zh-CN / en-US */
  locale: string
}

const I18nContext = createContext<I18nValue | null>(null)

/** 取某种语言的翻译函数。组件外（如 ErrorBoundary 的 class 组件）也能用 */
export function translator(lang: Lang): TFunction {
  return (key, vars) => format(MESSAGES[lang][key], vars)
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<LangPref>(readLangPref)
  // 跟随系统时，系统语言变了要跟着变（languagechange 事件）
  const [sysTick, setSysTick] = useState(0)
  useEffect(() => {
    const onChange = () => setSysTick((n) => n + 1)
    window.addEventListener('languagechange', onChange)
    return () => window.removeEventListener('languagechange', onChange)
  }, [])

  // sysTick 只用来触发重算
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lang = useMemo(() => resolveLang(pref), [pref, sysTick])
  // 渲染期间就同步给非组件代码（api.ts 的 X-Lang 头），避免首个请求带错语言
  setCurrentLang(lang)

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    document.title = MESSAGES[lang]['app.title']
  }, [lang])

  const setPref = useCallback((p: LangPref) => {
    writeLangPref(p)
    setPrefState(p)
  }, [])

  const value = useMemo<I18nValue>(() => ({ lang, pref, setPref, t: translator(lang), locale: localeOf(lang) }), [lang, pref, setPref])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext)
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>')
  return v
}

/** 顶栏右侧的语言切换：按钮显示当前语言，点开选「跟随系统 / 中文 / English」 */
export function LanguageSwitch() {
  const { pref, lang, setPref, t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  const options: LangPref[] = ['system', 'zh', 'en']
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('lang.switch')}
        className="flex items-center gap-1.5 rounded-lg border border-[#E8E8EE] px-2.5 py-1.5 text-sm text-[#374151] hover:bg-black/[0.04] transition-colors"
      >
        {/* 语言图标（改编自 Lucide `languages`，ISC License） */}
        <svg className="w-4 h-4 text-[#6B7280]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" />
          <path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
        </svg>
        <span>{t(`lang.${lang}`)}</span>
        <svg className="w-3.5 h-3.5 text-[#9CA3AF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1.5 w-36 rounded-xl border border-[#E8E8EE] bg-white py-1 shadow-lg">
          {options.map((p) => (
            <button
              key={p}
              type="button"
              role="menuitemradio"
              aria-checked={p === pref}
              onClick={() => { setPref(p); setOpen(false) }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/[0.04] ${p === pref ? 'text-[#1664FF] font-medium' : 'text-[#374151]'}`}
            >
              <span className="w-3.5">{p === pref ? '✓' : ''}</span>
              {t(`lang.${p}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
