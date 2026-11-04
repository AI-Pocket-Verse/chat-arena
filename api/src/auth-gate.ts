import type { FastifyInstance } from 'fastify'

/** 启用登录后仍可匿名访问的路由（按注册时的路由模式匹配） */
const PUBLIC_ROUTES = new Set(['/api/ping', '/healthz', '/readyz'])

/**
 * 启用登录（authRequired）时注册 401 门禁：默认拒绝，只放行 PUBLIC_ROUTES。
 * 按 Fastify 实际匹配到的路由模式（req.routeOptions.url）判断，而不是原始 URL：
 * 原始 URL 未解码，`/%61pi/runs` 会被路由解码成 /api/runs，按前缀判断会被绕过。
 */
export function registerAuthGate(app: FastifyInstance, opts: { authRequired: boolean; allowedHosts?: string[] }): void {
  if (!opts.authRequired) {
    registerLocalHostGuard(app, opts.allowedHosts ?? [])
    return
  }
  app.addHook('onRequest', async (req, reply) => {
    const route = req.routeOptions.url
    if (route && PUBLIC_ROUTES.has(route)) return
    if (!req.user) {
      // 登录服务超时 / 5xx：不是「未登录」，返回可重试的 503，避免前端把用户踢去登录页
      if (req.authTransient) return reply.code(503).send({ error: 'auth_unavailable', message: '登录服务暂时不可用，请稍后重试' })
      return reply.code(401).send({ error: 'Unauthorized' })
    }
  })
}

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

function hostnameOf(hostOrUrl: string, isUrl: boolean): string | null {
  try {
    return new URL(isUrl ? hostOrUrl : `http://${hostOrUrl}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * 本地模式（不鉴权）的来源校验：Host 和 Origin（有时）的主机名都必须是本机或 ALLOWED_HOSTS 里的名字。
 * - 挡 DNS rebinding：恶意域名解析到 127.0.0.1 后，浏览器发来的 Host 是该域名；
 * - 挡跨站请求与 WebSocket 劫持：其他网站发起的请求带着它自己的 Origin；
 * - 未开登录却部署到公网域名时，不在名单里的域名一律拒绝，避免意外变成匿名可用的公网服务。
 * 用原始 Host 头而不是 req.host：后者在 trustProxy 下可被 X-Forwarded-Host 改写。
 */
function registerLocalHostGuard(app: FastifyInstance, extraHosts: string[]): void {
  const allowed = new Set([...LOOPBACK_HOSTS, ...extraHosts.map((h) => h.trim().toLowerCase()).filter(Boolean)])
  app.addHook('onRequest', async (req, reply) => {
    const host = hostnameOf(req.headers.host ?? '', false)
    const origin = req.headers.origin
    const originHost = origin === undefined ? undefined : hostnameOf(origin, true)
    if (host && allowed.has(host) && (originHost === undefined || (originHost && allowed.has(originHost)))) return
    return reply.code(403).send({
      error: 'host_not_allowed',
      message: '本地模式只接受来自本机的访问。通过其他域名或 IP 访问时，请把它加入 ALLOWED_HOSTS，或启用登录（WHOAMI_URL）',
    })
  })
}
