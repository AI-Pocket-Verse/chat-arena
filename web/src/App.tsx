import { useEffect, useState } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { useAuth, UserMenu } from '@chat-arena/auth-client-web'
import { api } from './api'
import { Compare } from './pages/Compare'
import { Config } from './pages/Config'
import { Dashboard } from './pages/Dashboard'
import { History } from './pages/History'
import { Observe } from './pages/Observe'
import { Personas } from './pages/Personas'
import { Reports } from './pages/Reports'
import { Roles } from './pages/Roles'
import { useUi } from './ui-store'

// 头像弹窗的身份信息行：user_id / open_id 各一行、单行截断、点击复制。
function CopyId({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  const copy = () => {
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        /* clipboard 被拦截（如 http 环境）— title 提示里仍能看到完整值 */
      })
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={`点击复制 ${label}:${value}`}
      className="flex w-full items-center gap-1.5 text-left"
    >
      <span className="w-[52px] shrink-0 text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className="flex-1 truncate font-mono text-[11px] text-gray-500">{value}</span>
      <span className={`shrink-0 text-[10px] ${copied ? 'text-emerald-500' : 'text-blue-400'}`}>
        {copied ? '已复制' : '复制'}
      </span>
    </button>
  )
}

function IdentityIds({ userId, openId }: { userId: string | null; openId: string | null }) {
  return (
    <div className="mt-0.5 space-y-1">
      <CopyId label="user_id" value={userId} />
      <CopyId label="open_id" value={openId} />
    </div>
  )
}

// 左侧导航：按「测评 / 分析 / 素材库」分组，名称见名知意。
const NAV_GROUPS: Array<{ title: string; items: Array<{ to: string; label: string; end?: boolean }> }> = [
  {
    title: '评测',
    items: [
      { to: '/config', label: '新建评测' },
      { to: '/', label: '实时评测', end: true },
      { to: '/history', label: '评测记录' },
    ],
  },
  {
    title: '分析',
    items: [
      { to: '/dashboard', label: '数据看板' },
      { to: '/compare', label: '版本对比' },
      { to: '/reports', label: '评测报告' },
    ],
  },
  {
    title: '素材库',
    items: [
      { to: '/personas', label: '用户人设库' },
      { to: '/roles', label: 'AI 角色库' },
    ],
  },
]

export function App() {
  const { user, loading, login, isLocal } = useAuth()
  const reportGenerating = useUi((s) => s.reportGenerating)

  // 登录门：启用登录时，未登录 → 跳转飞书 SSO 登录；本地模式下 user 恒为本地用户。
  useEffect(() => {
    if (!loading && !user) login()
  }, [loading, user, login])

  // 全局轮询：只要【存在任一】run 在跑（running/pending），左侧「观战」导航就显示"运行中"
  // 红点。与"当前查看哪条 run"解耦——查看历史里某条已结束的 run 时，后台真有 run 在跑红点仍亮。
  const [runActive, setRunActive] = useState(false)
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const poll = async () => {
      try {
        const { runs } = (await api.listRuns()) as { runs: Array<{ status: string }> }
        const active = runs.some((r) => r.status === 'running' || r.status === 'pending')
        if (!cancelled) setRunActive(active)
      } catch { /* ignore transient errors */ }
    }
    void poll()
    const timer = setInterval(poll, 2500)
    return () => { cancelled = true; clearInterval(timer) }
  }, [user])

  // 鉴权未就绪 / 未登录：不渲染应用内容（登录后才能看）。
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-[#9CA3AF]">加载中…</div>
  }
  if (!user) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-[#9CA3AF]">跳转登录中…</div>
  }

  return (
    <div className="flex flex-col h-full min-h-screen bg-white text-[#15171E]">
      {/* ── Top bar ── */}
      <header className="h-16 shrink-0 flex items-center justify-between px-5 border-b border-[#E8E8EE] bg-white relative z-50">
        <div className="flex items-center gap-2.5">
          {/* Title icon: AI bot head (no speech-bubble tail), blinking eyes */}
          <svg
            className="w-6 h-6 shrink-0 text-[#1664FF]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {/* antenna */}
            <path d="M12 6V2H8" />
            {/* head (rounded square, no tail) */}
            <rect x="4" y="6" width="16" height="12" rx="2.5" />
            {/* ears */}
            <path d="M2 12h2" />
            <path d="M20 12h2" />
            {/* eyes (blinking) */}
            <path className="bot-eye" d="M9 11v2" />
            <path className="bot-eye" d="M15 11v2" />
          </svg>
          <span className="text-xl font-bold text-[#15171E] tracking-tight">模拟评测</span>
        </div>
        {/* 右上角头像：点击展开 姓名 / user_id / open_id（单行、点击复制）/ 退出登录。本地模式没有账号可展示 */}
        {!isLocal && (
          <UserMenu
            avatarOnly
            subtitle={<IdentityIds userId={user.id} openId={user.open_id} />}
          />
        )}
      </header>

      <div className="flex flex-1 min-h-0">
        {/* ── Left nav (分组：测评 / 分析 / 素材库) ── */}
        <nav className="w-[220px] shrink-0 border-r border-[#E8E8EE] px-4 py-5 space-y-5 bg-[#FAFAFC]">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <div className="px-4 text-[11px] font-semibold uppercase tracking-widest text-[#A6ABB6]">{group.title}</div>
              {group.items.map(({ to, label, end }) => {
                // 红点：实时观战 = 有 run 在跑；优化报告 = 正在生成报告
                const dot = (to === '/' && runActive) || (to === '/reports' && reportGenerating)
                const dotTitle = to === '/reports' ? '报告生成中' : '运行中'
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-[15px] font-medium transition-colors ${
                        isActive
                          ? 'bg-[#1664FF]/10 text-[#1664FF]'
                          : 'text-[#6B7280] hover:bg-black/[0.04] hover:text-[#15171E]'
                      }`
                    }
                  >
                    <span>{label}</span>
                    {dot && (
                      <span className="ml-auto relative flex h-2.5 w-2.5" title={dotTitle}>
                        <span className="absolute inline-flex h-full w-full rounded-full bg-[#EF4444] opacity-60 animate-ping" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#EF4444]" />
                      </span>
                    )}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Observe />} />
            <Route path="/history" element={<History />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/config" element={<Config />} />
            <Route path="/personas" element={<Personas />} />
            <Route path="/roles" element={<Roles />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/reports" element={<Reports />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
