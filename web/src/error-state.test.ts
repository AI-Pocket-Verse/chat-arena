import { HttpError } from '@chat-arena/http-client'
import { describe, expect, it } from 'vitest'

import { describeError } from './error-state'
import { translator } from './i18n'

describe('describeError', () => {
  it('shows the server-provided message and error code (e.g. which API key is missing)', () => {
    const body = { error: 'model_key_missing', message: '模型 deepseek:deepseek-chat 缺少 API Key，请在 api/.env.dev 配置 DEEPSEEK_API_KEY' }
    const info = describeError(new HttpError(503, 'http_error', 'HTTP 503', body))
    expect(info.summary).toBe(body.message)
    expect(info.code).toBe('model_key_missing')
    expect(info.status).toBe(503)
  })

  it('falls back to a status summary in the UI language when the body has no message', () => {
    const err = new HttpError(503, 'http_error', 'HTTP 503', { error: 'busy' })
    expect(describeError(err, translator('zh')).summary).toContain('服务暂时不可用')
    expect(describeError(err, translator('en')).summary).toContain('temporarily unavailable')
  })
})
