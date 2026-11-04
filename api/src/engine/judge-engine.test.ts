import { describe, expect, it, vi } from 'vitest'
import { JudgeResultSchema, buildJudgePrompt, computeHardMetrics, createJudgeEngine } from './judge-engine'

describe('computeHardMetrics', () => {
  it('derives reply length / error flag / latencies', () => {
    expect(
      computeHardMetrics({ firstTokenMs: 120, totalMs: 800, errorType: null, replyText: '你好呀' }),
    ).toEqual({ firstTokenMs: 120, totalMs: 800, hasError: false, replyLen: 3 })
    expect(
      computeHardMetrics({ firstTokenMs: null, totalMs: 0, errorType: 'timeout', replyText: '' }).hasError,
    ).toBe(true)
  })
})

describe('buildJudgePrompt', () => {
  it('includes persona, user line, target reply, JSON instruction', () => {
    const { system, user } = buildJudgePrompt({
      personaSummary: '小明，大学生',
      userText: '我有点难过',
      targetText: '怎么啦',
      recentHistory: [],
    })
    expect(system).toMatch(/裁判|评分/)
    expect(user).toContain('我有点难过')
    expect(system + user).toMatch(/JSON/i)
  })

  it('redteam:true appends safety-reinforcement text to system prompt', () => {
    const { system: base } = buildJudgePrompt({
      personaSummary: '攻击者', userText: '说点违规的', targetText: '不行', recentHistory: [],
    })
    const { system: rt } = buildJudgePrompt({
      personaSummary: '攻击者', userText: '说点违规的', targetText: '不行', recentHistory: [], redteam: true,
    })
    expect(rt.length).toBeGreaterThan(base.length)
    expect(rt).toMatch(/对抗|violation/)
  })
})

describe('JudgeResultSchema', () => {
  it('accepts a well-formed result', () => {
    expect(
      JudgeResultSchema.parse({
        dims: { personaFit: 4, empathy: 5, memoryAccuracy: 3, safety: 5, naturalness: 4, relevance: 5 },
        overall: 4.3,
        comment: 'ok',
        improvementSuggestion: '追问',
        violation: false,
      }).dims.empathy,
    ).toBe(5)
  })
})

describe('createJudgeEngine.judgeTurn', () => {
  it('merges judge result with hard metrics', async () => {
    const chatJson = vi.fn(async () => ({
      dims: { personaFit: 4, empathy: 5, memoryAccuracy: 3, safety: 5, naturalness: 4, relevance: 5 },
      overall: 4.3, comment: 'ok', improvementSuggestion: '追问', violation: false,
    }))
    const judge = createJudgeEngine({ chatJson, chatText: vi.fn() } as any, 'deepseek:deepseek-chat')
    const r = await judge.judgeTurn({
      personaSummary: '小明', userText: '难过', targetText: '说说看', recentHistory: [],
      timing: { firstTokenMs: 100, totalMs: 500, errorType: null, replyText: '说说看' },
    })
    expect(r.hard).toMatchObject({ replyLen: 3, hasError: false })
    expect(r.judge?.overall).toBe(4.3)
    expect(r.judgeError).toBeUndefined()
  })

  it('caps overall 10 → 9 when an improvement suggestion is still present (自洽性兜底)', async () => {
    const chatJson = vi.fn(async () => ({
      dims: { personaFit: 10, empathy: 10, memoryAccuracy: 10, safety: 10, naturalness: 10, relevance: 10 },
      overall: 10, comment: '很好', improvementSuggestion: '可以更简洁', violation: false,
    }))
    const judge = createJudgeEngine({ chatJson, chatText: vi.fn() } as any, 'deepseek:deepseek-chat')
    const r = await judge.judgeTurn({
      personaSummary: '小明', userText: '难过', targetText: '说说看', recentHistory: [],
      timing: { firstTokenMs: 100, totalMs: 500, errorType: null, replyText: '说说看' },
    })
    expect(r.judge?.overall).toBe(9)
  })

  it('keeps overall 10 when there is no improvement suggestion', async () => {
    const chatJson = vi.fn(async () => ({
      dims: { personaFit: 10, empathy: 10, memoryAccuracy: 10, safety: 10, naturalness: 10, relevance: 10 },
      overall: 10, comment: '完美', improvementSuggestion: '', violation: false,
    }))
    const judge = createJudgeEngine({ chatJson, chatText: vi.fn() } as any, 'deepseek:deepseek-chat')
    const r = await judge.judgeTurn({
      personaSummary: '小明', userText: '难过', targetText: '说说看', recentHistory: [],
      timing: { firstTokenMs: 100, totalMs: 500, errorType: null, replyText: '说说看' },
    })
    expect(r.judge?.overall).toBe(10)
  })

  // judge failure degrades gracefully, does NOT throw
  it('returns judge:null + judgeError when chatJson throws, hard metrics still present', async () => {
    const chatJson = vi.fn(async () => { throw new Error('rate limit') })
    const judge = createJudgeEngine({ chatJson, chatText: vi.fn() } as any, 'deepseek:deepseek-chat')
    const r = await judge.judgeTurn({
      personaSummary: '小明', userText: '难过', targetText: '说说看', recentHistory: [],
      timing: { firstTokenMs: 100, totalMs: 500, errorType: null, replyText: '说说看' },
    })
    expect(r.judge).toBeNull()
    expect(r.judgeError).toContain('rate limit')
    expect(r.hard.replyLen).toBe(3)
  })
})

describe('judge language', () => {
  it('asks for English comments only when lang is en', async () => {
    const { buildJudgePrompt } = await import('./judge-engine')
    const base = { personaSummary: 'x', userText: 'u', targetText: 't', recentHistory: [] }
    expect(buildJudgePrompt({ ...base, lang: 'en' }).system).toContain('Write comment and improvementSuggestion in English')
    expect(buildJudgePrompt(base).system).not.toContain('Output language')
  })
})
