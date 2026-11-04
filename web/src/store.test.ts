import { beforeEach, describe, expect, it } from 'vitest'
import { useLive } from './store'

describe('useLive.apply', () => {
  beforeEach(() => useLive.getState().reset('run1'))

  it('turn.target.reset 清掉上一次尝试的半截文本，重试的全文不会接在后面', () => {
    const { apply } = useLive.getState()
    apply({ type: 'turn.target.delta', runId: 'run1', sessionId: 's1', idx: 0, deltaText: '半截' })
    apply({ type: 'turn.target.reset', runId: 'run1', sessionId: 's1', idx: 0 })
    apply({ type: 'turn.target.delta', runId: 'run1', sessionId: 's1', idx: 0, deltaText: '完整' })
    expect(useLive.getState().turns[0]!.streaming).toBe('完整')
  })
})
