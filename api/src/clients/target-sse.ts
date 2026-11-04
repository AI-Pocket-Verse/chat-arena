import type { TargetChatResult, TargetMeta } from '../types'

export type TargetSseEvent = Record<string, unknown>

export type TargetEvent =
  | { kind: 'processing'; stage?: string }
  | { kind: 'delta'; text: string; meta: TargetMeta }
  | { kind: 'image'; imageUrl: string; meta: TargetMeta }
  | { kind: 'done' }
  | { kind: 'error'; errorType: string; message: string; retryable: boolean }

export function splitSseEvents(buffer: string): { events: TargetSseEvent[]; rest: string } {
  const events: TargetSseEvent[] = []
  let rest = buffer
  let idx: number
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const block = rest.slice(0, idx)
    rest = rest.slice(idx + 2)
    for (const line of block.split('\n')) {
      const trimmed = line.replace(/^\s+/, '')
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice('data:'.length).trim()
      if (!payload) continue
      try {
        events.push(JSON.parse(payload) as TargetSseEvent)
      } catch {
        /* skip malformed */
      }
    }
  }
  return { events, rest }
}

function toMeta(d: Record<string, unknown>): TargetMeta {
  return {
    sessionId: typeof d.session_id === 'string' ? d.session_id : undefined,
    messageId: typeof d.message_id === 'number' ? d.message_id : undefined,
    emotionState: d.emotion_state,
    memoryUsed: typeof d.memory_used === 'boolean' ? d.memory_used : undefined,
    safetyMode: typeof d.safety_mode === 'boolean' ? d.safety_mode : undefined,
  }
}

export function classifyTargetEvent(e: TargetSseEvent): TargetEvent {
  if (e.type === 'done') {
    if (e.code === 200) return { kind: 'done' }
    const d = (e.data ?? {}) as Record<string, unknown>
    return {
      kind: 'error',
      errorType: typeof d.error_type === 'string' ? d.error_type : 'unknown',
      message: typeof d.message === 'string' ? d.message : typeof e.msg === 'string' ? e.msg : 'error',
      retryable: Boolean(d.retryable),
    }
  }
  const d = (e.data ?? {}) as Record<string, unknown>
  if (typeof d.image_url === 'string' && d.image_url.length > 0)
    return { kind: 'image', imageUrl: d.image_url, meta: toMeta(d) }
  if (typeof d.text === 'string' && d.text.length > 0)
    return { kind: 'delta', text: d.text, meta: toMeta(d) }
  return { kind: 'processing', stage: typeof d.stage === 'string' ? d.stage : undefined }
}

export class TargetChatAccumulator {
  private text = ''
  private firstTokenAt: number | null = null
  private done = false
  private error: TargetChatResult['error'] = null
  private meta: TargetMeta = {}

  constructor(
    private readonly startMs: number,
    private readonly now: () => number,
  ) {}

  push(ev: TargetEvent): void {
    switch (ev.kind) {
      case 'delta':
        if (this.firstTokenAt === null) this.firstTokenAt = this.now()
        this.text += ev.text
        this.meta = { ...this.meta, ...stripUndefined(ev.meta as Record<string, unknown>) }
        break
      case 'image':
        this.meta = { ...this.meta, ...stripUndefined(ev.meta as Record<string, unknown>) }
        break
      case 'error':
        this.error = { errorType: ev.errorType, message: ev.message, retryable: ev.retryable }
        this.done = true
        break
      case 'done':
        this.done = true
        break
      case 'processing':
        break
    }
  }

  isDone(): boolean { return this.done }

  result(): TargetChatResult {
    const end = this.now()
    return {
      text: this.text,
      firstTokenMs: this.firstTokenAt === null ? null : this.firstTokenAt - this.startMs,
      totalMs: end - this.startMs,
      done: this.done,
      error: this.error,
      meta: this.meta,
    }
  }
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}
