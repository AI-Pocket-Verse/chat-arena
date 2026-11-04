import { describe, expect, it } from 'vitest'
import { TargetChatAccumulator, classifyTargetEvent, splitSseEvents } from './target-sse'

describe('splitSseEvents', () => {
  it('extracts complete data: events and keeps the incomplete tail', () => {
    const raw =
      'data: {"data":{"status":"processing","stage":"accepted"}}\n\n' +
      'data: {"data":{"text":"你好"}}\n\n' +
      'data: {"data":{"text":"，世界"'
    const { events, rest } = splitSseEvents(raw)
    // events[0] = processing(accepted), events[1] = delta(你好)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ data: { text: '你好' } })
    expect(rest).toContain('，世界')
  })
  it('skips malformed json without throwing', () => {
    const { events } = splitSseEvents('data: not-json\n\ndata: {"data":{"text":"ok"}}\n\n')
    expect(events).toHaveLength(1)
  })
})

describe('classifyTargetEvent', () => {
  it('classifies processing / delta / done / error', () => {
    expect(classifyTargetEvent({ data: { status: 'processing', stage: 'preparing', text: '' } }).kind).toBe('processing')
    expect(classifyTargetEvent({ data: { text: '嗨', memory_used: true } })).toMatchObject({ kind: 'delta', text: '嗨', meta: { memoryUsed: true } })
    expect(classifyTargetEvent({ type: 'done', code: 200, data: null }).kind).toBe('done')
    expect(classifyTargetEvent({ type: 'done', code: 50102, data: { error_type: 'llm_error', message: '忙', retryable: true } })).toMatchObject({ kind: 'error', errorType: 'llm_error', retryable: true })
  })
})

describe('TargetChatAccumulator', () => {
  it('accumulates deltas, first-token latency, total time, meta', () => {
    let t = 1000
    const acc = new TargetChatAccumulator(1000, () => t)
    acc.push(classifyTargetEvent({ data: { status: 'processing', stage: 'accepted', text: '' } }))
    t = 1200
    acc.push(classifyTargetEvent({ data: { text: '你好', session_id: 's1', message_id: 9, memory_used: true } }))
    t = 1300
    acc.push(classifyTargetEvent({ data: { text: '呀' } }))
    t = 1500
    acc.push(classifyTargetEvent({ type: 'done', code: 200, data: null }))
    const r = acc.result()
    expect(r.text).toBe('你好呀')
    expect(r.firstTokenMs).toBe(200)
    expect(r.totalMs).toBe(500)
    expect(r.done).toBe(true)
    expect(r.error).toBeNull()
    expect(r.meta).toMatchObject({ sessionId: 's1', messageId: 9, memoryUsed: true })
  })
  it('captures a terminal error event', () => {
    const acc = new TargetChatAccumulator(0, () => 0)
    acc.push(classifyTargetEvent({ type: 'done', code: 50102, data: { error_type: 'timeout', message: '超时', retryable: true } }))
    expect(acc.result().error).toMatchObject({ errorType: 'timeout', retryable: true })
  })
})
