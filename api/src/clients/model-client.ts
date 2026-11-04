import OpenAI from 'openai'
import type { ZodSchema } from 'zod'

import providersJson from '@chat-arena/shared/providers.json'

/** 一家模型供应商（OpenAI 兼容接口），登记在 shared/providers.json，api 与 mock 共用。 */
export interface ProviderDef {
  id: string
  label: string
  /** 环境变量前缀：<env>_API_KEY / <env>_BASE_URL / <env>_MODELS */
  env: string
  baseUrl: string
  /** 不需要 key（本地 Ollama 等） */
  keyOptional?: boolean
  /** 不传 temperature（Anthropic 新模型传了会 400） */
  noTemperature?: boolean
  /** 不用 response_format: json_object（Anthropic 兼容层只收 json_schema） */
  noJsonMode?: boolean
}

export const PROVIDERS = providersJson as ProviderDef[]

export interface ResolvedModel {
  /** 模型 id：`<供应商>:<模型名>`，如 `qwen:qwen-plus` */
  id: string
  /** 下拉框里显示的名字 */
  label: string
  provider: ProviderDef
  baseURL: string
  apiKey: string
  model: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ModelRegistry = Record<string, ResolvedModel>

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/**
 * 按环境变量登记模型：每家供应商在 `<前缀>_MODELS` 里列出模型名（逗号分隔），
 * key 与地址分别取 `<前缀>_API_KEY`、`<前缀>_BASE_URL`（留空用官方地址）。
 * 只有列在 `_MODELS` 里的模型会出现在新建评测页。
 */
export function buildModelRegistry(env: Record<string, string | undefined>): ModelRegistry {
  const reg: ModelRegistry = {}
  for (const p of PROVIDERS) {
    for (const model of list(env[`${p.env}_MODELS`])) {
      const id = `${p.id}:${model}`
      reg[id] = {
        id, label: `${p.label} · ${model}`, provider: p, model,
        apiKey: env[`${p.env}_API_KEY`]?.trim() ?? '',
        baseURL: env[`${p.env}_BASE_URL`]?.trim() || p.baseUrl,
      }
    }
  }
  return reg
}

export function resolveModel(reg: ModelRegistry, id: string): ResolvedModel {
  const m = reg[id]
  if (!m) throw new Error(`unknown model: ${id}`)
  return m
}

/**
 * 模型能否调用的预检：未登记、缺 API Key、缺地址时返回可区分的错误，
 * 让发起评测的请求直接告诉用户该配哪个环境变量，而不是跑到一半才失败。
 */
export function modelConfigError(
  reg: ModelRegistry,
  id: string,
): { error: 'unknown_model' | 'model_key_missing'; message: string } | null {
  const m = reg[id]
  if (!m) {
    const [pid] = id.split(':')
    const p = PROVIDERS.find((x) => x.id === pid)
    const hint = p ? `请在 api/.env.dev（生产为 .env.prod）的 ${p.env}_MODELS 里登记` : '模型 id 格式为 <供应商>:<模型名>，如 qwen:qwen-plus'
    return { error: 'unknown_model', message: `未知模型：${id}，${hint}` }
  }
  if (!m.apiKey && !m.provider.keyOptional) return { error: 'model_key_missing', message: `模型 ${id} 缺少 API Key，请在 api/.env.dev（生产为 .env.prod）配置 ${m.provider.env}_API_KEY` }
  if (!m.baseURL) return { error: 'model_key_missing', message: `模型 ${id} 缺少接口地址，请配置 ${m.provider.env}_BASE_URL` }
  return null
}

/** 默认模型：`DEFAULT_MODEL` 可用时用它，否则取第一个配好的模型；一个都没有时为 undefined。 */
export function defaultModelId(reg: ModelRegistry, preferred?: string): string | undefined {
  if (preferred && !modelConfigError(reg, preferred)) return preferred
  return Object.keys(reg).find((id) => !modelConfigError(reg, id))
}

interface OpenAILike {
  chat: { completions: { create: (args: unknown) => Promise<{ choices: Array<{ message: { content: string | null } }> }> } }
}

export interface ModelClientDeps {
  makeClient?: (m: ResolvedModel) => OpenAILike
  maxJsonRetries?: number
}

export interface ModelClient {
  chatText(alias: string, messages: ChatMessage[], opts?: { temperature?: number }): Promise<string>
  chatJson<T>(alias: string, messages: ChatMessage[], schema: ZodSchema<T>, opts?: { temperature?: number }): Promise<T>
}

/** 单次模型调用超时。SDK 默认 10 分钟 + 2 次重试，供应商卡住时会让会话长时间挂起。 */
const MODEL_TIMEOUT_MS = 90_000

export function createModelClient(reg: ModelRegistry, deps: ModelClientDeps = {}): ModelClient {
  const maxJsonRetries = deps.maxJsonRetries ?? 2
  const makeClient = deps.makeClient ??
    ((m: ResolvedModel): OpenAILike => new OpenAI({ apiKey: m.apiKey || 'none', baseURL: m.baseURL, timeout: MODEL_TIMEOUT_MS, maxRetries: 1 }) as unknown as OpenAILike)

  async function complete(
    alias: string,
    messages: ChatMessage[],
    opts: { temperature?: number; jsonMode?: boolean },
  ): Promise<string> {
    const m = resolveModel(reg, alias)
    const client = makeClient(m)
    const body: Record<string, unknown> = { model: m.model, messages }
    if (!m.provider.noTemperature) body.temperature = opts.temperature ?? 0.7
    if (opts.jsonMode && !m.provider.noJsonMode) body.response_format = { type: 'json_object' }
    // 调试日志：reasoning 类模型（deepseek-v4 等）单次调用可达数十秒，带耗时方便定位“无反应”
    const t0 = Date.now()
    console.log(`[model] → ${alias}${opts.jsonMode ? ' [json]' : ''} msgs=${messages.length}`)
    try {
      const res = await client.chat.completions.create(body)
      const text = res.choices[0]?.message?.content ?? ''
      console.log(`[model] ← ${alias} ${Date.now() - t0}ms len=${text.length}${text.length === 0 ? ' ⚠️ 空回复' : ''}`)
      return text
    } catch (err) {
      console.error(`[model] ✗ ${alias} ${Date.now() - t0}ms:`, err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  return {
    async chatText(alias, messages, opts = {}) {
      return complete(alias, messages, { temperature: opts.temperature })
    },

    async chatJson(alias, messages, schema, opts = {}) {
      let lastErr: unknown
      let useJsonMode = true
      for (let attempt = 0; attempt <= maxJsonRetries; attempt++) {
        try {
          const raw = await complete(alias, messages, { temperature: opts.temperature ?? 0, jsonMode: useJsonMode })
          return schema.parse(JSON.parse(extractJson(raw)))
        } catch (err) {
          lastErr = err
          // If the provider rejects response_format, switch to plain mode and don't charge the retry budget
          if (useJsonMode && err instanceof Error && /response_format/i.test(err.message)) {
            useJsonMode = false
            attempt-- // this attempt was a format probe, not a parse attempt
            console.log(`[model] ${alias} 不支持 response_format，降级为纯文本 JSON 解析`)
          } else {
            console.error(`[model] chatJson ${alias} 第 ${attempt + 1}/${maxJsonRetries + 1} 次失败:`, err instanceof Error ? err.message : String(err))
          }
        }
      }
      throw new Error(`chatJson failed after ${maxJsonRetries + 1} attempts: ${String(lastErr)}`)
    },
  }
}

export function extractJson(raw: string): string {
  const trimmed = raw.trim()

  // Fast path: the entire response is valid JSON (most common case for json_object mode).
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch { /* fall through to bracket-matching */ }

  // Find the first opening bracket (object or array).
  let startIdx = -1
  let openChar = ''
  let closeChar = ''
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '{') { startIdx = i; openChar = '{'; closeChar = '}'; break }
    if (trimmed[i] === '[') { startIdx = i; openChar = '['; closeChar = ']'; break }
  }
  if (startIdx === -1) return raw

  // Bracket-matching scan that respects string literals and escape sequences.
  let depth = 0
  let inString = false
  for (let i = startIdx; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inString) {
      if (ch === '\\') {
        i++ // skip escaped character
      } else if (ch === '"') {
        inString = false
      }
    } else {
      if (ch === '"') {
        inString = true
      } else if (ch === openChar) {
        depth++
      } else if (ch === closeChar) {
        depth--
        if (depth === 0) return trimmed.slice(startIdx, i + 1)
      }
    }
  }

  // No matching close found — return from startIdx to end and let the caller handle it.
  return trimmed.slice(startIdx)
}
