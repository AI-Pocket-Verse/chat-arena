export interface EndCondition {
  maxTurns?: number
  maxDurationSec?: number
}

/** 未设置轮数上限时的兜底：每轮都要调用模型，防止会话无限进行下去持续产生费用 */
export const HARD_MAX_TURNS = 200

export type EndReason = 'max_turns' | 'max_duration' | 'manual_stop' | 'target_fatal_error' | 'session_error'

export function shouldEnd(args: {
  turnCount: number
  elapsedSec: number
  manualStop: boolean
  fatal: boolean
  cond: EndCondition
}): EndReason | null {
  if (args.fatal) return 'target_fatal_error'
  if (args.manualStop) return 'manual_stop'
  if (args.turnCount >= (args.cond.maxTurns ?? HARD_MAX_TURNS)) return 'max_turns'
  if (args.cond.maxDurationSec != null && args.elapsedSec >= args.cond.maxDurationSec) return 'max_duration'
  return null
}
