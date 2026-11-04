import * as htmlToImage from 'html-to-image'
import { ArrowDownToLine, ArrowUpToLine, Copy, Download, ImageDown, Square, SquareCheckBig, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, type TargetRole, type PersonaRow, type PersonaStructured } from '../api'
import { ConfirmDialog } from '../confirm-dialog'
import { type HydrateSession, type TurnView, useLive } from '../store'
import { useUi } from '../ui-store'
import { connectRunWs, type WsHandle } from '../ws'

// 生成图片：导出卡片固定宽度 + 单张图片最大高度（DOM 像素）。pixelRatio=2 时画布面积约为
// DOM 面积的 4 倍（1520×height×4 bytes）。Safari canvas 面积上限约 16.7M 像素，
// 按 1520×10400≈15.8M 像素留余量，反推 DOM 高度上限取 5200。
const EXPORT_WIDTH = 760
const MAX_EXPORT_HEIGHT = 5200
const EXPORT_PIXEL_RATIO = 2

// 头像：有图显示图，无图/加载失败显示名称首字母默认头像。
function Avatar({ src, name, sizeCls = 'w-8 h-8 text-xs' }: { src?: string; name: string; sizeCls?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <div className={`${sizeCls} rounded-full bg-[#1664FF]/10 text-[#1664FF] flex items-center justify-center font-semibold shrink-0`}>
        {name.trim().slice(0, 1) || '?'}
      </div>
    )
  }
  return <img src={src} alt={name} onError={() => setFailed(true)} className={`${sizeCls} rounded-full object-cover shrink-0 border border-[#E8E8EE]`} />
}

// 导出图片用：首字母圆形头像（纯 CSS，避免远程图片导致 canvas 跨域污染）
function InitialCircle({ name, kind }: { name: string; kind: 'user' | 'target' }) {
  const bg = kind === 'target' ? 'rgba(22,100,255,0.12)' : '#E8ECF5'
  const fg = kind === 'target' ? '#1664FF' : '#6B7280'
  return (
    <div style={{ width: 28, height: 28, borderRadius: 9999, background: bg, color: fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
      {name.trim().slice(0, 1) || '?'}
    </div>
  )
}

// 导出图片用：单条「对话 + 评分」卡片，全部内联样式（html-to-image 渲染最稳定）
function ExportCard({ t, userName, targetName }: { t: TurnView; userName: string; targetName: string }) {
  const s = t.score
  const label10 = { fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase' as const, color: '#C2C7D0', fontFamily: 'monospace' }
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', border: '1px solid #ECECF2', borderRadius: 16, overflow: 'hidden', marginBottom: 12, background: '#fff' }}>
      <div style={{ flex: 1, minWidth: 0, padding: 16 }}>
        <div style={{ ...label10, marginBottom: 10 }}>对话 · 第 {t.idx + 1} 轮</div>
        {t.userText && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
            <div style={{ maxWidth: '78%', borderRadius: 16, borderTopRightRadius: 4, background: '#F1F3F9', border: '1px solid #E8E8EE', padding: '10px 14px', fontSize: 13, color: '#15171E', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 4, fontFamily: 'monospace' }}>{userName}</div>
              {t.userText}
            </div>
            <InitialCircle name={userName} kind="user" />
          </div>
        )}
        {(t.targetText || t.streaming) && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-start', gap: 8 }}>
            <InitialCircle name={targetName} kind="target" />
            <div style={{ maxWidth: '78%', borderRadius: 16, borderTopLeftRadius: 4, background: 'rgba(22,100,255,0.06)', border: '1px solid rgba(22,100,255,0.18)', padding: '10px 14px', fontSize: 13, color: '#15171E', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              <div style={{ fontSize: 11, color: '#1664FF', marginBottom: 4, fontFamily: 'monospace', fontWeight: 500 }}>{targetName}</div>
              {t.targetText || t.streaming}
            </div>
          </div>
        )}
      </div>
      <div style={{ width: 280, flexShrink: 0, borderLeft: '1px solid #ECECF2', background: '#FAFBFD', padding: 16, boxSizing: 'border-box' }}>
        <div style={{ ...label10, marginBottom: 8 }}>评分</div>
        {s === undefined ? <div style={{ fontSize: 12, color: '#C2C7D0' }}>—</div>
          : s === null ? <div style={{ fontSize: 12, color: '#9CA3AF' }}>评分中…</div>
          : s.judgeError ? <div style={{ fontSize: 12, color: '#D97706' }}>裁判异常：{s.judgeError}</div>
          : (
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 8 }}>
                <span style={{ fontSize: 30, fontWeight: 700, fontFamily: 'monospace', color: '#1664FF', lineHeight: 1 }}>{s.overall?.toFixed(1) ?? '—'}</span>
                <span style={{ fontSize: 12, color: '#9CA3AF' }}>/ 10</span>
                {s.violation && <span style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(220,38,38,0.1)', color: '#DC2626', fontWeight: 500 }}>违规</span>}
              </div>
              {s.comment && <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.6, marginBottom: 8 }}>{s.comment}</div>}
              {s.suggestion && <div style={{ fontSize: 12, color: '#9CA3AF', borderTop: '1px solid #ECECF2', paddingTop: 8 }}><span style={{ color: '#1664FF', fontWeight: 500, marginRight: 4 }}>改进</span>{s.suggestion}</div>}
            </div>
          )}
      </div>
    </div>
  )
}

// 观战页模式：
//  live   = 进入时 run 正在进行（running/pending）→ 实时展示，并一路看到结束（看到最终结果）
//  replay = 从「历史」页显式点击进入 → 回放该 run（无论是否已结束）
//  cta    = 进入时没有进行中的 run（已结束/失败/已停止/无 run）→ 不显示旧内容，引导去配置
//  loading= 正在判定（需要先查一次 run 状态）
type ObserveMode = 'loading' | 'live' | 'replay' | 'cta'

export function Observe() {
  const { turns, sessions, apply, reset, hydrate } = useLive()
  const { runId: storeRunId } = useUi()
  const navigate = useNavigate()
  const location = useLocation()
  const handleRef = useRef<WsHandle | null>(null)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  // 重连时要重发 watch，需要拿到最新的选中会话（effect 闭包里读不到 state）
  const selectedSessionRef = useRef<string | null>(null)
  selectedSessionRef.current = selectedSession
  // 进入时判定一次模式（之后不随 run 结束而回退：live 进来的会一路看到结束）
  const [mode, setMode] = useState<ObserveMode>(() => {
    const replay = (location.state as { replay?: string } | null)?.replay
    if (replay) return 'replay'
    if (!sessionStorage.getItem('runId')) return 'cta'
    return 'loading'
  })
  const active = mode === 'live' || mode === 'replay'
  // run 运行状态（轮询 GET /api/runs/:id），用于在无对话时给出明确反馈而非空白
  const [runState, setRunState] = useState<{ status: string; error?: string } | null>(null)
  const [stopping, setStopping] = useState(false)
  const [showStopConfirm, setShowStopConfirm] = useState(false)
  // WS 连接异常提示条（AUTH_REQUIRED 或网络中断）
  const [wsDisconnected, setWsDisconnected] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  // 自动滚动控制：手动往上滑会暂停自动到底；滑回底部恢复。scroller = 外层 <main> 滚动容器。
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const lastTopRef = useRef(0)
  // 程序化滚动（点顶/底按钮）期间，onScroll 不得改写「自动跟随」意图——否则平滑滚到顶的
  // 中途仍在底部附近，会被 onScroll 误判为「在底部」而重新开启自动跟随，再被流式增量拽回。
  const programmaticRef = useRef(false)
  const progTargetRef = useRef<'top' | 'bottom'>('top')
  const progTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // autoScroll 同时存 ref：按钮/滚动事件能同步改它，避免「点击瞬间正好有流式增量把页面又拽回底部」的竞态。
  const autoScrollRef = useRef(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const setAuto = (v: boolean) => { autoScrollRef.current = v; setAutoScroll(v) }
  const [scrollable, setScrollable] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [atTop, setAtTop] = useState(true)
  const [hasNew, setHasNew] = useState(false) // 暂停期间有新回复 → 底部按钮提示小红点
  // 角色（target）名字+头像；人设 id→名字+头像；session id→人设 id
  const [roleInfo, setRoleInfo] = useState<{ name: string; avatar?: string } | null>(null)
  const [personaMap, setPersonaMap] = useState<Record<string, { name: string; avatar?: string }>>({})
  const [sessionPersona, setSessionPersona] = useState<Record<string, string>>({})
  // 当前查看的 run 名称（用于头部标识：实时 run / 历史回放都显示是哪一条）
  const [runLabel, setRunLabel] = useState<string | null>(null)

  // 多选 → 生成图片
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // 生成成功时冻结条数，避免生成后选择变化导致标题与图片内容不符
  const [previewCount, setPreviewCount] = useState(0)
  const previewBlobRef = useRef<Blob | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [genError, setGenError] = useState<string | null>(null)
  // 内容超出单张图片最大高度时的提示（要求用户先取消勾选几条再重试）
  const [tooTall, setTooTall] = useState<{ heightPx: number; count: number } | null>(null)
  const exportRef = useRef<HTMLDivElement>(null)

  // 从 store 读 runId（响应式），降级到 sessionStorage（storeRunId 尚未同步时的首次读）
  const runId = storeRunId ?? sessionStorage.getItem('runId')

  // 判定 live / cta：只在 loading 时查一次 run 状态。进行中→live；否则→cta（不展示旧内容）。
  useEffect(() => {
    if (mode !== 'loading') return
    if (!runId) { setMode('cta'); return }
    let cancelled = false
    void (api.getRun(runId) as Promise<{ run: { status?: string } | null }>)
      .then((res) => {
        if (cancelled) return
        const status = res.run?.status
        setMode(status === 'running' || status === 'pending' ? 'live' : 'cta')
      })
      .catch(() => { if (!cancelled) setMode('cta') })
    return () => { cancelled = true }
  }, [mode, runId])

  // 拉取本 run 的角色（优先按 targetRoleId，无则按 taGender）与人设（名字/头像），用于对话气泡显示
  useEffect(() => {
    if (!active) return
    if (!runId) return
    let cancelled = false
    void Promise.all([
      api.getRun(runId).catch(() => ({ run: null })) as Promise<{ run: { taGender?: number; targetRoleId?: number | null; name?: string | null; targetLabel?: string | null } | null }>,
      api.listRoles().catch(() => ({ roles: [] as TargetRole[] })),
      api.listPersonas().catch(() => ({ personas: [] as PersonaRow[] })),
    ]).then(([runRes, rolesRes, personasRes]) => {
      if (cancelled) return
      const taGender = runRes.run?.taGender
      const targetRoleId = runRes.run?.targetRoleId
      setRunLabel(runRes.run?.name?.trim() || runRes.run?.targetLabel?.trim() || null)
      // Bug 6: prefer targetRoleId lookup; fall back to gender match
      const role = (targetRoleId != null
        ? rolesRes.roles.find((r) => r.id === targetRoleId)
        : undefined)
        ?? rolesRes.roles.find((r) => r.gender === taGender)
        ?? rolesRes.roles[0]
      if (role) setRoleInfo({ name: role.name, avatar: role.avatar })
      const pmap: Record<string, { name: string; avatar?: string }> = {}
      for (const p of personasRes.personas) {
        let avatar: string | undefined
        try { avatar = (JSON.parse(p.structuredJson ?? '{}') as PersonaStructured).avatar } catch { /* ignore */ }
        pmap[p.id] = { name: p.name, avatar }
      }
      setPersonaMap(pmap)
    })
    return () => { cancelled = true }
  }, [active, runId])

  // 绑定外层滚动容器（App 的 <main>），监听滚动以判断是否在底部 / 是否可滚动。
  // 手动上滑离开底部 → 暂停自动到底；滑回底部 → 恢复自动到底并清除新内容提示。
  useEffect(() => {
    if (!active) return
    const sc = (rootRef.current?.closest('main') as HTMLElement | null)
    scrollerRef.current = sc
    if (!sc) return
    const onScroll = () => {
      const top = sc.scrollTop
      const dist = sc.scrollHeight - top - sc.clientHeight
      const bottom = dist < 60
      setAtBottom(bottom)
      setAtTop(top < 10)
      setScrollable(sc.scrollHeight - sc.clientHeight > 40)
      const prev = lastTopRef.current
      lastTopRef.current = top
      // 程序化滚动中：只更新位置态，不改写自动跟随意图；到达【目标端点】才结束程序化态。
      // （关键：滚到顶时起点本就在底部，不能因「当前在底部」就提前解除。）
      if (programmaticRef.current) {
        if (bottom) setHasNew(false)
        const reached = progTargetRef.current === 'top' ? top < 10 : bottom
        if (reached) programmaticRef.current = false
        return
      }
      // 到底 → 恢复自动；只有「明显上滑」才暂停（避免程序化平滑滚到底时的中间事件误暂停）
      if (bottom) { setAuto(true); setHasNew(false) }
      else if (top < prev - 4) setAuto(false)
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => sc.removeEventListener('scroll', onScroll)
  }, [active])

  // 新对话/新增量到达：仅在「自动到底」开启时滚到底；暂停时只标记有新内容。
  // 进入页面（切回 tab）首次直接跳底显示最新卡片。
  useEffect(() => {
    if (!autoScrollRef.current) {
      if (turns.length) setHasNew(true)
      return
    }
    // 实时跟随用「瞬时」滚动：避免每条流式增量都留下进行中的平滑滚动动画，
    // 否则会和「回到顶部/底部」按钮的平滑滚动互相打断（top 按钮抖一下就停住）。
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [turns, autoScroll])

  // 内容增长后重算是否可滚动（让悬浮按钮在内容超过一屏时出现）
  useEffect(() => {
    const sc = scrollerRef.current
    if (!sc) return
    setScrollable(sc.scrollHeight - sc.clientHeight > 40)
  }, [turns, active])

  // 标记进入程序化滚动，并设兜底定时器（动画被打断时也能解除，避免永久卡住自动跟随判定）。
  const beginProgrammatic = (target: 'top' | 'bottom') => {
    programmaticRef.current = true
    progTargetRef.current = target
    if (progTimerRef.current) clearTimeout(progTimerRef.current)
    progTimerRef.current = setTimeout(() => { programmaticRef.current = false }, 1000)
  }
  const scrollToTop = () => {
    setAuto(false)
    beginProgrammatic('top')
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const scrollToBottom = () => {
    setAuto(true)
    setHasNew(false)
    beginProgrammatic('bottom')
    const sc = scrollerRef.current
    if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' })
  }

  // Auto-select first session when sessions list grows and nothing is selected yet
  useEffect(() => {
    if (sessions.length > 0 && selectedSession === null) {
      const first = sessions[0]!
      setSelectedSession(first)
      handleRef.current?.watch(first)
    }
  }, [sessions, selectedSession])

  useEffect(() => {
    if (!active) return
    if (!runId) return
    reset(runId)

    // Bug 1 fix: create WS synchronously so cleanup always has a reference.
    // Hydration (getRunTurns) runs independently; the store's upsert logic merges
    // hydrated turns with any WS events that arrive before hydration completes.
    let retryCount = 0
    const MAX_RETRIES = 3
    const BACKOFF = [1000, 2000, 4000]
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let destroyed = false

    // 拉取已落库的轮次并合并进 store；首次进入与每次重连成功后都跑，补齐断线期间丢失的事件
    let hydrateCancelled = false
    const hydrateRun = () => {
      void api.getRunTurns(runId).then((data) => {
        if (hydrateCancelled) return
        const { sessions: hydratedSessions } = data as { sessions: HydrateSession[] }
        hydrate(hydratedSessions)
      }).catch(() => { /* 下次重连或刷新时再补 */ })
    }

    let everOpened = false
    const connect = () => {
      const handle = connectRunWs(runId, {
        onEvent: apply,
        onOpen: () => {
          if (destroyed) return
          retryCount = 0
          setWsDisconnected(false)
          // 新连接不带上一条连接的 watch：重发当前观看的会话，并补拉断线期间的历史
          const sid = selectedSessionRef.current
          if (sid) handle.watch(sid)
          if (everOpened) hydrateRun()
          everOpened = true
        },
        // Bug 2 fix: show disconnection banner; attempt simple backoff reconnect
        onUnexpectedClose: () => {
          if (destroyed) return
          setWsDisconnected(true)
          if (retryCount < MAX_RETRIES) {
            const delay = BACKOFF[retryCount] ?? 4000
            retryCount++
            retryTimer = setTimeout(() => {
              if (!destroyed) connect()
            }, delay)
          }
        },
      })
      handleRef.current = handle
      return handle
    }

    connect()

    // Hydration is independent of WS — runs in parallel, merges via store upsert
    hydrateRun()

    return () => {
      destroyed = true
      hydrateCancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      handleRef.current?.close()
      handleRef.current = null
      setWsDisconnected(false)
    }
  }, [apply, reset, hydrate, active, runId])

  // 轮询 run 状态：失败/结束时停止；用于在没有任何对话时解释原因（失败/运行中/空跑）
  useEffect(() => {
    if (!active) return
    if (!runId) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    const poll = async () => {
      try {
        // 同时拉 run 状态 + 已落库的 turn（作为 WebSocket 的兜底：WS 不通时对话仍能显示）
        const [{ run }, turnsData] = await Promise.all([
          api.getRun(runId) as Promise<{ run: { status: string; summaryJson: string | null } | null }>,
          api.getRunTurns(runId) as Promise<{ sessions: HydrateSession[] }>,
        ])
        if (cancelled) return
        if (turnsData?.sessions?.length) {
          hydrate(turnsData.sessions)
          const sp: Record<string, string> = {}
          for (const s of turnsData.sessions as Array<{ id: string; personaId?: string }>) {
            if (s.personaId) sp[s.id] = s.personaId
          }
          if (Object.keys(sp).length) setSessionPersona((prev) => ({ ...prev, ...sp }))
        }
        if (!run) return
        let error: string | undefined
        if (run.summaryJson) {
          try { error = (JSON.parse(run.summaryJson) as { errorSample?: string }).errorSample } catch { /* ignore */ }
        }
        setRunState({ status: run.status, error })
        if (run.status === 'finished' || run.status === 'failed' || run.status === 'stopped') stop()
      } catch { /* ignore transient errors */ }
    }
    void poll()
    timer = setInterval(poll, 2000)
    return () => { cancelled = true; stop() }
  }, [active, hydrate, runId])

  const isRunning = runState?.status === 'running' || runState?.status === 'pending'
  const doStop = async () => {
    setShowStopConfirm(false)
    if (!runId || stopping) return
    setStopping(true)
    try { await api.stopRun(runId) } catch { /* 轮询会反映最终状态 */ }
  }

  const handleSelectSession = (sessionId: string) => {
    setSelectedSession(sessionId)
    handleRef.current?.watch(sessionId)
    // 切换会话时清除已选项，避免跨会话 key 残留导致数量异常和 Set 无界累积
    clearSelection()
  }

  const visibleTurns = selectedSession
    ? turns.filter((t) => t.sessionId === selectedSession)
    : turns

  // 多选范围限定在当前可见会话内；selectedTurns 保持显示顺序
  const selectedTurns = visibleTurns.filter((t) => selectedKeys.has(t.key))
  // 「不可导出」= 回复尚未完成（无最终文本且仍在流式输出）
  const isNotExportable = (t: { targetText?: string | null; streaming?: string | null }) =>
    !t.targetText && !!t.streaming
  // 可导出的轮次（已选中且回复已完成）：用于离屏导出节点渲染，确保 DOM 高度与实际导出内容一致
  const exportableTurns = selectedTurns.filter((t) => !isNotExportable(t))
  const toggleKey = (key: string, notExportable: boolean) => {
    if (notExportable) return
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  // selectAllVisible 跳过「不可导出」的流式轮次
  const selectAllVisible = () =>
    setSelectedKeys(new Set(visibleTurns.filter((t) => !isNotExportable(t)).map((t) => t.key)))
  const clearSelection = () => setSelectedKeys(new Set())
  const enterMultiSelect = () => { setMultiSelect(true); setGenError(null) }
  const exitMultiSelect = () => { setMultiSelect(false); clearSelection(); setGenError(null); setTooTall(null) }

  const closePreview = () => {
    setPreviewUrl(null)
    previewBlobRef.current = null
    setCopyState('idle')
  }
  // previewUrl 变化（含置 null）时回收旧 object URL，统一在此一处处理，覆盖替换与卸载场景
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])

  // 生成图片：先量导出节点高度 → 超限则提示用户取消勾选；否则 html-to-image 转 PNG blob。
  const generateImage = async () => {
    if (generating) return
    if (selectedTurns.length === 0) return
    setGenError(null)
    setTooTall(null)
    setGenerating(true)
    try {
      // 防御性兜底：勾选后可能新轮次开始流式，过滤掉此时仍未完成的轮次
      const exportableTurns = selectedTurns.filter((t) => !isNotExportable(t))
      if (exportableTurns.length === 0) { setGenError('所选轮次均在生成中，请等待回复完成后再导出'); return }
      // 等待导出节点按当前勾选渲染/布局完成（双 rAF）再量高
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      const node = exportRef.current
      if (!node) { setGenError('生成失败：导出节点未就绪，请重试'); return }
      const heightPx = node.scrollHeight
      if (heightPx > MAX_EXPORT_HEIGHT) {
        // 超出单图最大高度：保留多选与已选项，提示用户手动取消几条后再点生成
        setTooTall({ heightPx, count: exportableTurns.length })
        return
      }
      const blob = await htmlToImage.toBlob(node, {
        pixelRatio: EXPORT_PIXEL_RATIO,
        backgroundColor: '#ffffff',
        skipFonts: true,        // 不内联 web 字体，规避跨域字体抓取失败；用系统字体渲染足够
        width: EXPORT_WIDTH,
        height: heightPx,
        // 关键：库会把节点连同内联样式克隆进 SVG foreignObject 渲染。导出节点本身是
        // position:fixed; left:-99999px（离屏挂载），克隆体若保留该定位，内容会被画到
        // 画布外 → 生成一张空白图。这里在克隆体上覆写回原点。
        style: { position: 'static', left: '0', top: '0' },
      })
      if (!blob) { setGenError('生成失败：浏览器未能导出图片，请重试或减少选中条数'); return }
      previewBlobRef.current = blob
      // 冻结此次导出的条数，previewUrl effect 会回收旧 URL
      setPreviewCount(exportableTurns.length)
      setPreviewUrl(URL.createObjectURL(blob))
      setCopyState('idle')
    } catch (err) {
      setGenError(`生成失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGenerating(false)
    }
  }

  const copyImage = async () => {
    const blob = previewBlobRef.current
    if (!blob) return
    try {
      // ClipboardItem 写图：需要 https/localhost；Firefox 等不支持时回退到下载
      const Item = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
      if (!Item || !navigator.clipboard?.write) throw new Error('clipboard image unsupported')
      await navigator.clipboard.write([new Item({ 'image/png': blob })])
      setCopyState('copied')
      setTimeout(() => setCopyState('idle'), 2000)
    } catch {
      setCopyState('failed')
    }
  }
  const downloadImage = () => {
    const blob = previewBlobRef.current
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chat-arena-${runLabel?.trim() || runId || 'image'}-${previewCount}条.png`.replace(/[/\\:?*"<>|]/g, '_')
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // 延迟 1s revoke，避免部分浏览器异步处理下载时 URL 被过早释放导致下载取消
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // 导出卡片用：把人设/角色名解析成与页面一致的展示名
  const nameFor = (t: TurnView) => {
    const persona = personaMap[sessionPersona[t.sessionId] ?? '']
    return { userName: persona?.name ?? '用户', targetName: roleInfo?.name ?? '被测 AI' }
  }

  return (
    <div
      ref={rootRef}
      className="relative min-h-screen p-6"
      style={{
        background:
          'radial-gradient(50rem 30rem at 100% -8%, rgba(22,100,255,0.05), transparent 60%), #ffffff',
      }}
    >
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 px-6 py-4 bg-white/85 backdrop-blur border-b border-[#ECECF2] flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-xl font-semibold text-[#15171E] shrink-0">实时评测</h2>
          {active && runLabel && (
            <>
              <span className="text-[#D6D9E0]">/</span>
              <span className="text-sm text-[#6B7280] truncate" title={runLabel}>{runLabel}</span>
            </>
          )}
          {mode === 'replay' && (
            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[#9CA3AF]/15 text-[#6B7280]">历史回放</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* 终止按钮：仅「实时观战」且运行中显示 */}
          {mode === 'live' && isRunning && (
            <button
              type="button"
              onClick={() => setShowStopConfirm(true)}
              disabled={stopping}
              className="px-3 py-1.5 rounded-xl text-xs font-medium border border-[#DC2626]/30 text-[#DC2626] bg-white hover:bg-[#DC2626]/5 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
            >
              <span className="inline-block w-2 h-2 rounded-[2px] bg-[#DC2626]" />
              {stopping ? '终止中…' : '终止'}
            </button>
          )}

          {/* Session switcher — hidden when only one session */}
          {active && sessions.length > 1 && (
            <div className="flex items-center gap-1 bg-white border border-[#ECECF2] rounded-xl p-1 shadow-sm">
              {sessions.map((sid) => (
                <button
                  key={sid}
                  onClick={() => handleSelectSession(sid)}
                  className={[
                    'px-3 py-1.5 rounded-lg text-xs font-mono transition-all duration-150',
                    selectedSession === sid
                      ? 'bg-[#1664FF] text-white shadow-sm'
                      : 'text-[#6B7280] hover:text-[#15171E] hover:bg-black/[0.04]',
                  ].join(' ')}
                >
                  {sid.length > 12 ? `…${sid.slice(-8)}` : sid}
                </button>
              ))}
            </div>
          )}

          {/* 多选 → 生成图片 */}
          {active && visibleTurns.length > 0 && !multiSelect && (
            <button
              type="button"
              onClick={enterMultiSelect}
              className="px-3 py-1.5 rounded-xl text-xs font-medium border border-[#E8E8EE] text-[#6B7280] bg-white hover:text-[#1664FF] hover:border-[#1664FF]/40 transition-colors inline-flex items-center gap-1.5"
            >
              <ImageDown className="w-3.5 h-3.5" />
              生成图片
            </button>
          )}
          {active && multiSelect && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#6B7280] px-1">已选 <span className="font-semibold text-[#1664FF]">{selectedTurns.length}</span> 条</span>
              <button type="button" onClick={selectAllVisible}
                className="px-2.5 py-1.5 rounded-lg text-xs border border-[#E8E8EE] text-[#6B7280] bg-white hover:text-[#15171E] transition-colors">全选</button>
              <button type="button" onClick={clearSelection} disabled={selectedTurns.length === 0}
                className="px-2.5 py-1.5 rounded-lg text-xs border border-[#E8E8EE] text-[#6B7280] bg-white hover:text-[#15171E] disabled:opacity-40 transition-colors">清空</button>
              <button type="button" onClick={() => void generateImage()} disabled={selectedTurns.length === 0 || generating}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white inline-flex items-center gap-1.5 disabled:opacity-40 transition-opacity"
                style={{ background: 'linear-gradient(135deg, #1664FF, #5B9CFF)' }}>
                {generating ? (
                  <><svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>生成中…</>
                ) : (<><ImageDown className="w-3.5 h-3.5" />生成图片</>)}
              </button>
              <button type="button" onClick={exitMultiSelect}
                className="px-2.5 py-1.5 rounded-lg text-xs border border-[#E8E8EE] text-[#6B7280] bg-white hover:text-[#DC2626] transition-colors">退出</button>
            </div>
          )}

        </div>
      </div>

      {/* Bug 2: WS 断连提示条（非主动关闭时显示，重连成功后消失） */}
      {wsDisconnected && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#D97706]/30 bg-[#D97706]/8 px-4 py-2.5 text-sm text-[#D97706]">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#D97706] shrink-0" />
          实时连接已断开，正在依赖轮询兜底；后台尝试重连中…
        </div>
      )}

      {/* 多选模式提示条 */}
      {active && multiSelect && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#1664FF]/25 bg-[#1664FF]/[0.04] px-4 py-2.5 text-sm text-[#1664FF]">
          <ImageDown className="w-4 h-4 shrink-0" />
          多选模式：点击对话卡片勾选要导出的内容，选好后点右上角「生成图片」。
        </div>
      )}
      {genError && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#DC2626]/30 bg-[#DC2626]/8 px-4 py-2.5 text-sm text-[#DC2626]">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#DC2626] shrink-0" />
          <span className="flex-1">{genError}</span>
          <button type="button" onClick={() => setGenError(null)} className="text-[#DC2626]/70 hover:text-[#DC2626]"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* 判定中：短暂占位，避免闪现旧内容 */}
      {mode === 'loading' && (
        <div className="mt-24 flex justify-center text-[#C2C7D0] text-sm">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#C2C7D0] mr-2 animate-pulse align-middle" />
          加载中…
        </div>
      )}

      {/* 无进行中的观战：不展示旧内容，引导去配置开启新的观战 */}
      {mode === 'cta' && (
        <div className="mt-24 flex justify-center">
          <div
            className="max-w-md w-full text-center rounded-2xl border border-[#ECECF2] bg-white px-8 py-10"
            style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
          >
            <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-[#1664FF]/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-[#1664FF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </div>
            <p className="text-base font-semibold text-[#15171E] mb-1">当前没有正在进行的评测</p>
            <p className="text-sm text-[#6B7280] mb-6 leading-relaxed">
              去「新建评测」设置参数并开启一次新的评测吧。<br />
              想回看已结束的对话，可在「评测记录」页选择。
            </p>
            <button
              onClick={() => navigate('/config')}
              className="px-5 py-2.5 rounded-xl text-sm text-white font-medium transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #1664FF, #5B9CFF)' }}
            >
              新建评测
            </button>
          </div>
        </div>
      )}

      {active && visibleTurns.length === 0 && (
        <div className="mt-20 flex justify-center">
          {runState?.status === 'failed' ? (
            <div className="max-w-xl rounded-xl border border-[#DC2626]/20 bg-[#DC2626]/5 px-5 py-4 text-sm text-[#DC2626]">
              <p className="font-semibold mb-1">本次运行失败</p>
              {runState.error
                ? <p className="font-mono text-xs break-all text-[#DC2626]/80">{runState.error}</p>
                : <p className="text-xs text-[#DC2626]/80">未产生任何对话。</p>}
              <p className="text-xs text-[#DC2626]/70 mt-2">
                常见原因：所选「模拟用户模型 / 裁判模型」在当前环境不可用，或被测 AI 连接失败。请回到配置页改用已配置 key 的模型后重试。
              </p>
            </div>
          ) : runState?.status === 'finished' ? (
            <div className="max-w-xl rounded-xl border border-[#D97706]/20 bg-[#D97706]/5 px-5 py-4 text-sm text-[#D97706]">
              <p className="font-semibold mb-1">本次运行已结束，但没有产生任何对话</p>
              <p className="text-xs text-[#D97706]/80">通常是所选模型不可用或被测 AI 连接失败。请在配置页检查模型与连接后重试。</p>
            </div>
          ) : runState?.status === 'running' || runState?.status === 'pending' ? (
            <div className="text-center text-[#6B7280] text-sm">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#1664FF] mr-2 animate-pulse align-middle" />
              运行中，正在等待第一条消息…（首轮需依次生成用户消息 → 角色回复 → 评分，稍候即可；若长时间无任何内容，多为模型调用慢/失败或实时连接异常）
            </div>
          ) : (
            <div className="text-center text-[#9CA3AF] text-sm">
              在配置页创建一个 Run 后，对话将在这里实时显示
            </div>
          )}
        </div>
      )}

      <div className="space-y-5">
        {active && visibleTurns.map((t) => {
          const persona = personaMap[sessionPersona[t.sessionId] ?? '']
          const userName = persona?.name ?? '用户'
          const targetName = roleInfo?.name ?? '被测 AI'
          const selected = selectedKeys.has(t.key)
          const notExportable = isNotExportable(t)
          return (
          <div
            key={t.key}
            onClick={multiSelect && !notExportable ? () => toggleKey(t.key, notExportable) : undefined}
            title={multiSelect && notExportable ? '回复生成中，暂不可导出' : undefined}
            className={[
              'flex items-stretch rounded-2xl border bg-white overflow-hidden transition-colors',
              multiSelect && !notExportable ? 'cursor-pointer' : '',
              multiSelect && notExportable ? 'cursor-not-allowed' : '',
              selected ? 'border-[#1664FF] ring-2 ring-[#1664FF]/30' : 'border-[#ECECF2]',
            ].join(' ')}
            style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)' }}
          >
            {/* 多选：左侧勾选列；流式未完成的轮次置灰不可勾选 */}
            {multiSelect && (
              <div
                className={`flex items-center justify-center w-11 shrink-0 border-r ${selected ? 'border-[#1664FF]/30 bg-[#1664FF]/[0.04]' : 'border-[#ECECF2] bg-[#FAFBFD]'}`}
                title={notExportable ? '回复生成中，暂不可导出' : undefined}
              >
                {selected
                  ? <SquareCheckBig className="w-5 h-5 text-[#1664FF]" />
                  : notExportable
                    ? <Square className="w-5 h-5 text-[#D1D5DB] opacity-50" />
                    : <Square className="w-5 h-5 text-[#C2C7D0]" />}
              </div>
            )}
            {/* 左：对话区 */}
            <div className="flex-1 min-w-0 p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-widest text-[#C2C7D0] font-mono">对话 · 第 {t.idx + 1} 轮</div>
              {/* 用户（人设）bubble — right aligned, 头像在右 */}
              {t.userText && (
                <div className="flex justify-end items-start gap-2">
                  <div className="max-w-[78%] rounded-2xl rounded-tr-sm bg-[#F1F3F9] border border-[#E8E8EE] px-4 py-3 text-sm text-[#15171E] whitespace-pre-wrap">
                    <div className="text-xs text-[#9CA3AF] mb-1 font-mono">{userName}</div>
                    {t.userText}
                  </div>
                  <Avatar src={persona?.avatar} name={userName} />
                </div>
              )}
              {/* 角色（target）bubble — left aligned, 头像在左 */}
              {(t.targetText || t.streaming) && (
                <div className="flex justify-start items-start gap-2">
                  <Avatar src={roleInfo?.avatar} name={targetName} />
                  <div
                    className="max-w-[78%] rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-[#15171E] whitespace-pre-wrap"
                    style={{ background: 'rgba(22,100,255,0.06)', border: '1px solid rgba(22,100,255,0.18)' }}
                  >
                    <div className="text-xs text-[#1664FF] mb-1 font-mono font-medium">{targetName}</div>
                    {t.targetText || t.streaming}
                    {!t.targetText && t.streaming && (
                      <span className="inline-block w-0.5 h-4 bg-[#1664FF] ml-0.5 animate-pulse" />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 右：评分区（浅灰底 + 左分隔线，undefined=未产生；null=评分中；对象=已评分） */}
            <div className="w-80 shrink-0 border-l border-[#ECECF2] bg-[#FAFBFD] p-4">
              <div className="text-[10px] uppercase tracking-widest text-[#C2C7D0] font-mono mb-2">评分</div>
              {t.score === undefined ? (
                <div className="text-xs text-[#C2C7D0]">—</div>
              ) : t.score === null ? (
                <div className="text-xs text-[#9CA3AF]">评分中…</div>
              ) : t.score.judgeError ? (
                <div className="text-xs text-[#D97706]">裁判异常：{t.score.judgeError}</div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold font-mono text-[#1664FF] leading-none">
                      {t.score.overall?.toFixed(1) ?? '—'}
                    </span>
                    <span className="text-xs text-[#9CA3AF]">/ 10</span>
                    {t.score.violation && (
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[#DC2626]/10 text-[#DC2626] font-medium">违规</span>
                    )}
                  </div>
                  {t.score.comment && (
                    <div className="text-xs text-[#6B7280] leading-relaxed">{t.score.comment}</div>
                  )}
                  {t.score.suggestion && (
                    <div className="text-xs text-[#9CA3AF] border-t border-[#ECECF2] pt-2">
                      <span className="text-[#1664FF] mr-1 font-medium">改进</span>
                      {t.score.suggestion}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* 悬浮跳转按钮（右下角，仅 live/replay 且内容可滚动时显示） */}
      {active && scrollable && (
        <div className="fixed bottom-6 right-6 z-30 flex flex-col gap-2">
          <button
            type="button"
            onClick={scrollToTop}
            disabled={atTop}
            title="回到顶部"
            aria-label="回到顶部"
            className="w-10 h-10 rounded-full bg-white border border-[#E8E8EE] text-[#6B7280] shadow-md flex items-center justify-center hover:text-[#1664FF] hover:border-[#1664FF]/40 transition-colors disabled:opacity-40 disabled:hover:text-[#6B7280] disabled:hover:border-[#E8E8EE]"
          >
            <ArrowUpToLine className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={scrollToBottom}
            disabled={atBottom}
            title={hasNew ? '有新回复 · 回到底部' : '回到底部'}
            aria-label="回到底部"
            className="relative w-10 h-10 rounded-full bg-white border border-[#E8E8EE] text-[#6B7280] shadow-md flex items-center justify-center hover:text-[#1664FF] hover:border-[#1664FF]/40 transition-colors disabled:opacity-40 disabled:hover:text-[#6B7280] disabled:hover:border-[#E8E8EE]"
          >
            <ArrowDownToLine className="w-4 h-4" />
            {hasNew && !atBottom && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#EF4444] opacity-60 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#EF4444]" />
              </span>
            )}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showStopConfirm}
        title="终止本次评测？"
        message="已产生的对话与评分会保留，未跑完的会话将停止。"
        confirmText="终止"
        danger
        onConfirm={() => void doStop()}
        onCancel={() => setShowStopConfirm(false)}
      />

      {/* 内容超出图片最大高度：提示用户取消勾选几条后重试（保留多选与已选项） */}
      <ConfirmDialog
        open={tooTall !== null}
        title="内容过多，超出单张图片高度上限"
        message={tooTall ? (
          <>
            当前选中 {tooTall.count} 条，预估高度约 {tooTall.heightPx}px，超过单张图片上限 {MAX_EXPORT_HEIGHT}px。
            <br />
            <span className="text-xs text-[#9CA3AF]">请取消勾选几条后，再点击「生成图片」重新生成。</span>
          </>
        ) : null}
        confirmText="去取消勾选"
        hideCancel
        onConfirm={() => setTooTall(null)}
        onCancel={() => setTooTall(null)}
      />

      {/* 离屏导出节点：仅多选时挂载，html-to-image 据此渲染图片（固定宽度、屏幕外） */}
      {active && multiSelect && (
        <div
          ref={exportRef}
          aria-hidden
          style={{ position: 'fixed', left: -99999, top: 0, width: EXPORT_WIDTH, background: '#ffffff', padding: 24, boxSizing: 'border-box', pointerEvents: 'none' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #ECECF2' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#15171E' }}>模拟评测</span>
              {runLabel && <span style={{ fontSize: 13, color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {runLabel}</span>}
            </div>
            <span style={{ fontSize: 12, color: '#9CA3AF', flexShrink: 0 }}>共 {exportableTurns.length} 条</span>
          </div>
          {exportableTurns.map((t) => {
            const { userName, targetName } = nameFor(t)
            return <ExportCard key={t.key} t={t} userName={userName} targetName={targetName} />
          })}
        </div>
      )}

      {/* 生成结果预览：复制 / 下载 */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closePreview}>
          <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#ECECF2] shrink-0">
              <h3 className="text-base font-semibold text-[#15171E]">图片已生成（{previewCount} 条）</h3>
              <button type="button" onClick={closePreview} className="text-[#9CA3AF] hover:text-[#15171E]"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex-1 overflow-auto bg-[#F7F8FB] p-4">
              <img src={previewUrl} alt="评测内容图片" className="w-full rounded-lg border border-[#ECECF2] bg-white" />
            </div>
            <div className="flex items-center gap-2 px-5 py-3.5 border-t border-[#ECECF2] shrink-0">
              <button
                type="button"
                onClick={() => void copyImage()}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white inline-flex items-center gap-1.5 transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #1664FF, #5B9CFF)' }}
              >
                <Copy className="w-4 h-4" />
                {copyState === 'copied' ? '已复制 ✓' : '复制图片'}
              </button>
              <button
                type="button"
                onClick={downloadImage}
                className="px-4 py-2 rounded-xl text-sm border border-[#E8E8EE] text-[#6B7280] bg-white hover:text-[#15171E] inline-flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-4 h-4" />
                下载
              </button>
              {copyState === 'failed' && (
                <span className="text-xs text-[#D97706] ml-1">当前浏览器不支持复制图片，请改用「下载」或右键图片另存。</span>
              )}
              <span className="ml-auto text-xs text-[#C2C7D0]">右键图片可另存</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
