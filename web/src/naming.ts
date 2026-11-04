// Run 名称 / 版本标注的允许字符：英文字母、数字，以及常用特殊字符 - _ . 。其余不支持。
export const NAME_ALLOWED_RE = /^[A-Za-z0-9._-]*$/

// pinyin-pro 自带较大的汉字词典——按需懒加载，避免进主包。
// 首次需要时动态 import；加载完成前 toSlug 对中文返回空串，调用方应在
// ensurePinyinLoaded() resolve 后再触发一次重算（见 Config 的 pinyinReady）。
type PinyinFn = (s: string, opts: Record<string, unknown>) => string[]
let pinyinFn: PinyinFn | null = null
let loadPromise: Promise<void> | null = null

export function ensurePinyinLoaded(): Promise<void> {
  if (pinyinFn) return Promise.resolve()
  if (!loadPromise) {
    loadPromise = import('pinyin-pro').then((m) => { pinyinFn = m.pinyin as unknown as PinyinFn })
  }
  return loadPromise
}

// 中文 → 拼音（无声调），并清掉非 [a-z0-9] 字符；非中文按原样保留（连续）。
// 例如「诺拉」→「nuola」。词典未就绪时只保留其中的 ASCII 部分。
export function toSlug(s: string): string {
  if (!s) return ''
  if (!pinyinFn) return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const py = pinyinFn(s, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('')
  return py.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// 当天日期：YYYYMMDD
export function todayStamp(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 在已有命名里匹配 `${base}-v<N>`，返回最大 N + 1（找不到则 1）。
// 用于「不自定义时，每次在之前基础上自增 v」。
export function nextVersion(base: string, existing: Array<string | null | undefined>): number {
  if (!base) return 1
  const re = new RegExp(`^${escapeRe(base)}-v(\\d+)`, 'i')
  let max = 0
  for (const name of existing) {
    const m = name?.match(re)
    if (m) max = Math.max(max, parseInt(m[1]!, 10))
  }
  return max + 1
}

// Run 名称默认：人设名-角色名-vN-日期（名字转拼音）。无人设/角色时返回空串。
export function buildRunName(
  personaName: string,
  roleName: string,
  existing: Array<string | null | undefined>,
  d = new Date(),
): string {
  const base = [toSlug(personaName), toSlug(roleName)].filter(Boolean).join('-')
  if (!base) return ''
  return `${base}-v${nextVersion(base, existing)}-${todayStamp(d)}`
}

// 版本标注默认：角色名-vN-日期。无角色时返回空串。
export function buildVersionLabel(
  roleName: string,
  existing: Array<string | null | undefined>,
  d = new Date(),
): string {
  const base = toSlug(roleName)
  if (!base) return ''
  return `${base}-v${nextVersion(base, existing)}-${todayStamp(d)}`
}
