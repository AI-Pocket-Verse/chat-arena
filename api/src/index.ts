import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import fastifyWebsocket from '@fastify/websocket'
import Fastify from 'fastify'
import apiKit from '@chat-arena/api-kit'
import { initDb, prisma } from './db'
import { env } from './env'
import { runsRoutes } from './routes/runs'
import { personasRoutes } from './routes/personas'
import { wsRoutes } from './routes/ws'
import { makeStartRun } from './store/wiring'
import authPlugin from '@chat-arena/auth-client-api'
import { buildModelRegistry, createModelClient, defaultModelId, modelConfigError } from './clients/model-client'
import { registerAuthGate } from './auth-gate'

// logger 需开启，否则 req.log.* 全是空操作；只输出 warn 及以上，避免逐请求刷屏
const app = Fastify({ logger: { level: 'warn' }, trustProxy: env.TRUST_PROXY })

await initDb()

// Reconcile runs/sessions left in-flight by a previous process crash
const orphanedRuns = await prisma.run.updateMany({
  where: { status: { in: ['pending', 'running'] } },
  data: { status: 'failed', finishedAt: new Date() },
})
const orphanedSessions = await prisma.session.updateMany({
  where: { status: 'running' },
  data: { status: 'failed', endReason: 'interrupted', finishedAt: new Date() },
})
if (orphanedRuns.count || orphanedSessions.count) {
  console.log(`[chat-arena] reconciled ${orphanedRuns.count} orphaned runs, ${orphanedSessions.count} sessions`)
}

const corsOrigins = env.CORS_ORIGINS.split(/\s+/).filter(Boolean)
await app.register(cors, { origin: corsOrigins.length > 0 ? corsOrigins : false, credentials: true })
// exempt /ws/* from rate limiting (WS upgrades + reconnects can burst);
// raise global max to 600 to support multi-run dashboard polling.
await app.register(rateLimit, {
  max: 600,
  timeWindow: '1 minute',
  allowList: (req) => req.url.startsWith('/ws/'),
  // 按 req.ip 计数（trustProxy 生效后是真实客户端 IP，而不是反代地址）
  keyGenerator: (req) => req.ip,
})
await app.register(apiKit, { service: 'chat-arena', version: '1.0.0' })

// 登录可选：未配置 WHOAMI_URL 时是本地单用户模式，所有请求的用户都是 LOCAL_USER。
const authRequired = !!env.WHOAMI_URL
await app.register(authPlugin, { whoamiUrl: env.WHOAMI_URL })
registerAuthGate(app, { authRequired, allowedHosts: env.ALLOWED_HOSTS.split(',').map((s) => s.trim()).filter(Boolean) })

// 客户端只发 {type:'watch',sessionId} 这类小消息
await app.register(fastifyWebsocket, { options: { maxPayload: 4096 } })
const modelRegistry = buildModelRegistry(process.env)
// 每次调用时现算：DEFAULT_MODEL 不可用时退回第一个配好的模型
const defaultModel = () => defaultModelId(modelRegistry, env.DEFAULT_MODEL)
const modelClient = createModelClient(modelRegistry)
await app.register(runsRoutes, {
  prisma, startRun: makeStartRun(prisma), modelClient, modelRegistry,
  targetDebugKey: env.TARGET_DEBUG_KEY, targetBaseUrl: env.TARGET_BASE_URL, targetHeaders: env.TARGET_HEADERS,
  targetAllowedOrigins: env.TARGET_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  defaultModel,
  adminMobiles: env.ADMIN_MOBILES.split(',').map((s) => s.trim()).filter(Boolean),
  authRequired,
})
await app.register(personasRoutes, { prisma, modelClient, defaultModel })
await app.register(wsRoutes)

app.get('/api/ping', async () => ({ message: 'chat-arena alive' }))

const shutdown = async () => {
  console.log('[chat-arena] shutting down')
  await app.close()
  await prisma.$disconnect()
  process.exit(0)
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

app
  .listen({ port: env.PORT, host: env.HOST })
  .then(() => {
    console.log(`[chat-arena] listening on http://${env.HOST}:${env.PORT}`)
    console.log(`[chat-arena] auth: ${authRequired ? 'feishu-sso (WHOAMI_URL set)' : `local single-user mode, accepts hosts: localhost${env.ALLOWED_HOSTS ? `, ${env.ALLOWED_HOSTS}` : ''}`}`)
    for (const id of Object.keys(modelRegistry)) {
      const bad = modelConfigError(modelRegistry, id)
      if (bad) console.log(`[chat-arena] model ${id} not ready: ${bad.message}`)
    }
    const ready = Object.keys(modelRegistry).filter((id) => !modelConfigError(modelRegistry, id))
    console.log(`[chat-arena] models ready: ${ready.length ? ready.join(', ') : 'none (list models in <PROVIDER>_MODELS and set the key in api/.env.dev, see README)'}`)
    console.log(`[chat-arena] default model: ${defaultModel() ?? 'none'}`)
    console.log(`[chat-arena] default target: ${env.TARGET_BASE_URL}`)
  })
  .catch(err => { console.error(err); process.exit(1) })
