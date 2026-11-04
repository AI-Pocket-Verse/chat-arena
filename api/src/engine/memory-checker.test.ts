import { describe, expect, it, vi } from 'vitest'
import { checkRecall } from './memory-checker'

describe('checkRecall', () => {
  it('rule hit: reply contains the fact value (normalized)', async () => {
    const r = await checkRecall({ factValue: '苏州', reply: '记得呀，你老家苏州的' })
    expect(r.recalled).toBe(true)
    expect(r.evidence).toBeTruthy()
  })
  it('rule miss falls back to judge when provided', async () => {
    const judge = vi.fn(async () => true)
    const r = await checkRecall({ factValue: '苏州', reply: '你来自江南水乡那座古城' }, judge)
    expect(judge).toHaveBeenCalled()
    expect(r.recalled).toBe(true)
  })
  it('miss with no judge → not recalled', async () => {
    const r = await checkRecall({ factValue: '苏州', reply: '不太记得了' })
    expect(r.recalled).toBe(false)
    expect(r.evidence).toBeNull()
  })
  it('isInjected: checks if userText contains fact value', async () => {
    const { isInjected } = await import('./memory-checker')
    expect(isInjected('苏州', '我老家在苏州，挺想家的')).toBe(true)
    expect(isInjected('苏州', '我来自一个南方小城')).toBe(false)
  })
})
