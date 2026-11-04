import type { LiveEvent } from '@chat-arena/shared'
import { create } from 'zustand'

export interface TurnView {
  key: string        // composite "${sessionId}#${idx}"
  sessionId: string
  idx: number
  userText: string
  targetText: string
  streaming: string
  score?: {
    overall: number | null
    comment: string | null
    suggestion: string | null
    violation: boolean
    judgeError?: string
  } | null           // undefined=not yet scored, null=pending, object=scored
}

interface LiveState {
  runId: string | null
  turns: TurnView[]
  sessions: string[]
  avgScore: number | null
  apply: (e: LiveEvent) => void
  reset: (runId: string) => void
  hydrate: (sessions: HydrateSession[]) => void
}

export interface HydrateScore {
  overall: number | null
  comment: string | null
  improvementSuggestion: string | null
  violation: boolean
  judgeError?: string | null
}

export interface HydrateTurn {
  idx: number
  userText: string
  targetText: string
  score?: HydrateScore | null
}

export interface HydrateSession {
  id: string
  turns: HydrateTurn[]
}

export const useLive = create<LiveState>((set) => ({
  runId: null,
  turns: [],
  sessions: [],
  avgScore: null,

  reset: (runId) => set({ runId, turns: [], sessions: [], avgScore: null }),

  // load persisted turns from GET /api/runs/:id/turns on reconnect
  hydrate: (sessions) =>
    set((st) => {
      const turns: TurnView[] = [...st.turns]
      const seenSessions = new Set(st.sessions)
      for (const s of sessions) {
        seenSessions.add(s.id)
        for (const t of s.turns) {
          const key = `${s.id}#${t.idx}`
          const i = turns.findIndex(tv => tv.key === key)
          const view: TurnView = {
            key,
            sessionId: s.id,
            idx: t.idx,
            userText: t.userText,
            targetText: t.targetText,
            streaming: '',
            score: t.score
              ? { overall: t.score.overall, comment: t.score.comment, suggestion: t.score.improvementSuggestion, violation: t.score.violation, judgeError: t.score.judgeError ?? undefined }
              : undefined,
          }
          if (i === -1) turns.push(view)
          else turns[i] = view
        }
      }
      return { turns, sessions: Array.from(seenSessions) }
    }),

  apply: (e) =>
    set((st) => {
      const turns = [...st.turns]
      const seenSessions = new Set(st.sessions)

      // CRITICAL fix: composite key includes sessionId to avoid cross-session collisions
      const key = (sessionId: string, idx: number) => `${sessionId}#${idx}`

      const upsert = (sessionId: string, idx: number, patch: Partial<TurnView>) => {
        seenSessions.add(sessionId)
        const k = key(sessionId, idx)
        const i = turns.findIndex(t => t.key === k)
        if (i === -1) {
          turns.push({ key: k, sessionId, idx, userText: '', targetText: '', streaming: '', ...patch })
        } else {
          Object.assign(turns[i]!, patch)
        }
      }

      switch (e.type) {
        case 'turn.user':
          upsert(e.sessionId, e.idx, { userText: e.text })
          break
        case 'turn.target.delta':
          // Upsert so an early delta creates the turn (don't lose streaming text)
          upsert(e.sessionId, e.idx, {})
          {
            const k = key(e.sessionId, e.idx)
            const i = turns.findIndex(t => t.key === k)
            if (i !== -1) turns[i]!.streaming = (turns[i]!.streaming ?? '') + e.deltaText
          }
          break
        case 'turn.target.reset':
          // 被测后端重试：丢弃上一次尝试已推送的半截文本，避免新一次的全文接在后面
          upsert(e.sessionId, e.idx, { streaming: '' })
          break
        case 'turn.target.done':
          // Optimistically set score:null so "评分中…" shows while judge runs
          upsert(e.sessionId, e.idx, { targetText: e.fullText, streaming: '', score: null })
          break
        case 'turn.score':
          upsert(e.sessionId, e.idx, {
            score: {
              overall: e.overall,
              comment: e.comment,
              suggestion: e.suggestion,
              violation: e.violation,
              judgeError: e.judgeError,
            },
          })
          break
        default:
          break
      }
      return { turns, sessions: Array.from(seenSessions) }
    }),
}))
