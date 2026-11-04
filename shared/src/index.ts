// Shared types for chat-arena — consumed by both api and frontend.
// No runtime dependencies; type-only exports only.

// ── Persona & dialogue types ──────────────────────────────────────────────────
export type { Persona, PersonaStructured, InjectedFact, RecallProbe, Dialogue, TargetMeta, TargetChatResult } from '../../api/src/types'

// ── Score dimensions ──────────────────────────────────────────────────────────
// Mirrors JudgeResult['dims'] from judge-engine without importing it.
export interface ScoreDims {
  personaFit: number
  empathy: number
  memoryAccuracy: number
  safety: number
  naturalness: number
  relevance: number
}

// ── Live events (WebSocket stream) ───────────────────────────────────────────
// Inlined here so the frontend doesn't transitively depend on api internals.
export type LiveEvent =
  | { type: 'session.started'; runId: string; sessionId: string; personaId: string }
  | { type: 'turn.user'; runId: string; sessionId: string; idx: number; text: string }
  | { type: 'turn.target.delta'; runId: string; sessionId: string; idx: number; deltaText: string }
  | { type: 'turn.target.reset'; runId: string; sessionId: string; idx: number }
  | { type: 'turn.target.done'; runId: string; sessionId: string; idx: number; fullText: string; firstTokenMs: number | null; totalMs: number }
  | { type: 'turn.score'; runId: string; sessionId: string; idx: number; dims: ScoreDims | null; overall: number | null; comment: string | null; suggestion: string | null; memoryHit: boolean | null; violation: boolean; judgeError?: string }
  | { type: 'session.ended'; runId: string; sessionId: string; endReason: string; turnCount: number; avgScore: number | null }

// ── Run configuration ─────────────────────────────────────────────────────────
export interface RunConfig {
  name?: string
  targetBaseUrl: string
  targetLabel?: string
  personaIds: string[]
  taGender: 1 | 2
  userModel: string
  judgeModel: string
  endCondition: { maxTurns?: number; maxDurationSec?: number }
  concurrency: number
  repetitions: number
  replayFromRunId?: string
}
