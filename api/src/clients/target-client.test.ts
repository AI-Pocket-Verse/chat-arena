import { describe, expect, it, vi } from 'vitest'
import { createTargetClient } from './target-client'

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('createTargetClient.generateDebugToken', () => {
  it('posts X-Debug-Key + ta_gender and returns the first token', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ code: 200, data: { count: 1, tokens: [{ token: 'jwt-abc', uid: 7, memory_id: 42 }] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const client = createTargetClient({ baseUrl: 'http://target.test', debugKey: 'k1', fetchImpl: fetchImpl as any })
    expect(await client.generateDebugToken({ taGender: 1 })).toEqual({ token: 'jwt-abc', uid: 7, memoryId: 42 })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://target.test/debug/token')
    expect((init.headers as Record<string, string>)['X-Debug-Key']).toBe('k1')
    expect(JSON.parse(init.body as string)).toMatchObject({ ta_gender: 1, count: 1 })
  })
})

describe('createTargetClient.chat', () => {
  it('stream closed without done event → result.error.errorType === stream_incomplete, retryable true', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        'data: {"data":{"status":"processing","stage":"accepted","text":""}}\n\n',
        'data: {"data":{"text":"你好","session_id":"s1","message_id":1,"memory_used":false}}\n\n',
        // no done event — stream just closes
      ]),
    )
    const client = createTargetClient({ baseUrl: 'http://target.test', debugKey: 'k1', fetchImpl: fetchImpl as any })
    const r = await client.chat('jwt-abc', '在吗', 'cm-incomplete')
    expect(r.error).not.toBeNull()
    expect(r.error?.errorType).toBe('stream_incomplete')
    expect(r.error?.retryable).toBe(true)
    expect(r.text).toBe('你好') // accumulated text is still present
  })

  it('streams SSE, accumulates reply + raw JWT auth (no Bearer prefix) + fires onDelta', async () => {
    let t = 0
    const fetchImpl = vi.fn(async () => {
      t = 100
      return sseResponse([
        'data: {"data":{"status":"processing","stage":"accepted","text":""}}\n\n',
        'data: {"data":{"text":"你好","session_id":"s9","message_id":3,"memory_used":true}}\n\n',
        'data: {"data":{"text":"呀"}}\n\n',
        'data: {"type":"done","code":200,"data":null}\n\n',
      ])
    })
    const deltas: string[] = []
    const client = createTargetClient({ baseUrl: 'http://target.test', debugKey: 'k1', fetchImpl: fetchImpl as any, now: () => t })
    const r = await client.chat('jwt-abc', '在吗', 'cm-1', { onDelta: d => deltas.push(d) })
    expect(r.text).toBe('你好呀')
    expect(deltas).toEqual(['你好', '呀'])
    expect(r.meta).toMatchObject({ sessionId: 's9', messageId: 3, memoryUsed: true })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://target.test/chat')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('jwt-abc') // target uses raw JWT, no Bearer
    expect(JSON.parse(init.body as string)).toMatchObject({ content: '在吗', content_type: 'text', client_message_id: 'cm-1' })
  })
})

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('信封 code 校验（业务错误走 HTTP 200 + code≠200）', () => {
  it('/debug/token 口令错：抛出后端的 msg，而不是 empty tokens', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 403, msg: 'forbidden: X-Debug-Key 不正确' }))
    const client = createTargetClient({ baseUrl: 'http://t.test', debugKey: 'bad', fetchImpl: fetchImpl as any })
    await expect(client.generateDebugToken()).rejects.toThrow(/X-Debug-Key 不正确.*403/)
  })

  it('/debug/roles 口令错：抛错而不是返回空列表', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 403, msg: 'forbidden' }))
    const client = createTargetClient({ baseUrl: 'http://t.test', debugKey: 'bad', fetchImpl: fetchImpl as any })
    await expect(client.listRoles()).rejects.toThrow(/forbidden.*403/)
  })

  it('/chat token 无效（JSON 信封）：返回不可重试的 target_rejected 错误', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ code: 401, msg: 'token 无效' }))
    const client = createTargetClient({ baseUrl: 'http://t.test', debugKey: 'k', fetchImpl: fetchImpl as any })
    const r = await client.chat('bad', 'hi', 'id1')
    expect(r.error).toMatchObject({ errorType: 'target_rejected', retryable: false })
    expect(r.error?.message).toContain('token 无效')
  })
})

describe('createTargetClient redirects', () => {
  it('does not follow redirects, so X-Debug-Key never reaches another origin', async () => {
    const { createServer } = await import('node:http')
    const leaked: string[] = []
    const sink = createServer((req, res) => { leaked.push(String(req.headers['x-debug-key'] ?? '')); res.end('{}') })
    await new Promise<void>((r) => sink.listen(0, '127.0.0.1', r))
    const sinkPort = (sink.address() as { port: number }).port
    const target = createServer((_req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${sinkPort}/steal` }); res.end() })
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r))
    const targetPort = (target.address() as { port: number }).port
    try {
      const client = createTargetClient({ baseUrl: `http://127.0.0.1:${targetPort}`, debugKey: 'secret-k' })
      await expect(client.listRoles()).rejects.toThrow()
      await expect(client.generateDebugToken()).rejects.toThrow()
      expect(leaked).toEqual([])
    } finally {
      sink.close(); target.close()
    }
  })
})
