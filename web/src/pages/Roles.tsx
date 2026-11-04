import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { TargetRole } from '../api'
import { ErrorState } from '../error-state'

// ── shared style tokens (light/blue) ───────────────────────────────────────

const sectionCls = 'p-4 rounded-xl border border-[#ECECF2] bg-[#F7F8FB]'
const sectionTitleCls = 'text-xs font-semibold text-[#9CA3AF] uppercase tracking-widest mb-2'
const tagCls = 'text-xs bg-white border border-[#E8E8EE] text-[#6B7280] px-2 py-0.5 rounded-full'

const PERSONA_SECTIONS: { key: keyof NonNullable<TargetRole['promptPersona']>; label: string }[] = [
  { key: 'identityBase', label: '你是谁' },
  { key: 'relationshipBase', label: '关系定位' },
  { key: 'dailyStyle', label: '日常风格' },
  { key: 'emotionSupport', label: '情绪陪伴' },
  { key: 'mediaPolicy', label: '图片表达' },
  { key: 'realityBoundary', label: '现实边界' },
  { key: 'safetyBoundary', label: '安全边界' },
]

// ── sub-components ────────────────────────────────────────────────────────────

function Avatar({ src, name, size = 64 }: { src?: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const style = { width: size, height: size }
  if (failed || !src) {
    return (
      <div
        className="rounded-xl bg-[#F7F8FB] border border-[#E8E8EE] flex items-center justify-center text-[#6B7280] shrink-0"
        style={{ ...style, fontSize: size * 0.4 }}
      >
        {name.slice(0, 1)}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className="rounded-xl object-cover shrink-0 border border-[#E8E8EE]"
      style={style}
    />
  )
}

function GenderBadge({ gender }: { gender: 1 | 2 }) {
  return gender === 1 ? (
    <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-[#2563EB]/10 text-[#2563EB] border border-[#2563EB]/20">
      ♂ 男
    </span>
  ) : (
    <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-[#1664FF]/10 text-[#1664FF] border border-[#1664FF]/20">
      ♀ 女
    </span>
  )
}

// ── selected role full content (full width, everything expanded) ──────────────

function RoleDetail({ role }: { role: TargetRole }) {
  // 区块锚点（每个角色独立 id，避免切换角色时锚点冲突）
  const personaAnchor = `role-${role.id}-persona`
  const renderedAnchor = `role-${role.id}-rendered`
  const chatAnchor = `role-${role.id}-chat`

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const anchors: { id: string; label: string; show: boolean }[] = [
    { id: personaAnchor, label: '完整设定', show: true },
    { id: renderedAnchor, label: '完整渲染', show: !!role.renderedPrompt },
    { id: chatAnchor, label: '聊天人设', show: !!role.chatPersona },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div
        className="rounded-2xl border border-[#ECECF2] bg-white p-6"
        style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
      >
        <div className="flex items-start gap-5">
          <Avatar src={role.avatar} name={role.name} size={80} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
              <span className="text-2xl font-bold text-[#15171E]">{role.name}</span>
              {role.nickname && <span className="text-base text-[#6B7280]">({role.nickname})</span>}
              <GenderBadge gender={role.gender} />
              {role.age != null && <span className="text-sm text-[#6B7280]">{role.age} 岁</span>}
              {role.city && <span className="text-sm text-[#6B7280]">{role.city}</span>}
              {(role.height ?? 0) > 0 && <span className="text-sm text-[#6B7280]">{role.height} cm</span>}
            </div>
            {role.title && <p className="text-sm text-[#1664FF] font-medium mb-3">{role.title}</p>}
            {role.tags && role.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {role.tags.map((t) => (
                  <span key={t} className={tagCls}>
                    {t}
                  </span>
                ))}
              </div>
            )}
            {role.brief && (
              <p className="text-sm text-[#6B7280] leading-relaxed whitespace-pre-wrap">{role.brief}</p>
            )}
          </div>
        </div>
      </div>

      {/* 锚点导航 */}
      <div className="flex items-center gap-2 flex-wrap">
        {anchors.filter((a) => a.show).map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => jump(a.id)}
            className="text-xs font-medium px-3 py-1.5 rounded-full border border-[#E8E8EE] bg-white text-[#1664FF] hover:bg-[#1664FF]/5 hover:border-[#1664FF]/30 transition-colors"
          >
            # {a.label}
          </button>
        ))}
      </div>

      {/* 完整设定 — 7 段，全部展开 */}
      <div id={personaAnchor} className="scroll-mt-24">
        <p className={sectionTitleCls}>完整设定（7 段基础 prompt）</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {PERSONA_SECTIONS.map(({ key, label }) => {
            const text = role.promptPersona?.[key]
            if (!text) return null
            return (
              <div key={key} className={sectionCls}>
                <p className="text-xs font-semibold text-[#1664FF] mb-2">{label}</p>
                <p className="text-sm text-[#374151] leading-relaxed whitespace-pre-wrap">{text}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* 完整渲染 prompt — 全部展开 */}
      {role.renderedPrompt && (
        <div id={renderedAnchor} className="scroll-mt-24">
          <p className={sectionTitleCls}>完整渲染 prompt</p>
          <pre className="text-sm text-[#374151] font-mono bg-[#F7F8FB] border border-[#ECECF2] rounded-xl p-5 whitespace-pre-wrap leading-relaxed">
            {role.renderedPrompt}
          </pre>
        </div>
      )}

      {/* 聊天人设（单行人设） */}
      {role.chatPersona && (
        <div id={chatAnchor} className="scroll-mt-24">
          <p className={sectionTitleCls}>聊天人设</p>
          <pre className="text-sm text-[#374151] font-mono bg-[#F7F8FB] border border-[#ECECF2] rounded-xl p-5 whitespace-pre-wrap leading-relaxed">
            {role.chatPersona}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export function Roles() {
  const [roles, setRoles] = useState<TargetRole[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(() => {
    setLoading(true)
    api
      .listRoles()
      .then((r) => {
        setRoles(r.roles)
        setSelectedId(r.roles[0]?.id ?? null)
        setError(null)
      })
      .catch((err: unknown) => setError(err))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const selected = roles.find((r) => r.id === selectedId) ?? null

  return (
    <div
      className="min-h-screen"
      style={{
        background: 'radial-gradient(60rem 36rem at 80% -10%, rgba(22,100,255,0.05), transparent 60%), #ffffff',
      }}
    >
      {/* ── Sticky header: title + role tabs ── */}
      <div className="sticky top-0 z-10 bg-white/85 backdrop-blur border-b border-[#E8E8EE] px-6 pt-5 pb-3">
        <h2 className="text-xl font-semibold text-[#15171E] mb-3">角色库</h2>
        {roles.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {roles.map((role) => {
              const active = role.id === selectedId
              return (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setSelectedId(role.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-colors border ${
                    active
                      ? 'bg-[#1664FF]/10 text-[#1664FF] border-[#1664FF]/30'
                      : 'bg-white text-[#6B7280] border-[#E8E8EE] hover:bg-black/[0.03] hover:text-[#15171E]'
                  }`}
                >
                  <Avatar src={role.avatar} name={role.name} size={24} />
                  <span>{role.name}</span>
                  <span className="text-xs opacity-70">{role.gender === 1 ? '♂' : '♀'}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Content (full width, scrolls with the main panel) ── */}
      <div className="px-6 py-6">
        {loading && <div className="text-sm text-[#9CA3AF] py-12 text-center">加载中…</div>}

        {!loading && error != null && (
          <ErrorState error={error} title="角色库加载失败" onRetry={load} className="max-w-2xl" />
        )}

        {!loading && !error && roles.length === 0 && (
          <p className="text-sm text-[#9CA3AF] py-12 text-center">暂无角色数据。</p>
        )}

        {!loading && !error && selected && <RoleDetail role={selected} />}
      </div>
    </div>
  )
}
