import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { buildModelRegistry, createModelClient, defaultModelId, extractJson, modelConfigError, resolveModel } from './model-client'

const env = {
  ARK_API_KEY: 'ark-key', ARK_BASE_URL: 'http://ark.test/v3', ARK_MODELS: 'doubao-seed-1-6',
  QWEN_API_KEY: 'qwen-key', QWEN_MODELS: 'qwen-plus, qwen-max',
  DEEPSEEK_API_KEY: '', DEEPSEEK_MODELS: 'deepseek-chat',
  ANTHROPIC_API_KEY: 'ant-key', ANTHROPIC_MODELS: 'claude-sonnet-5-5',
  CUSTOM_BASE_URL: 'http://127.0.0.1:11434/v1', CUSTOM_MODELS: 'qwen3:8b',
}

describe('buildModelRegistry', () => {
  it('registers every model listed in <PREFIX>_MODELS as <provider>:<model>', () => {
    const reg = buildModelRegistry(env)
    expect(Object.keys(reg).sort()).toEqual(['anthropic:claude-sonnet-5-5', 'custom:qwen3:8b', 'deepseek:deepseek-chat', 'doubao:doubao-seed-1-6', 'qwen:qwen-max', 'qwen:qwen-plus'])
    expect(resolveModel(reg, 'doubao:doubao-seed-1-6')).toMatchObject({ baseURL: 'http://ark.test/v3', model: 'doubao-seed-1-6', apiKey: 'ark-key', label: '豆包 · doubao-seed-1-6' })
  })
  it('falls back to the official base URL when <PREFIX>_BASE_URL is empty', () => {
    expect(resolveModel(buildModelRegistry(env), 'qwen:qwen-plus').baseURL).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
  })
  it('keeps colons in model names (custom:qwen3:8b)', () => {
    expect(resolveModel(buildModelRegistry(env), 'custom:qwen3:8b').model).toBe('qwen3:8b')
  })
  it('registers nothing when no *_MODELS is set', () => {
    expect(buildModelRegistry({ QWEN_API_KEY: 'k' })).toEqual({})
  })
  it('throws on unknown id', () => {
    expect(() => resolveModel(buildModelRegistry(env), 'nope')).toThrow(/unknown model/)
  })
})

describe('modelConfigError', () => {
  it('passes a fully configured model', () => {
    expect(modelConfigError(buildModelRegistry(env), 'qwen:qwen-plus')).toBeNull()
  })
  it('names the env var to set when the API key is missing', () => {
    const bad = modelConfigError(buildModelRegistry(env), 'deepseek:deepseek-chat')
    expect(bad).toMatchObject({ error: 'model_key_missing' })
    expect(bad?.message).toContain('DEEPSEEK_API_KEY')
  })
  it('custom provider needs no key but needs a base URL', () => {
    expect(modelConfigError(buildModelRegistry(env), 'custom:qwen3:8b')).toBeNull()
    expect(modelConfigError(buildModelRegistry({ CUSTOM_MODELS: 'm' }), 'custom:m')?.message).toContain('CUSTOM_BASE_URL')
  })
  it('unknown ids point to the right *_MODELS variable', () => {
    expect(modelConfigError(buildModelRegistry(env), 'kimi:kimi-k2')).toMatchObject({ error: 'unknown_model' })
    expect(modelConfigError(buildModelRegistry(env), 'kimi:kimi-k2')?.message).toContain('KIMI_MODELS')
  })
})

describe('defaultModelId', () => {
  const reg = buildModelRegistry(env)
  it('uses DEFAULT_MODEL when it is ready', () => {
    expect(defaultModelId(reg, 'qwen:qwen-max')).toBe('qwen:qwen-max')
  })
  it('falls back to the first ready model when DEFAULT_MODEL is missing or not ready', () => {
    expect(defaultModelId(reg, 'deepseek:deepseek-chat')).toBe('anthropic:claude-sonnet-5-5')
    expect(defaultModelId(reg, '')).toBe('anthropic:claude-sonnet-5-5')
  })
  it('is undefined when nothing is ready', () => {
    expect(defaultModelId(buildModelRegistry({ DEEPSEEK_MODELS: 'x' }))).toBeUndefined()
  })
})

function fakeMaker(responses: string[]) {
  let i = 0
  return () => ({
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: responses[Math.min(i++, responses.length - 1)] } }],
        })),
      },
    },
  })
}

describe('createModelClient', () => {
  const Schema = z.object({ score: z.number() })

  it('chatText returns assistant content', async () => {
    const c = createModelClient(buildModelRegistry(env), { makeClient: fakeMaker(['你好']) as any })
    expect(await c.chatText('qwen:qwen-plus', [{ role: 'user', content: 'hi' }])).toBe('你好')
  })

  it('chatJson parses valid json', async () => {
    const c = createModelClient(buildModelRegistry(env), { makeClient: fakeMaker(['{"score":4}']) as any })
    expect(await c.chatJson('qwen:qwen-plus', [{ role: 'user', content: 'x' }], Schema)).toEqual({ score: 4 })
  })

  it('chatJson retries once on malformed then succeeds', async () => {
    const c = createModelClient(buildModelRegistry(env), { makeClient: fakeMaker(['not json', '{"score":5}']) as any, maxJsonRetries: 1 })
    expect(await c.chatJson('qwen:qwen-plus', [{ role: 'user', content: 'x' }], Schema)).toEqual({ score: 5 })
  })

  it('chatJson throws after exhausting retries', async () => {
    const c = createModelClient(buildModelRegistry(env), { makeClient: fakeMaker(['nope', 'still nope']) as any, maxJsonRetries: 1 })
    await expect(c.chatJson('qwen:qwen-plus', [{ role: 'user', content: 'x' }], Schema)).rejects.toThrow()
  })

  it('chatJson falls back when response_format causes a provider error', async () => {
    let call = 0
    const create = vi.fn(async (args: any) => {
      if (call++ === 0 && args.response_format) throw new Error('invalid parameter: response_format')
      return { choices: [{ message: { content: '{"score":3}' } }] }
    })
    const c = createModelClient(buildModelRegistry(env), { makeClient: () => ({ chat: { completions: { create } } }) as any })
    expect(await c.chatJson('qwen:qwen-plus', [{ role: 'user', content: 'x' }], Schema)).toEqual({ score: 3 })
  })
})

describe('provider flags', () => {
  it('Anthropic: omits temperature and response_format', async () => {
    const create = vi.fn(async (_args: any) => ({ choices: [{ message: { content: '{"score":1}' } }] }))
    const c = createModelClient(buildModelRegistry(env), { makeClient: () => ({ chat: { completions: { create } } }) as any })
    await c.chatJson('anthropic:claude-sonnet-5-5', [{ role: 'user', content: 'x' }], z.object({ score: z.number() }))
    expect(create.mock.calls[0]![0]).not.toHaveProperty('temperature')
    expect(create.mock.calls[0]![0]).not.toHaveProperty('response_format')
  })
  it('other providers send temperature and json_object', async () => {
    const create = vi.fn(async (_args: any) => ({ choices: [{ message: { content: '{"score":1}' } }] }))
    const c = createModelClient(buildModelRegistry(env), { makeClient: () => ({ chat: { completions: { create } } }) as any })
    await c.chatJson('qwen:qwen-plus', [{ role: 'user', content: 'x' }], z.object({ score: z.number() }))
    expect(create.mock.calls[0]![0]).toMatchObject({ model: 'qwen-plus', temperature: 0, response_format: { type: 'json_object' } })
  })
})

describe('extractJson', () => {
  it('returns clean JSON object unchanged (fast path)', () => {
    expect(extractJson('{"score":7}')).toBe('{"score":7}')
  })

  it('strips leading prose before {', () => {
    expect(extractJson('Here is the result: {"score":7}')).toBe('{"score":7}')
  })

  it('strips trailing prose after } even when prose contains }', () => {
    // The model appended "end}" after the JSON — old slice logic would over-extend
    const raw = '{"score":7} Some trailing text with a } brace'
    const result = extractJson(raw)
    expect(() => JSON.parse(result)).not.toThrow()
    expect(JSON.parse(result)).toEqual({ score: 7 })
  })

  it('handles top-level array', () => {
    const raw = 'Here: [1,2,3] done'
    const result = extractJson(raw)
    expect(JSON.parse(result)).toEqual([1, 2, 3])
  })

  it('ignores } inside string literals', () => {
    const raw = 'prefix {"msg":"hello}world","v":1} suffix with }'
    const result = extractJson(raw)
    expect(JSON.parse(result)).toEqual({ msg: 'hello}world', v: 1 })
  })

  it('handles escaped quotes inside strings', () => {
    const raw = '{"key":"val\\"ue","n":2}'
    expect(JSON.parse(extractJson(raw))).toEqual({ key: 'val"ue', n: 2 })
  })

  it('handles nested objects', () => {
    const raw = 'result: {"a":{"b":{"c":3}}} extra'
    expect(JSON.parse(extractJson(raw))).toEqual({ a: { b: { c: 3 } } })
  })

  it('returns raw when no bracket found', () => {
    expect(extractJson('no json here')).toBe('no json here')
  })
})
