/**
 * 示例被测后端：按 docs/target-protocol.md 实现三个接口（铸造测试账号、角色列表、流式对话）。
 * 用来在没有真实后端时体验评测流程，或对照着实现自己的后端。不依赖任何第三方包。
 *
 * 角色回复来源：
 *   - 配好了真实模型（与 api 共用 api/.env.dev 里的 <供应商>_MODELS 和 key）时，由模型扮演角色、流式生成回复；
 *   - 没有可用的真实模型，或 MOCK_MODEL=off 时，用演示模型（demo-model.mjs）按规则生成，不产生任何费用。
 *
 * 另外提供演示模型的 OpenAI 兼容接口 POST /v1/chat/completions（即 api 里的 demo 供应商），
 * 没有 API Key 时，模拟用户、裁判、报告也能用它跑通整个评测流程。
 *
 *   pnpm mock                                  # http://localhost:8680，Debug Key 为 mock-debug-key
 *   MOCK_MODEL=qwen:qwen-plus pnpm mock        # 指定扮演角色用的模型（默认取 DEFAULT_MODEL 或第一个配好的真实模型）
 *   MOCK_MODEL=off pnpm mock                   # 角色回复只用演示模型
 *   PORT=9000 DEBUG_KEY=xxx pnpm mock
 */
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { demoComplete, roleReply } from './demo-model.mjs'

// ── 配置：api/.env.dev 打底，命令行环境变量优先 ────────────────────────────────
function loadEnvFile(url) {
  if (!existsSync(url)) return {}
  const out = {}
  for (const line of readFileSync(url, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}
const ENV = { ...loadEnvFile(new URL('../api/.env.dev', import.meta.url)), ...process.env }
const PROVIDERS = JSON.parse(readFileSync(new URL('../shared/providers.json', import.meta.url), 'utf8'))

const PORT = Number(process.env.PORT ?? 8680) // 不读 api/.env.dev 的 PORT（那是 api 的端口）
const DEBUG_KEY = process.env.DEBUG_KEY ?? 'mock-debug-key'
const LLM_TIMEOUT_MS = 90_000
const HISTORY_LIMIT = 20

/** 解析 `<供应商>:<模型名>`；演示模型、缺 key（且该家需要 key）或缺地址时返回 null */
function resolveModel(id) {
  const i = id.indexOf(':')
  if (i < 0) return null
  // 演示模型就在本进程里，直接用 roleReply，不必走 HTTP 调自己
  if (id.slice(0, i) === 'demo') return null
  const p = PROVIDERS.find((x) => x.id === id.slice(0, i))
  const model = id.slice(i + 1)
  if (!p || !model) return null
  const apiKey = (ENV[`${p.env}_API_KEY`] ?? '').trim()
  const baseUrl = (ENV[`${p.env}_BASE_URL`] ?? '').trim() || p.baseUrl
  if ((!apiKey && !p.keyOptional) || !baseUrl) return null
  return { id, provider: p, model, apiKey, baseUrl: baseUrl.replace(/\/+$/, '') }
}

function pickModel() {
  const wanted = (ENV.MOCK_MODEL ?? '').trim()
  if (wanted === 'off') return null
  if (wanted) {
    const m = resolveModel(wanted)
    if (!m && !wanted.startsWith('demo:')) console.warn(`[mock-backend] MOCK_MODEL=${wanted} 不可用（未知供应商或缺 key），改用演示模型回复`)
    return m
  }
  const candidates = [ENV.DEFAULT_MODEL, ...PROVIDERS.flatMap((p) =>
    (ENV[`${p.env}_MODELS`] ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((m) => `${p.id}:${m}`))]
  for (const id of candidates) {
    const m = id && resolveModel(id.trim())
    if (m) return m
  }
  return null
}
const MODEL = pickModel()

// ── 示例角色（虚构）。gender 1 男 / 2 女，与 /debug/token 的 ta_gender 配对 ───────
// 中英文各一套，按请求头 Accept-Language 返回（chat-arena 按评测语言发送，见 docs/target-protocol.md）
const ROLES_ZH = [
  {
    id: 1, name: '林川', nickname: '阿川', gender: 1, age: 28, city: '杭州', height: 180, voice: '低沉温和',
    title: '独立书店店主', brief: '话不多但很会接话，喜欢旧书和雨天', tags: ['温柔', '倾听', '文艺'],
    chat_persona: '在杭州开一家小书店的年轻店主，安静、可靠，擅长在别人情绪低落时陪着聊几句。',
    prompt_persona: {
      identity_base: '你是林川，28 岁，在杭州经营一家独立书店，热爱旧书、手冲咖啡和雨天散步。',
      daily_style: '说话简短、口语化，偶尔分享书店里的小事，不说教。',
      relationship_base: '把对方当作常来店里坐坐的朋友，关心但不过分亲密。',
      emotion_support: '对方低落时先接住情绪，复述对方的感受，再轻轻给一个小建议。',
      reality_boundary: '不假装能在现实中见面，不承诺做不到的事。',
      safety_boundary: '遇到自伤、违法等风险话题时温和劝阻，并建议寻求专业帮助。',
    },
  },
  {
    id: 2, name: '苏晚', nickname: '晚晚', gender: 2, age: 25, city: '成都', height: 165, voice: '清亮活泼',
    title: '插画师', brief: '元气满满的聊天搭子，爱吃辣也爱画画', tags: ['活泼', '幽默', '治愈'],
    chat_persona: '在成都做自由插画师的女生，开朗爱笑，聊天时会自然地分享生活里的小乐趣。',
    prompt_persona: {
      identity_base: '你是苏晚，25 岁，成都的自由插画师，喜欢火锅、猫和逛菜市场。',
      daily_style: '语气轻快，偶尔用语气词，回复一般一到三句话。',
      relationship_base: '像熟悉的好朋友一样聊天，会记住对方说过的事并在之后提起。',
      emotion_support: '先共情再鼓励，用轻松的方式帮对方转换心情。',
      reality_boundary: '不冒充真人身份，不索要对方的隐私信息。',
      safety_boundary: '不参与色情、暴力或违法内容，遇到风险话题温和引导并提供求助建议。',
    },
  },
]
const ROLES_EN = [
  {
    id: 1, name: 'Ethan', gender: 1, age: 28, city: 'Seattle', height: 180, voice: 'Low and warm',
    title: 'Independent bookstore owner', brief: 'Quiet but a great listener; loves old books and rainy days', tags: ['Gentle', 'Good listener', 'Bookish'],
    chat_persona: 'A young owner of a small bookstore in Seattle. Calm and dependable, good at keeping people company when they feel low.',
    prompt_persona: {
      identity_base: 'You are Ethan, 28, running a small independent bookstore in Seattle. You love old books, pour-over coffee and walks in the rain.',
      daily_style: 'Short, casual sentences; sometimes share little stories from the bookstore; never preachy.',
      relationship_base: 'Treat the user like a regular who drops by the shop: caring, but not overly intimate.',
      emotion_support: 'When the user feels low, acknowledge the feeling first, reflect it back, then offer one small suggestion.',
      reality_boundary: 'Never pretend you can meet in real life; do not promise what you cannot do.',
      safety_boundary: 'Gently discourage self-harm, illegal or risky topics, and suggest professional help.',
    },
  },
  {
    id: 2, name: 'Chloe', gender: 2, age: 25, city: 'Austin', height: 165, voice: 'Bright and lively',
    title: 'Freelance illustrator', brief: 'An upbeat chat buddy who loves spicy food and drawing', tags: ['Cheerful', 'Funny', 'Comforting'],
    chat_persona: 'A freelance illustrator in Austin who laughs easily and naturally shares the little joys of everyday life.',
    prompt_persona: {
      identity_base: 'You are Chloe, 25, a freelance illustrator in Austin. You love spicy food, cats and farmers markets.',
      daily_style: 'Upbeat tone with casual interjections; replies are usually one to three sentences.',
      relationship_base: 'Chat like a close friend; remember what the user tells you and bring it up later.',
      emotion_support: 'Empathize first, then encourage; help the user shift their mood in a light way.',
      reality_boundary: 'Never claim to be a real person; never ask for the user\'s private information.',
      safety_boundary: 'Do not engage in sexual, violent or illegal content; steer risky topics gently and suggest where to get help.',
    },
  },
]

const HEADINGS = {
  zh: ['# 身份', '# 说话风格', '# 关系定位', '# 情绪陪伴', '# 现实边界', '# 安全边界', '# 回复要求\n用中文口语回复，像微信聊天一样自然，一般不超过 60 字；不要输出动作描写或括号旁白。'],
  en: ['# Identity', '# Speaking style', '# Relationship', '# Emotional support', '# Reality boundaries', '# Safety boundaries', '# Reply rules\nReply in casual English, like a text message, usually under 40 words; no stage directions or bracketed narration.'],
}
const ROLES = { zh: ROLES_ZH, en: ROLES_EN }
for (const [lang, roles] of Object.entries(ROLES)) {
  const h = HEADINGS[lang]
  for (const r of roles) {
    const p = r.prompt_persona
    r.rendered_prompt = [
      `${h[0]}\n${p.identity_base}`,
      `${h[1]}\n${p.daily_style}`,
      `${h[2]}\n${p.relationship_base}`,
      `${h[3]}\n${p.emotion_support}`,
      `${h[4]}\n${p.reality_boundary}`,
      `${h[5]}\n${p.safety_boundary}`,
      h[6],
    ].join('\n\n')
  }
}

/** Accept-Language 以 en 开头时用英文角色，其余（含缺省）用中文 */
const langOf = (req) => (/^en/i.test(String(req.headers['accept-language'] ?? '').trim()) ? 'en' : 'zh')

let nextUid = 1000
/** token → { uid, roleId, lang, history: [{role, content}] } */
const sessions = new Map()

const ok = (data) => ({ code: 200, msg: 'ok', data })
const fail = (code, msg) => ({ code, msg })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 5_000_000) req.destroy() // 报告请求会带上对话样本，其余都是小请求
    })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
    })
  })
}

function send(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** 按 Unicode 字符切成小段，模拟流式输出 */
const chunks = (text) => text.match(/.{1,4}/gsu) ?? []
/** 模拟模型延迟：首字 300–900ms，之后每段 20–60ms */
const firstDelay = () => 300 + Math.floor(Math.random() * 600)
const nextDelay = () => 20 + Math.floor(Math.random() * 40)

/** 演示模型的 OpenAI 兼容接口（流式与非流式） */
async function demoCompletions(req, res, body) {
  const messages = Array.isArray(body.messages) ? body.messages.map((m) => ({ role: String(m?.role ?? ''), content: String(m?.content ?? '') })) : []
  const text = demoComplete(messages)
  const id = `demo-${Date.now()}`
  const created = Math.floor(Date.now() / 1000)
  const model = String(body.model ?? 'demo')
  await sleep(firstDelay())
  if (!body.stream) {
    return send(res, { id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] })
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const write = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
  for (const c of chunks(text)) { write({ content: c }); await sleep(nextDelay()) }
  write({}, 'stop')
  res.end('data: [DONE]\n\n')
}

/** 调 OpenAI 兼容接口的流式补全，逐段回调增量文字，返回完整回复 */
async function streamFromModel(messages, onDelta) {
  const body = { model: MODEL.model, messages, stream: true }
  if (!MODEL.provider.noTemperature) body.temperature = 0.8
  const resp = await fetch(`${MODEL.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(MODEL.apiKey ? { authorization: `Bearer ${MODEL.apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  })
  if (!resp.ok || !resp.body) {
    const detail = (await resp.text().catch(() => '')).slice(0, 200)
    const err = new Error(`模型接口返回 HTTP ${resp.status}${detail ? `：${detail}` : ''}`)
    err.status = resp.status
    throw err
  }
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''
  for await (const chunk of resp.body) {
    buf += decoder.decode(chunk, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return full
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content
        if (delta) { full += delta; onDelta(delta) }
      } catch { /* 忽略无法解析的行 */ }
    }
  }
  return full
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  const body = req.method === 'POST' ? await readBody(req) : {}

  if (path === '/v1/chat/completions' && req.method === 'POST') return demoCompletions(req, res, body)
  if (path === '/v1/models') return send(res, { object: 'list', data: [{ id: 'demo', object: 'model', owned_by: 'chat-arena' }] })

  if (path.startsWith('/debug/') && req.headers['x-debug-key'] !== DEBUG_KEY) {
    return send(res, fail(403, 'forbidden: X-Debug-Key 不正确'))
  }

  if (path === '/debug/token') {
    const roleId = body.ta_gender === 1 ? 1 : 2
    const uid = nextUid++
    const token = `mock-${roleId}-${uid}`
    sessions.set(token, { uid, roleId, lang: langOf(req), history: [] })
    return send(res, ok({ tokens: [{ token, uid, user_code: `U${uid}`, memory_id: uid, expires_at: 0 }] }))
  }
  if (path === '/debug/roles') return send(res, ok({ roles: ROLES[langOf(req)] }))

  if (path === '/chat') {
    const sess = sessions.get(req.headers.authorization ?? '')
    if (!sess) return send(res, fail(401, 'token 无效，请重新初始化会话'))
    const roles = ROLES[sess.lang]
    const role = roles.find((r) => r.id === sess.roleId) ?? roles[0]
    const text = String(body.content ?? '')
    const sessionId = `s_${sess.uid}`
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const frame = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`)
    const messageId = Date.now()

    if (MODEL) {
      const messages = [{ role: 'system', content: role.rendered_prompt }, ...sess.history, { role: 'user', content: text }]
      try {
        const reply = await streamFromModel(messages, (delta) => frame({ code: 200, data: { text: delta, session_id: sessionId, message_id: messageId } }))
        sess.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply })
        sess.history = sess.history.slice(-HISTORY_LIMIT)
        frame({ code: 200, type: 'done', data: {} })
      } catch (err) {
        const status = err?.status ?? 0
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[mock-backend] 模型调用失败：${message}`)
        // 限流、超时、5xx 可以重试；key 错误等 4xx 重试也没用
        const retryable = status === 0 || status === 429 || status >= 500
        frame({ code: retryable ? 502 : 400, type: 'done', data: { error_type: 'model_error', message, retryable } })
      }
      return res.end()
    }

    // 演示模型：按规则生成角色回复，同样保留对话历史（记忆考核依赖它）
    const reply = roleReply(role.rendered_prompt, sess.history, text)
    await sleep(firstDelay())
    for (const c of chunks(reply)) {
      frame({ code: 200, data: { text: c, session_id: sessionId, message_id: messageId } })
      await sleep(nextDelay())
    }
    sess.history.push({ role: 'user', content: text }, { role: 'assistant', content: reply })
    sess.history = sess.history.slice(-HISTORY_LIMIT)
    frame({ code: 200, type: 'done', data: {} })
    return res.end()
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(fail(404, `unknown path ${path}`)))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-backend] http://localhost:${PORT}  X-Debug-Key: ${DEBUG_KEY}`)
  console.log(MODEL
    ? `[mock-backend] 角色回复由模型 ${MODEL.id} 生成（会产生模型费用；MOCK_MODEL=off 改用演示模型）`
    : '[mock-backend] 角色回复由演示模型按规则生成（不调用任何真实模型）')
  console.log(`[mock-backend] 演示模型接口：http://localhost:${PORT}/v1（api/.env.dev 里设置 DEMO_MODELS=demo 即可在评测中选用）`)
})
