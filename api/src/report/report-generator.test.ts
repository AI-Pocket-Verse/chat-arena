import { describe, expect, it } from 'vitest'
import { bestTurns, buildReportMarkdown, clusterSuggestions, dimMeansOf, distributionOf, dimNamesFor, generateReport, stratifiedWorst, turnLabel, worstTurns } from './report-generator'
import type { ReportInput, SynthesisResult, TurnForReport } from './report-generator'

const T = (over: Partial<TurnForReport>): TurnForReport => ({
  idx: 0, sessionId: 's0', userText: 'u', targetText: 'n', overall: 5, comment: 'c',
  improvementSuggestion: '', dims: {}, violation: false, ...over,
})

const sampleTurns: TurnForReport[] = [
  T({ idx: 0, sessionId: 's0', userText: '你好', targetText: '嗨', overall: 2.1, comment: '偏冷', improvementSuggestion: '增加温度', dims: { personaFit: 2, empathy: 2, memoryAccuracy: 3, safety: 5, naturalness: 2, relevance: 3 } }),
  T({ idx: 1, sessionId: 's0', userText: '在吗', targetText: '在', overall: 3.5, comment: '一般', improvementSuggestion: '追问细节', dims: { personaFit: 4, empathy: 4, memoryAccuracy: 3, safety: 5, naturalness: 3, relevance: 3 } }),
  T({ idx: 2, sessionId: 's0', userText: '想家了', targetText: '我理解', overall: 4.8, comment: '很好', improvementSuggestion: '保持', dims: { personaFit: 5, empathy: 5, memoryAccuracy: 4, safety: 5, naturalness: 5, relevance: 5 } }),
]

const judgeFailedTurn = T({ idx: 3, sessionId: 's0', userText: '？', targetText: '', overall: 0, dims: {}, judgeError: 'rate limit' })

describe('worstTurns / bestTurns', () => {
  it('worst returns top-N ascending, excluding judge-failed', () => {
    const worst = worstTurns([...sampleTurns, judgeFailedTurn], 2)
    expect(worst[0]?.overall).toBe(2.1)
    expect(worst).toHaveLength(2)
    expect(worst.find(t => t.idx === 3)).toBeUndefined()
  })
  it('best returns top-N descending', () => {
    expect(bestTurns(sampleTurns, 2)[0]?.overall).toBe(4.8)
  })
})

describe('stratifiedWorst', () => {
  it('takes worst per persona so one persona cannot monopolize all slots', () => {
    const turns: TurnForReport[] = [
      T({ idx: 0, sessionId: 'a', personaName: '对抗', overall: 1 }),
      T({ idx: 1, sessionId: 'a', personaName: '对抗', overall: 1.2 }),
      T({ idx: 2, sessionId: 'a', personaName: '对抗', overall: 1.5 }),
      T({ idx: 0, sessionId: 'b', personaName: '普通', overall: 3 }),
    ]
    const picked = stratifiedWorst(turns, 2, 3)
    // 普通人设那条（3 分）应被纳入，而不是被对抗的三条挤掉
    expect(picked.some(t => t.personaName === '普通')).toBe(true)
  })
})

describe('turnLabel', () => {
  it('builds a cross-session-safe label with persona + repetition', () => {
    expect(turnLabel(T({ idx: 4, personaName: '小明', repetitionIndex: 1 }))).toBe('小明 · 重复#2 · 第 5 轮')
  })
})

describe('dimMeansOf / distributionOf', () => {
  it('computes per-dimension means', () => {
    expect(dimMeansOf(sampleTurns).personaFit).toBeCloseTo((2 + 4 + 5) / 3, 5)
  })
  it('buckets overall into distribution (4.8 ∈ fair)', () => {
    const d = distributionOf(sampleTurns)
    expect(d.fair).toBe(1)
    expect(d.weak).toBe(2)
  })
  it('skips sentinel overall < 1', () => {
    expect(distributionOf([T({ overall: 0 })]).weak).toBe(0)
  })
})

describe('clusterSuggestions', () => {
  it('groups suggestions, excludes judge-failed', () => {
    const clusters = clusterSuggestions([...sampleTurns, judgeFailedTurn])
    expect(clusters.length).toBeGreaterThan(0)
  })
})

const sampleReportInput: ReportInput = {
  runId: 'run-123',
  totalSessions: 2,
  totalTurns: 3,
  scoredTurns: 3,
  judgeFailedCount: 0,
  avgOverall: 3.5,
  violations: 0,
  memoryHitRate: null,
  memoryMisses: 0,
  overallAssessment: '整体表现一般，仍有提升空间',
  dimensions: [{ key: 'personaFit', name: '人设贴合', score: 3.7, assessment: '基本贴合', suggestion: '保持语气' }],
  distribution: { excellent: 0, good: 0, fair: 1, weak: 2 },
  strengths: ['情感共情尚可'],
  weaknesses: ['自然流畅偏弱'],
  promptChanges: '增加温度，追问细节',
  originalPrompt: null,
  revisedPrompt: '',
  memoryIssues: '无',
  safetyIssues: '无',
  prioritizedActions: ['提升自然度'],
  worstTurns: worstTurns(sampleTurns, 2),
  bestTurns: bestTurns(sampleTurns, 1),
  violationTurns: [],
}

describe('buildReportMarkdown', () => {
  it('produces a multi-angle markdown with all sections', () => {
    const md = buildReportMarkdown(sampleReportInput)
    expect(md).toContain('run-123')
    expect(md).toContain('总体评价')
    expect(md).toContain('各维度评估')
    expect(md).toContain('评分分布')
    expect(md).toContain('亮点')
    expect(md).toContain('主要问题')
    expect(md).toContain('Prompt 修订建议')
    expect(md).toContain('安全与边界')
    expect(md).toContain('优先改进清单')
    expect(md).toContain('低分回放')
    expect(md).toContain('增加温度')
  })
  it('renders original/revised prompt block when originalPrompt present', () => {
    const md = buildReportMarkdown({ ...sampleReportInput, originalPrompt: '你是温柔的小美', revisedPrompt: '你是温柔的小美，遇越界请拒绝' })
    expect(md).toContain('原始角色 Prompt')
    expect(md).toContain('遇越界请拒绝')
  })
  it('lists violation turns', () => {
    const v = T({ idx: 1, sessionId: 's0', personaName: '小红', userText: '亲一个', targetText: '好呀', overall: 2, violation: true })
    const md = buildReportMarkdown({ ...sampleReportInput, violationTurns: [v] })
    expect(md).toContain('违规清单（1）')
    expect(md).toContain('亲一个')
  })
  it('shows judge-failed count and memory miss', () => {
    const md = buildReportMarkdown({ ...sampleReportInput, judgeFailedCount: 2, memoryHitRate: 0.75, memoryMisses: 3 })
    expect(md).toContain('裁判失败')
    expect(md).toContain('3 次')
  })
})

function makeSessions(extra: { violation?: boolean } = {}) {
  return [
    {
      id: 's1', personaName: '小明', repetitionIndex: 0,
      turns: [
        { idx: 0, userText: 'hi', targetText: 'hello', score: { overall: 3.0, comment: 'ok', improvementSuggestion: '改进A', dimsJson: '{"personaFit":3}', violation: false, memoryHit: true, judgeError: null } },
        { idx: 1, userText: '亲一个', targetText: 'see ya', score: { overall: 1.5, comment: 'bad', improvementSuggestion: '改进B', dimsJson: '{"personaFit":2}', violation: extra.violation ?? false, memoryHit: false, judgeError: null } },
        { idx: 2, userText: 'err', targetText: '', score: { overall: 0, comment: '', improvementSuggestion: '', dimsJson: '{}', violation: false, memoryHit: null, judgeError: 'rate limit' } },
      ],
    },
  ]
}

const fullSynth: SynthesisResult = {
  overallAssessment: '总体OK',
  dimensions: [{ key: 'personaFit', assessment: '贴合度尚可', suggestion: '保持' }],
  strengths: ['共情到位'],
  weaknesses: ['自然度不足'],
  promptChanges: 'P-change',
  revisedPrompt: '修订后的 prompt',
  memoryIssues: 'M-issue',
  safetyIssues: 'S-issue',
  prioritizedActions: ['先修自然度'],
}

describe('generateReport', () => {
  it('with injected synthesize returns multi-angle synthesis', async () => {
    const { markdown } = await generateReport({
      runId: 'r1', sessions: makeSessions(), totalSessions: 1, avgOverall: 2.0, violations: 0, memoryHitRate: 0.5, memoryMisses: 1,
      synthesizeSuggestions: async () => fullSynth,
    })
    expect(markdown).toContain('总体OK')
    expect(markdown).toContain('P-change')
    expect(markdown).toContain('安全与边界')
    expect(markdown).toContain('小明') // cross-session label uses persona name
  })

  it('passes rich context (stats/distribution/samples/violationSamples/originalPrompt) to synthesize', async () => {
    let received: unknown
    await generateReport({
      runId: 'r1b', sessions: makeSessions({ violation: true }), totalSessions: 1, avgOverall: 2.0, violations: 1, memoryHitRate: 0.5, memoryMisses: 1,
      originalPrompt: '原始 prompt',
      synthesizeSuggestions: async (input) => { received = input; return fullSynth },
    })
    const inp = received as { stats: { dimMeans: unknown; scoredTurns: number }; violationSamples: unknown[]; originalPrompt: string | null }
    expect(inp.stats.dimMeans).toBeDefined()
    expect(inp.stats.scoredTurns).toBe(2)
    expect(inp.violationSamples.length).toBe(1)
    expect(inp.originalPrompt).toBe('原始 prompt')
  })

  it('fallback (no LLM) lists violations deterministically in safety section', async () => {
    const { markdown, json } = await generateReport({
      runId: 'r2', sessions: makeSessions({ violation: true }), totalSessions: 1, avgOverall: 2.0, violations: 1, memoryHitRate: null, memoryMisses: 3,
    })
    expect(markdown).toContain('总体评价')
    expect(markdown).toContain('记忆未命中 3 次')
    expect(markdown).toContain('亲一个') // violation turn surfaced without LLM
    const parsed = JSON.parse(json) as { violationTurns: Array<{ idx: number }>; scoredTurns: number }
    expect(parsed.violationTurns.length).toBe(1)
    expect(parsed.scoredTurns).toBe(2)
  })

  it('malformed dimsJson does not throw', async () => {
    const sessions = [{ id: 's1', turns: [{ idx: 0, userText: 'hi', targetText: 'hello', score: { overall: 3.0, comment: 'ok', improvementSuggestion: '改进', dimsJson: 'NOT_JSON', violation: false, memoryHit: null, judgeError: null } }] }]
    await expect(generateReport({ runId: 'r3', sessions, totalSessions: 1, avgOverall: 3.0, violations: 0, memoryHitRate: null })).resolves.toBeDefined()
  })

  it('judge-failed turns excluded from worst list', async () => {
    const { json } = await generateReport({ runId: 'r4', sessions: makeSessions(), totalSessions: 1, avgOverall: 2.0, violations: 0, memoryHitRate: null })
    const parsed = JSON.parse(json) as { worstTurns: Array<{ idx: number }> }
    expect(parsed.worstTurns.find(t => t.idx === 2)).toBeUndefined()
  })

  it('synthesize failure falls back to non-LLM path', async () => {
    const { markdown } = await generateReport({
      runId: 'r5', sessions: makeSessions(), totalSessions: 1, avgOverall: 2.0, violations: 1, memoryHitRate: null, memoryMisses: 2,
      synthesizeSuggestions: async (): Promise<never> => { throw new Error('LLM unavailable') },
    })
    expect(markdown).toContain('总体评价')
    expect(markdown).toContain('安全与边界')
  })
})

describe('english output', () => {
  const CJK = /[　-〿㐀-鿿＀-￯]/
  const enSessions = () => [{
    id: 's1', personaName: 'Mia', repetitionIndex: 1,
    turns: [
      { idx: 0, userText: 'hi', targetText: 'hello', score: { overall: 3.0, comment: 'ok', improvementSuggestion: 'Add warmth', dimsJson: '{"personaFit":3}', violation: true, memoryHit: true, judgeError: null } },
      { idx: 2, userText: 'yo', targetText: 'sup', score: { overall: 9.0, comment: 'nice', improvementSuggestion: 'Keep', dimsJson: '{"empathy":9}', violation: false, memoryHit: false, judgeError: null } },
    ],
  }]

  it('turnLabel in English', () => {
    expect(turnLabel(T({ idx: 2, personaName: 'Mia', repetitionIndex: 1 }), 'en')).toBe('Mia · Repetition #2 · Turn 3')
    expect(turnLabel(T({ idx: 0 }), 'en')).toBe('Session · Turn 1')
    expect(turnLabel(T({ idx: 2, personaName: '小明', repetitionIndex: 1 }))).toBe('小明 · 重复#2 · 第 3 轮')
  })

  it('dimNamesFor returns per-language names', () => {
    expect(dimNamesFor('en').personaFit).toBe('Persona fit')
    expect(dimNamesFor().personaFit).toBe('人设贴合')
  })

  it('fallback markdown is fully English (including violations and memory)', async () => {
    const { markdown, json } = await generateReport({
      lang: 'en', runId: 'r1', sessions: enSessions(), totalSessions: 1, avgOverall: 6.0, violations: 1, memoryHitRate: 0.5, memoryMisses: 1,
    })
    expect(markdown).toContain('# Evaluation report')
    expect(markdown).toContain('## Overall assessment')
    expect(markdown).toContain('## Score distribution (2 scored turns)')
    expect(markdown).toContain('- Excellent (≥8): 1 turns')
    expect(markdown).toContain('Mia · Repetition #2 · Turn 3')
    expect(markdown).toContain('statistical fallback')
    expect(markdown).toContain('**⚠️ Violation**')
    expect(markdown).not.toMatch(CJK)
    expect(JSON.parse(json).lang).toBe('en')
  })

  it('LLM failure note and suggestion skipping in English', async () => {
    const { markdown } = await generateReport({
      lang: 'en', runId: 'r2', sessions: enSessions(), totalSessions: 1, avgOverall: 2.0, violations: 0, memoryHitRate: null,
      synthesizeSuggestions: async () => { throw new Error('boom') },
    })
    expect(markdown).toContain('LLM synthesis failed: boom')
    expect(markdown).toContain('Add warmth')
    expect(clusterSuggestions([T({ improvementSuggestion: 'Keep' }), T({ improvementSuggestion: 'keep as is' })])).toEqual([])
  })

  it('buildReportMarkdown English keeps only user-provided CJK', () => {
    const md = buildReportMarkdown({ ...sampleReportInput, lang: 'en', overallAssessment: '', dimensions: [{ key: 'personaFit', name: 'Persona fit', score: 3.7, assessment: 'a|b', suggestion: '' }],
      strengths: [], weaknesses: [], promptChanges: '', memoryIssues: '', safetyIssues: '', prioritizedActions: [],
      worstTurns: [T({ idx: 1, personaName: '小明', userText: '你好', targetText: '嗨', comment: '偏冷', improvementSuggestion: '增加温度', dims: { empathy: 2 } })], bestTurns: [] })
    expect(md).toContain('## Prioritized actions')
    expect(md).toContain('(none)')
    expect(md).toContain('(no violations)')
    expect(md).toContain('**User:** 你好')
    expect(md).toContain('a\\|b')
    const stripped = md.replace(/小明|你好|嗨|偏冷|增加温度/g, '')
    expect(stripped).not.toMatch(CJK)
  })
})
