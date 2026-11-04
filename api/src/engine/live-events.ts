import type { JudgeResult } from './judge-engine'

export type LiveEvent =
  | { type: 'session.started'; runId: string; sessionId: string; personaId: string }
  | { type: 'turn.user'; runId: string; sessionId: string; idx: number; text: string }
  | { type: 'turn.target.delta'; runId: string; sessionId: string; idx: number; deltaText: string }
  | { type: 'turn.target.reset'; runId: string; sessionId: string; idx: number }
  | { type: 'turn.target.done'; runId: string; sessionId: string; idx: number; fullText: string; firstTokenMs: number | null; totalMs: number }
  | { type: 'turn.score'; runId: string; sessionId: string; idx: number; dims: JudgeResult['dims'] | null; overall: number | null; comment: string | null; suggestion: string | null; memoryHit: boolean | null; violation: boolean; judgeError?: string }
  | { type: 'session.ended'; runId: string; sessionId: string; endReason: string; turnCount: number; avgScore: number | null }
