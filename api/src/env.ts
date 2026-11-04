import { z } from 'zod'

// TRUST_PROXY：true / false，或 proxy-addr 支持的 loopback / IP / 网段列表（逗号分隔）。
// 留空按默认 loopback。原样把 "true" 交给 Fastify 会被当成 IP 地址而不生效。
// 不支持跳数：Fastify 5.12 起因无法校验直连方、会被伪造 X-Forwarded-* 而禁用。
export function parseTrustProxy(v: string, ctx?: z.RefinementCtx): boolean | string {
  const s = v.trim() || 'loopback'
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true'
  if (/^\d+$/.test(s)) {
    ctx?.addIssue({ code: z.ZodIssueCode.custom, message: 'TRUST_PROXY 不支持跳数，请改写为反向代理的 IP / 网段，如 loopback 或 10.0.0.5' })
    return z.NEVER
  }
  return s
}

// 可选项留空（`X=`）当作未设置，否则 .env 里写了空值的可选 URL 会让校验失败。
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional())

/** TARGET_HEADERS：JSON 对象，值全为字符串；留空表示没有额外请求头。 */
const HeadersJson = z
  .string()
  .default('')
  .transform((s, ctx) => {
    if (!s.trim()) return {} as Record<string, string>
    try {
      const v = JSON.parse(s) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string')) {
        return v as Record<string, string>
      }
    } catch { /* fall through */ }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'TARGET_HEADERS 必须是值全为字符串的 JSON 对象' })
    return z.NEVER
  })

const Env = z.object({
  NODE_ENV:         z.enum(['development', 'production', 'test']).default('development'),
  PORT:             z.coerce.number().default(4040),
  // 持有付费模型 key，本地模式不鉴权，默认只监听本机
  HOST:             z.string().default('127.0.0.1'),
  DATABASE_URL:     z.string().min(1, 'DATABASE_URL is required'),

  // 被测对话后端（接口约定见 docs/target-protocol.md）。新建评测时页面上也可以改地址。
  TARGET_BASE_URL:  z.string().url().default('http://localhost:8680'),
  TARGET_DEBUG_KEY: z.string().default(''),
  TARGET_HEADERS:   HeadersJson,
  // 允许把 Debug Key / 额外请求头发往的被测后端 origin，逗号分隔；TARGET_BASE_URL 的 origin 始终允许。
  // 接收地址的接口（新建评测、角色库、连接测试）对名单外的地址一律拒绝，防止口令发给任意地址。
  TARGET_ALLOWED_ORIGINS: z.string().default(''),

  // 模型供应商的 <前缀>_API_KEY / _BASE_URL / _MODELS 由 model-client 的 buildModelRegistry 直接读 process.env。
  // 默认模型（<供应商>:<模型名>）：新建评测页的预选项、人设库 AI 生成与反推、命令行冒烟脚本都用它。
  // 留空取第一个配好的模型。
  DEFAULT_MODEL:    z.string().default(''),

  // 设置后启用飞书登录（feishu-sso 的 whoami 地址）；不设置为本地单用户模式
  WHOAMI_URL:       optional(z.string().url()),
  // 启用登录后的管理员手机号（逗号分隔），可删除评测报告等；本地模式下本地用户即管理员
  ADMIN_MOBILES:    z.string().default(''),
  // 本地模式（未设置 WHOAMI_URL）只接受 Host / Origin 为本机的请求；通过其他域名或 IP 访问时加在这里，逗号分隔
  ALLOWED_HOSTS:    z.string().default(''),
  CORS_ORIGINS:     z.string().default(''),
  // 信任的反向代理：loopback（默认，只信本机 nginx）/ 逗号分隔的 IP·网段 / true / false。
  // 影响 req.ip，限流按它区分客户端。
  TRUST_PROXY:      z.string().default('loopback').transform((v, ctx) => parseTrustProxy(v, ctx)),
})

export const env = Env.parse(process.env)
export type Env = z.infer<typeof Env>
