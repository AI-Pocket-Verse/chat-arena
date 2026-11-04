import { describe, expect, it } from 'vitest'
import { HARD_MAX_TURNS, shouldEnd } from './end-condition'

describe('shouldEnd', () => {
  const cond = { maxTurns: 3, maxDurationSec: 60 }

  it('stops at max turns', () => {
    expect(shouldEnd({ turnCount: 3, elapsedSec: 10, manualStop: false, fatal: false, cond })).toBe('max_turns')
  })
  it('stops at max duration', () => {
    expect(shouldEnd({ turnCount: 1, elapsedSec: 61, manualStop: false, fatal: false, cond })).toBe('max_duration')
  })
  it('manual stop and fatal take priority', () => {
    expect(shouldEnd({ turnCount: 0, elapsedSec: 0, manualStop: true, fatal: false, cond })).toBe('manual_stop')
    expect(shouldEnd({ turnCount: 0, elapsedSec: 0, manualStop: false, fatal: true, cond })).toBe('target_fatal_error')
  })
  it('continues when below thresholds', () => {
    expect(shouldEnd({ turnCount: 1, elapsedSec: 10, manualStop: false, fatal: false, cond })).toBeNull()
  })

  // both limits undefined = no limit — only manual/fatal can stop
  it('without maxTurns / maxDurationSec only the HARD_MAX_TURNS cap applies', () => {
    const unlimited = {}
    expect(shouldEnd({ turnCount: HARD_MAX_TURNS - 1, elapsedSec: 99999, manualStop: false, fatal: false, cond: unlimited })).toBeNull()
    expect(shouldEnd({ turnCount: 0, elapsedSec: 0, manualStop: true, fatal: false, cond: unlimited })).toBe('manual_stop')
    expect(shouldEnd({ turnCount: 0, elapsedSec: 0, manualStop: false, fatal: true, cond: unlimited })).toBe('target_fatal_error')
  })

  it('caps sessions without maxTurns at HARD_MAX_TURNS', () => {
    expect(shouldEnd({ turnCount: HARD_MAX_TURNS - 1, elapsedSec: 0, manualStop: false, fatal: false, cond: {} })).toBeNull()
    expect(shouldEnd({ turnCount: HARD_MAX_TURNS, elapsedSec: 0, manualStop: false, fatal: false, cond: {} })).toBe('max_turns')
  })
})
