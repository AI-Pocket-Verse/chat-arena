import { useEffect, useState } from 'react'

// 纯 SVG / CSS 图表，无第三方依赖（与 Compare 的雷达图一致的手写风格）。
// 首次挂载时播放一次入场动画：line 用 stroke-dashoffset 描边，bar 用 height 过渡，
// donut 用 stroke-dasharray 过渡。轮询刷新只更新数值（平滑过渡），不会重播入场动画。

// 进入动画开关：组件挂载后下一帧置 true，触发 CSS 过渡 / 描边。
function useGrown(): boolean {
  const [grown, setGrown] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setGrown(true))
    return () => cancelAnimationFrame(r)
  }, [])
  return grown
}

const BLUE = '#1664FF'

// ── 折线图 ────────────────────────────────────────────────────────────────
export function LineChart({
  values, max = 10, color = BLUE, height = 200, unit, valueFmt,
}: {
  values: number[]
  max?: number
  color?: string
  height?: number
  unit?: string
  valueFmt?: (v: number) => string
}) {
  const grown = useGrown()
  const W = 560
  const H = height
  const padX = 36
  const padY = 18
  const n = values.length

  if (n === 0) {
    return <div className="flex items-center justify-center text-xs text-[#9CA3AF]" style={{ height: H }}>暂无数据</div>
  }

  const innerW = W - padX * 2
  const innerH = H - padY * 2
  const top = max
  const x = (i: number) => padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const y = (v: number) => padY + innerH - (Math.max(0, Math.min(top, v)) / top) * innerH

  const linePath = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${x(n - 1).toFixed(1)},${(padY + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padY + innerH).toFixed(1)} Z`

  // 水平网格线（4 等分）
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)

  const gradId = `lc-${color.replace('#', '')}`

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* grid + y labels */}
      {gridVals.map((gv, i) => {
        const gy = y(gv)
        return (
          <g key={i}>
            <line x1={padX} y1={gy} x2={W - padX} y2={gy} stroke="#EEF0F4" strokeWidth="1" />
            <text x={padX - 6} y={gy + 3} textAnchor="end" fontSize="9" fill="#B6BBC6" fontFamily="monospace">
              {valueFmt ? valueFmt(gv) : Math.round(gv)}
            </text>
          </g>
        )
      })}
      {/* area */}
      <path d={areaPath} fill={`url(#${gradId})`} opacity={grown ? 1 : 0} style={{ transition: 'opacity 0.9s ease 0.3s' }} />
      {/* line（描边动画） */}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={grown ? 0 : 1}
        style={{ transition: 'stroke-dashoffset 1.1s ease' }}
      />
      {/* points */}
      {values.map((v, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={y(v)}
          r={n > 60 ? 0 : 2.6}
          fill="#fff"
          stroke={color}
          strokeWidth="1.6"
          opacity={grown ? 1 : 0}
          style={{ transition: `opacity 0.4s ease ${0.5 + Math.min(i, 40) * 0.012}s` }}
        >
          <title>{`#${i + 1}: ${valueFmt ? valueFmt(v) : v}${unit ?? ''}`}</title>
        </circle>
      ))}
    </svg>
  )
}

// ── 柱状图（垂直）────────────────────────────────────────────────────────
export function BarChart({
  items, max, height = 220, color = BLUE, valueFmt,
}: {
  items: Array<{ label: string; value: number }>
  max: number
  height?: number
  color?: string
  valueFmt?: (v: number) => string
}) {
  const grown = useGrown()
  if (items.length === 0) {
    return <div className="flex items-center justify-center text-xs text-[#9CA3AF]" style={{ height }}>暂无数据</div>
  }
  return (
    <div className="flex items-end gap-3" style={{ height }}>
      {items.map((it, i) => {
        const pct = max > 0 ? Math.max(0, Math.min(100, (it.value / max) * 100)) : 0
        return (
          <div key={it.label} className="flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-1.5">
            <span className="text-[11px] font-mono text-[#15171E]">{valueFmt ? valueFmt(it.value) : it.value.toFixed(1)}</span>
            <div className="w-full rounded-t-md" style={{ height: '100%', display: 'flex', alignItems: 'flex-end' }}>
              <div
                className="w-full rounded-t-md"
                style={{
                  height: grown ? `${pct}%` : '0%',
                  background: `linear-gradient(180deg, ${color}, #5B9CFF)`,
                  transition: `height 0.8s cubic-bezier(0.22,1,0.36,1) ${i * 0.07}s`,
                }}
              />
            </div>
            <span className="text-[11px] text-[#6B7280] truncate w-full text-center" title={it.label}>{it.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── 环形图（饼图）──────────────────────────────────────────────────────────
export function DonutChart({
  slices, size = 188, thickness = 26, centerLabel, centerValue,
}: {
  slices: Array<{ label: string; value: number; color: string }>
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: string
}) {
  const grown = useGrown()
  const total = slices.reduce((s, x) => s + x.value, 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const cx = size / 2
  const cy = size / 2

  let acc = 0
  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" className="shrink-0">
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EEF0F4" strokeWidth={thickness} />
          {total > 0 && slices.map((s, i) => {
            const frac = s.value / total
            const arc = frac * c
            const offset = acc
            acc += arc
            return (
              <circle
                key={s.label}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeLinecap="butt"
                strokeDasharray={`${grown ? arc : 0} ${c}`}
                strokeDashoffset={-offset}
                style={{ transition: `stroke-dasharray 0.9s cubic-bezier(0.22,1,0.36,1) ${i * 0.12}s` }}
              >
                <title>{`${s.label}: ${s.value}`}</title>
              </circle>
            )
          })}
        </g>
        {(centerValue || centerLabel) && (
          <>
            <text x={cx} y={cy - 2} textAnchor="middle" fontSize="22" fontWeight="700" fill="#15171E" fontFamily="monospace">{centerValue}</text>
            <text x={cx} y={cy + 16} textAnchor="middle" fontSize="10" fill="#9CA3AF">{centerLabel}</text>
          </>
        )}
      </svg>
      <div className="space-y-2 min-w-0">
        {slices.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0
          return (
            <div key={s.label} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="text-[#6B7280] truncate">{s.label}</span>
              <span className="ml-auto font-mono text-[#15171E]">{s.value}</span>
              <span className="text-[#9CA3AF] w-9 text-right">{pct}%</span>
            </div>
          )
        })}
        {total === 0 && <div className="text-xs text-[#9CA3AF]">暂无评分数据</div>}
      </div>
    </div>
  )
}

// ── 雷达图（单序列，多维一眼对比）──────────────────────────────────────────
export function RadarChart({
  items, max = 10, size = 240, color = BLUE,
}: {
  items: Array<{ label: string; value: number | null }>
  max?: number
  size?: number
  color?: string
}) {
  const grown = useGrown()
  const n = items.length
  if (n < 3) {
    return <div className="flex items-center justify-center text-xs text-[#9CA3AF]" style={{ height: size }}>暂无足够维度</div>
  }
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 30
  // viewBox 四周留白，避免维度文字（尤其左右两侧）被裁掉/盖住。
  const padX = 66
  const padY = 26
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2
  const point = (i: number, val: number): [number, number] => {
    const rad = (Math.max(0, Math.min(max, val)) / max) * r
    return [cx + rad * Math.cos(angle(i)), cy + rad * Math.sin(angle(i))]
  }
  const rings = [0.25, 0.5, 0.75, 1].map((f) => items.map((_, i) => point(i, f * max).join(',')).join(' '))
  const axes = items.map((_, i) => point(i, max))
  const labels = items.map((it, i) => {
    const a = angle(i)
    const lx = cx + (r + 14) * Math.cos(a)
    const ly = cy + (r + 14) * Math.sin(a)
    return { ...it, lx, ly, anchor: Math.abs(Math.cos(a)) < 0.3 ? 'middle' : (Math.cos(a) > 0 ? 'start' : 'end') as 'middle' | 'start' | 'end' }
  })
  const poly = items.map((it, i) => point(i, typeof it.value === 'number' ? it.value : 0).join(',')).join(' ')

  return (
    <svg width="100%" viewBox={`${-padX} ${-padY} ${size + padX * 2} ${size + padY * 2}`} preserveAspectRatio="xMidYMid meet" role="img">
      {rings.map((pts, i) => <polygon key={i} points={pts} fill="none" stroke="#EEF0F4" strokeWidth="1" />)}
      {axes.map(([x, y], i) => <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#EEF0F4" strokeWidth="1" />)}
      {/* 数值多边形：从中心 scale 进入 */}
      <g style={{ transform: grown ? 'scale(1)' : 'scale(0.01)', transformOrigin: `${cx}px ${cy}px`, transition: 'transform 0.7s cubic-bezier(0.22,1,0.36,1)' }}>
        <polygon points={poly} fill={`${color}26`} stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {items.map((it, i) => {
          const [x, y] = point(i, typeof it.value === 'number' ? it.value : 0)
          return <circle key={i} cx={x} cy={y} r={2.6} fill="#fff" stroke={color} strokeWidth="1.6" />
        })}
      </g>
      {labels.map((l, i) => (
        <text key={i} x={l.lx} y={l.ly} textAnchor={l.anchor} dominantBaseline="middle" fontSize="10" fill="#6B7280">
          {l.label}<tspan dx="4" fill="#15171E" fontFamily="monospace">{typeof l.value === 'number' ? l.value.toFixed(1) : '—'}</tspan>
        </text>
      ))}
    </svg>
  )
}
