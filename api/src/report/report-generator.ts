import { pick } from '../i18n'
import type { Lang } from '../i18n'

export interface TurnForReport {
  idx: number
  sessionId: string
  personaName?: string
  repetitionIndex?: number
  userText: string
  targetText: string
  overall: number
  comment: string
  improvementSuggestion: string
  dims: Record<string, number>
  violation: boolean
  judgeError?: string | null
}

export interface SuggestionCluster {
  suggestion: string
  turnIdxes: number[]
  count: number
}

// 评测维度（与 judge-engine 一致）+ 中文名
export const DIM_KEYS = ['personaFit', 'empathy', 'memoryAccuracy', 'safety', 'naturalness', 'relevance'] as const
export const DIM_NAMES: Record<string, string> = {
  personaFit: '人设贴合', empathy: '情感共情', memoryAccuracy: '记忆准确',
  safety: '安全合规', naturalness: '自然流畅', relevance: '相关性',
}
const DIM_NAMES_EN: Record<string, string> = {
  personaFit: 'Persona fit', empathy: 'Empathy', memoryAccuracy: 'Memory accuracy',
  safety: 'Safety', naturalness: 'Naturalness', relevance: 'Relevance',
}
/** 按语言取维度名；zh 与 DIM_NAMES 相同 */
export const dimNamesFor = (lang: Lang = 'zh'): Record<string, string> => (lang === 'en' ? DIM_NAMES_EN : DIM_NAMES)

// 跨会话可读标签：人设名 · 重复#k · 第n轮（解决多会话 idx 撞号、无法溯源的问题）
export function turnLabel(t: TurnForReport, lang: Lang = 'zh'): string {
  const persona = t.personaName?.trim() || pick(lang, { zh: '会话', en: 'Session' })
  const rep = typeof t.repetitionIndex === 'number' ? pick(lang, { zh: ` · 重复#${t.repetitionIndex + 1}`, en: ` · Repetition #${t.repetitionIndex + 1}` }) : ''
  return pick(lang, { zh: `${persona}${rep} · 第 ${t.idx + 1} 轮`, en: `${persona}${rep} · Turn ${t.idx + 1}` })
}

// 稳定排序键：先按会话再按 idx，保证同分时样本可复现。
const stableKey = (t: TurnForReport) => `${t.personaName ?? ''}#${t.sessionId}#${String(t.idx).padStart(4, '0')}`

/** Returns top-N lowest-scored turns, excluding judge-failed turns. */
export function worstTurns(turns: TurnForReport[], topN: number): TurnForReport[] {
  return turns
    .filter(t => !t.judgeError)
    .sort((a, b) => a.overall - b.overall || stableKey(a).localeCompare(stableKey(b)))
    .slice(0, topN)
}

/** Returns top-N highest-scored turns, excluding judge-failed turns. */
export function bestTurns(turns: TurnForReport[], topN: number): TurnForReport[] {
  return turns
    .filter(t => !t.judgeError)
    .sort((a, b) => b.overall - a.overall || stableKey(a).localeCompare(stableKey(b)))
    .slice(0, topN)
}

const byOverall = (a: TurnForReport, b: TurnForReport) => a.overall - b.overall || stableKey(a).localeCompare(stableKey(b))

// 分层选最差：先轮询从每个人设取其最差（worst-1 per persona, then worst-2…），再全局补足到 total，
// 避免单个对抗人设霸占全部低分位。最终按分升序展示。
export function stratifiedWorst(turns: TurnForReport[], perPersona: number, total: number): TurnForReport[] {
  const scored = turns.filter(t => !t.judgeError)
  const byPersona = new Map<string, TurnForReport[]>()
  for (const t of scored) {
    const k = t.personaName ?? t.sessionId
    const arr = byPersona.get(k)
    if (arr) arr.push(t)
    else byPersona.set(k, [t])
  }
  // 每个人设内部按分升序；人设之间按各自最差分升序（最差的人设优先）
  const lists = [...byPersona.values()].map(l => l.sort(byOverall))
  lists.sort((a, b) => (a[0]?.overall ?? Infinity) - (b[0]?.overall ?? Infinity))

  const picked: TurnForReport[] = []
  const pickedKeys = new Set<string>()
  for (let round = 0; round < perPersona && picked.length < total; round++) {
    for (const l of lists) {
      if (picked.length >= total) break
      const t = l[round]
      if (t) { picked.push(t); pickedKeys.add(stableKey(t)) }
    }
  }
  // 仍有空位 → 用全局剩余（最差优先）补足
  if (picked.length < total) {
    for (const t of scored.filter(t => !pickedKeys.has(stableKey(t))).sort(byOverall)) {
      if (picked.length >= total) break
      picked.push(t); pickedKeys.add(stableKey(t))
    }
  }
  return picked.sort(byOverall).slice(0, total)
}

export function clusterSuggestions(turns: TurnForReport[]): SuggestionCluster[] {
  const map = new Map<string, number[]>()
  for (const t of turns) {
    if (t.judgeError) continue
    const s = t.improvementSuggestion.trim()
    if (!s || s === '保持' || /^(keep|keep as is)[.!]?$/i.test(s)) continue
    const existing = map.get(s)
    if (existing) existing.push(t.idx)
    else map.set(s, [t.idx])
  }
  return [...map.entries()]
    .map(([suggestion, turnIdxes]) => ({ suggestion, turnIdxes, count: turnIdxes.length }))
    .sort((a, b) => b.count - a.count)
}

export interface ScoreDistribution { excellent: number; good: number; fair: number; weak: number }

/** 各维度均值（仅统计有有效评分的轮）。 */
export function dimMeansOf(turns: TurnForReport[]): Record<string, number | null> {
  const scored = turns.filter(t => !t.judgeError)
  const out: Record<string, number | null> = {}
  for (const k of DIM_KEYS) {
    const vals = scored.map(t => t.dims[k]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    out[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  return out
}

/** 评分档位分布：优秀≥8 / 良好[6,8) / 一般[4,6) / 偏弱<4（防御性跳过非有限/<1 的哨兵值）。 */
export function distributionOf(turns: TurnForReport[]): ScoreDistribution {
  const d: ScoreDistribution = { excellent: 0, good: 0, fair: 0, weak: 0 }
  for (const t of turns) {
    if (t.judgeError) continue
    const v = t.overall
    if (!Number.isFinite(v) || v < 1) continue
    if (v >= 8) d.excellent++
    else if (v >= 6) d.good++
    else if (v >= 4) d.fair++
    else d.weak++
  }
  return d
}

// ── LLM 综合评测结果（多角度）────────────────────────────────────────────────
export interface SynthesisDimension { key: string; assessment: string; suggestion: string }
export interface SynthesisResult {
  overallAssessment: string
  dimensions: SynthesisDimension[]
  strengths: string[]
  weaknesses: string[]
  promptChanges: string
  revisedPrompt: string              // 基于原始角色 prompt 的完整修订版（无原始 prompt 时为空）
  memoryIssues: string
  safetyIssues: string
  prioritizedActions: string[]
}

export interface SynthesisSample {
  idx: number; sessionLabel: string; userText: string; targetText: string
  overall: number; dims: Record<string, number>; comment: string; suggestion: string; violation: boolean
}
export interface SynthesisInput {
  lang?: Lang
  stats: {
    totalTurns: number
    scoredTurns: number
    avgOverall: number | null
    violations: number
    memoryHitRate: number | null
    memoryMisses: number
    dimMeans: Record<string, number | null>
  }
  dimNames: Record<string, string>
  distribution: ScoreDistribution
  worstSamples: SynthesisSample[]
  bestSamples: SynthesisSample[]
  violationSamples: SynthesisSample[]
  suggestions: string[]
  originalPrompt: string | null      // 被测角色的系统提示词（用于生成 revisedPrompt）
}

export interface ReportDimension { key: string; name: string; score: number | null; assessment: string; suggestion: string }

export interface ReportInput {
  lang?: Lang
  runId: string
  totalSessions: number
  totalTurns: number
  scoredTurns: number
  judgeFailedCount: number
  avgOverall: number | null
  violations: number
  memoryHitRate: number | null
  memoryMisses: number
  overallAssessment: string
  dimensions: ReportDimension[]
  distribution: ScoreDistribution
  strengths: string[]
  weaknesses: string[]
  promptChanges: string
  originalPrompt: string | null
  revisedPrompt: string
  memoryIssues: string
  safetyIssues: string
  prioritizedActions: string[]
  worstTurns: TurnForReport[]
  bestTurns: TurnForReport[]
  violationTurns: TurnForReport[]
}

const fmt1 = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—')
const cell = (s: string, lang: Lang = 'zh') => (s || '—').replace(/\n/g, ' ').replace(/\|/g, lang === 'en' ? '\\|' : '｜')

function turnBlock(t: TurnForReport, lang: Lang): string {
  const names = dimNamesFor(lang)
  const dimsText = DIM_KEYS
    .map(k => (typeof t.dims[k] === 'number' ? `${names[k]} ${t.dims[k]}` : null))
    .filter(Boolean)
    .join(' · ')
  return [
    pick(lang, { zh: `### ${turnLabel(t, lang)} — 综合分 ${t.overall.toFixed(1)} / 10`, en: `### ${turnLabel(t, lang)} — Overall ${t.overall.toFixed(1)} / 10` }),
    dimsText ? pick(lang, { zh: `**各维度：** ${dimsText}`, en: `**Dimensions:** ${dimsText}` }) : '',
    pick(lang, { zh: `**用户：** ${t.userText}`, en: `**User:** ${t.userText}` }),
    pick(lang, { zh: `**被测 AI：** ${t.targetText}`, en: `**AI under test:** ${t.targetText}` }),
    t.comment ? pick(lang, { zh: `**点评：** ${t.comment}`, en: `**Comment:** ${t.comment}` }) : '',
    t.improvementSuggestion ? pick(lang, { zh: `**改进建议：** ${t.improvementSuggestion}`, en: `**Suggestion:** ${t.improvementSuggestion}` }) : '',
    t.violation ? pick(lang, { zh: `**⚠️ 违规**`, en: `**⚠️ Violation**` }) : '',
    ``,
  ].filter(Boolean).join('\n')
}

export function buildReportMarkdown(input: ReportInput): string {
  const lang: Lang = input.lang ?? 'zh'
  const L = (zh: string, en: string) => pick(lang, { zh, en })
  const none = L('（无）', '(none)')
  const dims = input.dimensions ?? []
  const strengths = input.strengths ?? []
  const weaknesses = input.weaknesses ?? []
  const actions = input.prioritizedActions ?? []
  const violations = input.violationTurns ?? []
  const dist = input.distribution ?? { excellent: 0, good: 0, fair: 0, weak: 0 }

  const lines: string[] = [
    L(`# 评测报告`, `# Evaluation report`),
    ``,
    `**Run ID:** ${input.runId}`,
    L(`**会话数:** ${input.totalSessions} | **总轮数:** ${input.totalTurns} | **有效评分:** ${input.scoredTurns}` +
      (input.judgeFailedCount > 0 ? ` | **裁判失败:** ${input.judgeFailedCount}` : ''),
      `**Sessions:** ${input.totalSessions} | **Total turns:** ${input.totalTurns} | **Scored turns:** ${input.scoredTurns}` +
      (input.judgeFailedCount > 0 ? ` | **Judge failures:** ${input.judgeFailedCount}` : '')),
    L(`**平均综合分:** ${input.avgOverall != null ? `${input.avgOverall.toFixed(2)} / 10` : '—'} | **违规数:** ${input.violations}`,
      `**Average overall score:** ${input.avgOverall != null ? `${input.avgOverall.toFixed(2)} / 10` : '—'} | **Violations:** ${input.violations}`),
    input.memoryHitRate != null
      ? L(`**记忆命中率:** ${(input.memoryHitRate * 100).toFixed(0)}% | **记忆未命中:** ${input.memoryMisses} 次`,
          `**Memory hit rate:** ${(input.memoryHitRate * 100).toFixed(0)}% | **Memory misses:** ${input.memoryMisses}`)
      : '',
    ``,
    L(`## 总体评价`, `## Overall assessment`),
    ``,
    input.overallAssessment?.trim() || none,
    ``,
    L(`## 各维度评估`, `## Dimension assessment`),
    ``,
    L(`| 维度 | 均分 | 评价 | 建议 |`, `| Dimension | Avg | Assessment | Suggestion |`),
    `| --- | --- | --- | --- |`,
    ...dims.map(d => `| ${d.name} | ${fmt1(d.score)} | ${cell(d.assessment, lang)} | ${cell(d.suggestion, lang)} |`),
    ``,
    L(`## 评分分布（有效评分 ${input.scoredTurns} 轮）`, `## Score distribution (${input.scoredTurns} scored turns)`),
    ``,
    L(`- 优秀 (≥8)：${dist.excellent} 轮`, `- Excellent (≥8): ${dist.excellent} turns`),
    L(`- 良好 [6,8)：${dist.good} 轮`, `- Good [6,8): ${dist.good} turns`),
    L(`- 一般 [4,6)：${dist.fair} 轮`, `- Fair [4,6): ${dist.fair} turns`),
    L(`- 偏弱 (<4)：${dist.weak} 轮`, `- Weak (<4): ${dist.weak} turns`),
    ``,
    L(`## 亮点`, `## Strengths`),
    ``,
    strengths.length ? strengths.map(s => `- ${s}`).join('\n') : none,
    ``,
    L(`## 主要问题`, `## Main issues`),
    ``,
    weaknesses.length ? weaknesses.map(s => `- ${s}`).join('\n') : none,
    ``,
    L(`## 优先改进清单`, `## Prioritized actions`),
    ``,
    actions.length ? actions.map((s, i) => `${i + 1}. ${s}`).join('\n') : none,
    ``,
    L(`## 角色 Prompt 修订建议`, `## Character prompt revision suggestions`),
    ``,
    input.promptChanges?.trim() ? input.promptChanges.trim() : L('（无文字摘要）', '(no text summary)'),
    ``,
    ...(input.originalPrompt
      ? [L('**原始角色 Prompt：**', '**Original character prompt:**'), '', '```', input.originalPrompt, '```', '', L('**修订版：**', '**Revised version:**'), '', '```', input.revisedPrompt || L('（未生成）', '(not generated)'), '```', '']
      : []),
    L(`## 记忆系统问题`, `## Memory issues`),
    ``,
    input.memoryIssues?.trim() || L('无', 'None'),
    ``,
    L(`## 安全与边界`, `## Safety and boundaries`),
    ``,
    // TODO: 被测后端返回的 safetyMode 属于硬指标之一。
    // TargetMeta.safetyMode is stored in turn.rawMetaJson by session-runner, but
    // GenerateReportDeps.sessions only exposes turn.score fields — rawMetaJson is not
    // threaded through. To surface safetyMode trigger counts/rate here, either:
    //   (a) add rawMetaJson?: string to each turn entry in GenerateReportDeps (session-runner
    //       scope), or
    //   (b) accept a pre-aggregated safetyModeCount from the caller.
    // Until that data path is wired, this section relies solely on the LLM-synthesized
    // safetyIssues string and the programmatic violation flag (which is separate from safetyMode).
    input.safetyIssues?.trim() || L('无', 'None'),
    ``,
    L(`### 违规清单（${violations.length}）`, `### Violations (${violations.length})`),
    ``,
    ...(violations.length ? violations.map(t => turnBlock(t, lang)) : [L('（无违规）', '(no violations)'), '']),
    L(`## 低分回放（Top ${input.worstTurns.length}）`, `## Lowest-scored turns (Top ${input.worstTurns.length})`),
    ``,
    ...input.worstTurns.map(t => turnBlock(t, lang)),
    L(`## 高分样例（Top ${input.bestTurns.length}）`, `## Highest-scored turns (Top ${input.bestTurns.length})`),
    ``,
    ...input.bestTurns.map(t => turnBlock(t, lang)),
  ].filter(s => s !== undefined)
  return lines.join('\n')
}

export interface GenerateReportDeps {
  lang?: Lang
  runId: string
  sessions: Array<{
    id: string
    personaName?: string
    repetitionIndex?: number
    createdAt?: Date | string
    turns: Array<{
      idx: number
      userText: string
      targetText: string
      score?: {
        overall: number
        comment: string
        improvementSuggestion: string
        dimsJson: string
        violation: boolean
        memoryHit?: boolean | null
        judgeError?: string | null
      } | null
    }>
  }>
  totalSessions: number
  avgOverall: number | null
  violations: number
  memoryHitRate: number | null
  memoryMisses?: number
  originalPrompt?: string | null
  synthesizeSuggestions?: (input: SynthesisInput) => Promise<SynthesisResult>
}

const toSample = (t: TurnForReport, lang: Lang): SynthesisSample => ({
  idx: t.idx, sessionLabel: turnLabel(t, lang), userText: t.userText, targetText: t.targetText,
  overall: t.overall, dims: t.dims, comment: t.comment, suggestion: t.improvementSuggestion, violation: t.violation,
})

const MAX_SUGGESTIONS = 30
const MAX_SUGGESTION_LEN = 200

export async function generateReport(deps: GenerateReportDeps): Promise<{ markdown: string; json: string }> {
  const lang: Lang = deps.lang ?? 'zh'
  const dimNames = dimNamesFor(lang)
  const allTurns: TurnForReport[] = []
  // 会话按创建时间排序，轮按 idx 排序，保证拼接序列稳定可读。
  const sessions = [...deps.sessions].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
  for (const s of sessions) {
    for (const t of [...s.turns].sort((a, b) => a.idx - b.idx)) {
      if (!t.score) continue
      let dims: Record<string, number> = {}
      try {
        dims = JSON.parse(t.score.dimsJson) as Record<string, number>
      } catch { /* skip malformed dims */ }
      allTurns.push({
        idx: t.idx,
        sessionId: s.id,
        personaName: s.personaName,
        repetitionIndex: s.repetitionIndex,
        userText: t.userText,
        targetText: t.targetText,
        overall: t.score.overall,
        comment: t.score.comment,
        improvementSuggestion: t.score.improvementSuggestion,
        dims,
        violation: t.score.violation,
        judgeError: t.score.judgeError ?? null,
      })
    }
  }

  const scoredTurns = allTurns.filter(t => !t.judgeError).length
  const judgeFailedCount = allTurns.filter(t => t.judgeError).length
  const memoryMisses = deps.memoryMisses ?? 0

  const dimMeans = dimMeansOf(allTurns)
  const distribution = distributionOf(allTurns)
  const worst = stratifiedWorst(allTurns, 2, 5)
  const best = bestTurns(allTurns, 3)
  const violationTurns = allTurns.filter(t => t.violation && !t.judgeError)
  const clusters = clusterSuggestions(allTurns)
  const rawSuggestions = clusters.slice(0, MAX_SUGGESTIONS).map(c => c.suggestion.slice(0, MAX_SUGGESTION_LEN))

  const synthInput: SynthesisInput = {
    lang,
    stats: { totalTurns: allTurns.length, scoredTurns, avgOverall: deps.avgOverall, violations: deps.violations, memoryHitRate: deps.memoryHitRate, memoryMisses, dimMeans },
    dimNames,
    distribution,
    worstSamples: worst.map(t => toSample(t, lang)),
    bestSamples: best.map(t => toSample(t, lang)),
    violationSamples: violationTurns.slice(0, 8).map(t => toSample(t, lang)),
    suggestions: rawSuggestions,
    originalPrompt: deps.originalPrompt ?? null,
  }

  let synthesis: SynthesisResult
  if (deps.synthesizeSuggestions) {
    try {
      synthesis = await deps.synthesizeSuggestions(synthInput)
    } catch (err) {
      // 捕获失败原因写进兜底文案，便于直接在报告里看到"为什么没用上 LLM"。
      synthesis = buildFallbackSynthesis(synthInput, violationTurns, err instanceof Error ? err.message : String(err))
    }
  } else {
    synthesis = buildFallbackSynthesis(synthInput, violationTurns, null)
  }

  // 合并：维度评价来自 LLM，均分来自实际统计（权威）。
  const llmDims = new Map((synthesis.dimensions ?? []).map(d => [d.key, d]))
  const dimensions: ReportDimension[] = DIM_KEYS.map(key => {
    const d = llmDims.get(key)
    return { key, name: dimNames[key]!, score: dimMeans[key] ?? null, assessment: d?.assessment ?? '', suggestion: d?.suggestion ?? '' }
  })

  const reportInput: ReportInput = {
    ...(lang === 'en' ? { lang } : {}),
    runId: deps.runId,
    totalSessions: deps.totalSessions,
    totalTurns: allTurns.length,
    scoredTurns,
    judgeFailedCount,
    avgOverall: deps.avgOverall,
    violations: deps.violations,
    memoryHitRate: deps.memoryHitRate,
    memoryMisses,
    overallAssessment: synthesis.overallAssessment ?? '',
    dimensions,
    distribution,
    strengths: synthesis.strengths ?? [],
    weaknesses: synthesis.weaknesses ?? [],
    promptChanges: synthesis.promptChanges ?? '',
    originalPrompt: deps.originalPrompt ?? null,
    revisedPrompt: synthesis.revisedPrompt ?? '',
    memoryIssues: synthesis.memoryIssues ?? '',
    safetyIssues: synthesis.safetyIssues ?? '',
    prioritizedActions: synthesis.prioritizedActions ?? [],
    worstTurns: worst,
    bestTurns: best,
    violationTurns,
  }

  // 逐轮综合分序列（按出现顺序，排除裁判失败轮）——供前端画趋势折线图。
  const scoreSeries = allTurns.filter(t => !t.judgeError).map(t => t.overall)

  const markdown = buildReportMarkdown(reportInput)
  const reportJson = JSON.stringify({ ...reportInput, dimMeans, scoreSeries })
  return { markdown, json: reportJson }
}

// 无 LLM（或调用失败）时的兜底：用统计数据拼出一份基本可用的多角度报告。
// reason: null=未配置/未提供 LLM；string=LLM 调用失败的原因（写进文案便于排查）。
function buildFallbackSynthesis(input: SynthesisInput, violationTurns: TurnForReport[], reason: string | null): SynthesisResult {
  const { dimMeans } = input.stats
  const rankable: Array<{ k: string; v: number }> = []
  for (const k of DIM_KEYS) {
    const v = dimMeans[k]
    if (typeof v === 'number' && Number.isFinite(v)) rankable.push({ k, v })
  }
  const sorted = [...rankable].sort((a, b) => b.v - a.v)
  const top = sorted.slice(0, 2)
  const bottom = [...sorted].reverse().slice(0, 2)

  const lang: Lang = input.lang ?? 'zh'
  const L = (zh: string, en: string) => pick(lang, { zh, en })
  const band = input.stats.avgOverall == null ? L('暂无有效评分', 'No valid scores yet')
    : input.stats.avgOverall >= 8 ? L('整体表现优秀', 'Overall performance is excellent')
    : input.stats.avgOverall >= 6 ? L('整体表现良好，仍有提升空间', 'Overall performance is good, with room for improvement')
    : input.stats.avgOverall >= 4 ? L('整体表现一般，问题较多', 'Overall performance is fair, with many issues')
    : L('整体表现偏弱，需重点优化', 'Overall performance is weak and needs focused optimization')

  // 安全问题确定性地列出所有违规轮（不依赖 LLM）。
  const safety = violationTurns.length > 0
    ? L(`共 ${violationTurns.length} 次违规：\n`, `${violationTurns.length} violation(s):\n`) + violationTurns.slice(0, 10).map(t => L(`- ${turnLabel(t, lang)}：用户「${t.userText}」→ 被测 AI「${t.targetText}」`, `- ${turnLabel(t, lang)}: user "${t.userText}" -> AI under test "${t.targetText}"`)).join('\n')
    : L('无', 'None')

  const why = reason
    ? L(`（LLM 综合分析调用失败：${reason.slice(0, 140)}；以下为基于统计的兜底结论，请重新生成或检查模型配置。）`,
        `(LLM synthesis failed: ${reason.slice(0, 140)}. The conclusions below are a statistical fallback; regenerate the report or check the model configuration.)`)
    : L(`（未配置 LLM 综合分析；以下为基于统计的兜底结论。）`, `(LLM synthesis is not configured; the conclusions below are a statistical fallback.)`)
  const avgText = input.stats.avgOverall != null ? input.stats.avgOverall.toFixed(2) : '—'
  return {
    overallAssessment: L(`${band}。平均综合分 ${avgText} / 10，违规 ${input.stats.violations} 次。${why}`, `${band}. Average overall score ${avgText} / 10, ${input.stats.violations} violation(s). ${why}`),
    dimensions: DIM_KEYS.map(k => ({
      key: k,
      assessment: typeof dimMeans[k] === 'number' ? L(`均分 ${(dimMeans[k] as number).toFixed(1)} / 10`, `Average ${(dimMeans[k] as number).toFixed(1)} / 10`) : L('无数据', 'No data'),
      suggestion: '',
    })),
    strengths: top.map(x => L(`${input.dimNames[x.k]} 表现较好（均分 ${x.v.toFixed(1)}）`, `${input.dimNames[x.k]} performs well (avg ${x.v.toFixed(1)})`)),
    weaknesses: [
      ...bottom.map(x => L(`${input.dimNames[x.k]} 偏弱（均分 ${x.v.toFixed(1)}）`, `${input.dimNames[x.k]} is weak (avg ${x.v.toFixed(1)})`)),
      ...(violationTurns.length > 0 ? [L(`存在 ${violationTurns.length} 次安全/边界违规，详见安全与边界`, `${violationTurns.length} safety/boundary violation(s); see Safety and boundaries`)] : []),
    ],
    promptChanges: input.suggestions.slice(0, 5).join(L('；', '; ')) || L('（无建议）', '(no suggestions)'),
    revisedPrompt: '',
    memoryIssues: input.stats.memoryMisses > 0 ? L(`记忆未命中 ${input.stats.memoryMisses} 次`, `${input.stats.memoryMisses} memory miss(es)`) : L('无', 'None'),
    safetyIssues: safety,
    prioritizedActions: input.suggestions.slice(0, 5),
  }
}
