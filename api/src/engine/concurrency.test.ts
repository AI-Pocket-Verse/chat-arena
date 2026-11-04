import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from './concurrency'

describe('mapWithConcurrency', () => {
  it('processes all items and never exceeds the concurrency cap', async () => {
    let active = 0
    let peak = 0
    const items = Array.from({ length: 10 }, (_, i) => i)
    const out = await mapWithConcurrency(items, 3, async n => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 5))
      active--
      return n * 2
    })
    expect(out).toEqual(items.map(n => n * 2))
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('preserves order of results regardless of completion order', async () => {
    const items = [30, 10, 20]
    const out = await mapWithConcurrency(items, 3, async ms => {
      await new Promise(r => setTimeout(r, ms))
      return ms
    })
    expect(out).toEqual([30, 10, 20]) // result order = input order
  })

  it('handles empty input', async () => {
    expect(await mapWithConcurrency([], 4, async x => x)).toEqual([])
  })
})
