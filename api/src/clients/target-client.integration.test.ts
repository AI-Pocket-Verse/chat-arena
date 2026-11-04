import { describe, expect, it } from 'vitest'
import { createTargetClient } from './target-client'

const run = process.env.TARGET_IT === '1'
describe.runIf(run)('target-client (integration, real target)', () => {
  it('gets a debug token and a non-empty reply', async () => {
    const client = createTargetClient({
      baseUrl: process.env.TARGET_BASE_URL ?? 'http://localhost:8680',
      debugKey: process.env.TARGET_DEBUG_KEY ?? '',
    })
    const { token } = await client.generateDebugToken({ taGender: 2 })
    const r = await client.chat(token, '你好呀', `it-${Date.now()}`)
    expect(r.done).toBe(true)
    expect(r.text.length).toBeGreaterThan(0)
  }, 30_000)
})
