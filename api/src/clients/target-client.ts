import type { TargetChatResult, TargetRole, TargetRolePromptPersona } from '../types'
import { TargetChatAccumulator, classifyTargetEvent, splitSseEvents } from './target-sse'

export interface TargetClientConfig {
  baseUrl: string
  debugKey: string
  /** 额外请求头，每个请求都带上（如被测后端要求的客户端版本头） */
  headers?: Record<string, string>
  fetchImpl?: typeof fetch
  now?: () => number
  /** Request timeout in ms for generateDebugToken and chat. Defaults to 60000. */
  timeoutMs?: number
}

export interface DebugToken {
  token: string
  uid: number
  memoryId: number
}

export interface ChatOpts {
  onDelta?: (text: string) => void
}

export interface TargetClient {
  generateDebugToken(opts?: { taGender?: 1 | 2 }): Promise<DebugToken>
  chat(token: string, content: string, clientMessageId: string, opts?: ChatOpts): Promise<TargetChatResult>
  listRoles(): Promise<TargetRole[]>
}

function mapTargetRole(raw: unknown): TargetRole {
  const r = raw as Record<string, unknown>
  const str = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined
  const num = (v: unknown): number | undefined => typeof v === 'number' ? v : undefined
  const arr = (v: unknown): string[] | undefined => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined

  let promptPersona: TargetRolePromptPersona | undefined
  if (r['prompt_persona'] && typeof r['prompt_persona'] === 'object') {
    const pp = r['prompt_persona'] as Record<string, unknown>
    promptPersona = {
      identityBase: str(pp['identity_base']),
      dailyStyle: str(pp['daily_style']),
      relationshipBase: str(pp['relationship_base']),
      emotionSupport: str(pp['emotion_support']),
      mediaPolicy: str(pp['media_policy']),
      realityBoundary: str(pp['reality_boundary']),
      safetyBoundary: str(pp['safety_boundary']),
    }
  }

  return {
    id: typeof r['id'] === 'number' ? r['id'] : 0,
    name: str(r['name']) ?? '',
    nickname: str(r['nickname']),
    gender: num(r['gender']) ?? 0,
    age: num(r['age']),
    city: str(r['city']),
    height: num(r['height']),
    voice: str(r['voice']),
    avatar: str(r['avatar']),
    brief: str(r['brief']),
    title: str(r['title']),
    tags: arr(r['tags']),
    chatPersona: str(r['chat_persona']),
    promptPersona,
    renderedPrompt: str(r['rendered_prompt']),
  }
}

/** 业务错误信封 {code≠200,msg}：被测后端约定业务错误也走 HTTP 200，必须看 code。返回错误文案，非错误返回 null。 */
function envelopeError(json: unknown): { code: number; msg: string } | null {
  if (!json || typeof json !== 'object') return null
  const j = json as { code?: unknown; msg?: unknown }
  if (typeof j.code !== 'number' || j.code === 200) return null
  return { code: j.code, msg: typeof j.msg === 'string' && j.msg ? j.msg : `code ${j.code}` }
}

export function createTargetClient(cfg: TargetClientConfig): TargetClient {
  const doFetch = cfg.fetchImpl ?? fetch
  const now = cfg.now ?? (() => Date.now())
  const base = cfg.baseUrl.replace(/\/+$/, '')
  const timeoutMs = cfg.timeoutMs ?? 60_000
  const extra = cfg.headers ?? {}

  return {
    async generateDebugToken(opts = {}) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      try {
        const res = await doFetch(`${base}/debug/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Key': cfg.debugKey, ...extra },
          body: JSON.stringify({ ta_gender: opts.taGender ?? 2, expires_at: 0, count: 1 }),
          signal: ac.signal,
          redirect: 'error', // 不跟随重定向：否则 Debug Key 与额外请求头会被带到白名单外的地址
        })
        if (!res.ok) throw new Error(`target debug/token failed: HTTP ${res.status}`)
        const json = (await res.json()) as { data?: { tokens?: Array<{ token: string; uid: number; memory_id: number }> } }
        const bad = envelopeError(json)
        if (bad) throw new Error(`target debug/token rejected: ${bad.msg} (code=${bad.code})`)
        const t = json.data?.tokens?.[0]
        if (!t) throw new Error('target debug/token: empty tokens')
        return { token: t.token, uid: t.uid, memoryId: t.memory_id }
      } finally {
        clearTimeout(timer)
      }
    },

    async chat(token, content, clientMessageId, opts = {}) {
      const start = now()
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      try {
        const res = await doFetch(`${base}/chat`, {
          method: 'POST',
          headers: { Authorization: token, 'Content-Type': 'application/json', ...extra }, // token 原样放进 Authorization，不加 Bearer 前缀
          body: JSON.stringify({ content, content_type: 'text', client_message_id: clientMessageId }),
          signal: ac.signal,
          redirect: 'error', // 不跟随重定向：否则 Debug Key 与额外请求头会被带到白名单外的地址
        })
        if (!res.ok || !res.body) throw new Error(`target chat failed: HTTP ${res.status}`)
        // token 失效等业务错误：HTTP 200 + JSON 信封（不是 SSE）。按错误返回；4xx 类（口令 / token 问题）不重试。
        if ((res.headers.get('content-type') ?? '').includes('application/json')) {
          const bad = envelopeError(await res.json().catch(() => null))
          const acc = new TargetChatAccumulator(start, now)
          acc.push({
            kind: 'error',
            errorType: 'target_rejected',
            message: bad ? `${bad.msg} (code=${bad.code})` : 'target returned JSON instead of an event stream',
            retryable: bad ? bad.code >= 500 : false,
          })
          return acc.result()
        }
        const acc = new TargetChatAccumulator(start, now)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const { events, rest } = splitSseEvents(buf)
          buf = rest
          for (const e of events) {
            const ev = classifyTargetEvent(e)
            if (ev.kind === 'delta' && opts.onDelta) opts.onDelta(ev.text)
            acc.push(ev)
          }
          if (acc.isDone()) break
        }
        // flush any multibyte-split remainder after stream closes
        buf += decoder.decode()
        if (buf.trim()) {
          const { events } = splitSseEvents(buf.endsWith('\n\n') ? buf : buf + '\n\n')
          for (const e of events) {
            const ev = classifyTargetEvent(e)
            if (ev.kind === 'delta' && opts.onDelta) opts.onDelta(ev.text)
            acc.push(ev)
          }
        }
        // If stream closed without a done/error frame, synthesize a retryable error
        if (!acc.isDone()) {
          acc.push({ kind: 'error', errorType: 'stream_incomplete', message: 'stream closed without done', retryable: true })
        }
        return acc.result()
      } finally {
        clearTimeout(timer)
      }
    },

    async listRoles() {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      try {
        const res = await doFetch(`${base}/debug/roles`, {
          method: 'GET',
          headers: { 'X-Debug-Key': cfg.debugKey, ...extra },
          signal: ac.signal,
          redirect: 'error', // 不跟随重定向：否则 Debug Key 与额外请求头会被带到白名单外的地址
        })
        if (!res.ok) throw new Error(`target debug/roles failed: HTTP ${res.status}`)
        const json = (await res.json()) as { data?: { roles?: unknown[] } }
        const bad = envelopeError(json)
        if (bad) throw new Error(`target debug/roles rejected: ${bad.msg} (code=${bad.code})`)
        const rows = json.data?.roles ?? []
        return rows.map(mapTargetRole)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
