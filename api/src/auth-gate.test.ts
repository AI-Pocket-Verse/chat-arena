import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { registerAuthGate } from './auth-gate'

function buildApp(opts: { authRequired: boolean; setUser?: boolean }) {
  const app = Fastify()

  // Fake auth plugin: if the request carries x-test-user header, decorate req.user
  app.addHook('onRequest', async (req) => {
    if (req.headers['x-test-user']) {
      // @ts-expect-error — test-only decoration without declaring the type
      req.user = { id: req.headers['x-test-user'] }
    }
  })

  registerAuthGate(app, { authRequired: opts.authRequired })

  // Dummy routes
  app.get('/api/runs', async () => ({ ok: true }))
  app.get('/api/ping', async () => ({ message: 'pong' }))
  app.get('/healthz', async () => ({ status: 'ok' }))
  app.get('/readyz', async () => ({ status: 'ok' }))
  app.get('/ws/test', async () => ({ ok: true }))

  return app
}

describe('registerAuthGate', () => {
  it('authRequired=true, no user → GET /api/runs returns 401', async () => {
    const app = buildApp({ authRequired: true })
    const r = await app.inject({ method: 'GET', url: '/api/runs' })
    expect(r.statusCode).toBe(401)
    expect(r.json().error).toBe('Unauthorized')
    await app.close()
  })

  it('authRequired=true, with x-test-user → /api/runs passes (non-401)', async () => {
    const app = buildApp({ authRequired: true })
    const r = await app.inject({ method: 'GET', url: '/api/runs', headers: { 'x-test-user': 'user-1' } })
    expect(r.statusCode).not.toBe(401)
    await app.close()
  })

  it('authRequired=true, no user → /api/ping is exempt (non-401)', async () => {
    const app = buildApp({ authRequired: true })
    const r = await app.inject({ method: 'GET', url: '/api/ping' })
    expect(r.statusCode).not.toBe(401)
    await app.close()
  })

  it('authRequired=true, no user → /healthz is exempt (non-401)', async () => {
    const app = buildApp({ authRequired: true })
    const r = await app.inject({ method: 'GET', url: '/healthz' })
    expect(r.statusCode).not.toBe(401)
    await app.close()
  })

  it('authRequired=true, no user → /readyz is exempt (non-401)', async () => {
    const app = buildApp({ authRequired: true })
    const r = await app.inject({ method: 'GET', url: '/readyz' })
    expect(r.statusCode).not.toBe(401)
    await app.close()
  })

  it('authRequired=true, no user → /ws/test returns 401', async () => {
    const app = buildApp({ authRequired: true })
    const r = await app.inject({ method: 'GET', url: '/ws/test' })
    expect(r.statusCode).toBe(401)
    await app.close()
  })

  it('percent-encoded paths cannot bypass the gate (/%61pi/runs, /%77s/test)', async () => {
    const app = buildApp({ authRequired: true })
    for (const url of ['/%61pi/runs', '/%77s/test', '/api/%72uns', '/api//runs']) {
      const r = await app.inject({ method: 'GET', url })
      expect(r.statusCode, url).toBe(401)
    }
    await app.close()
  })

  it('any unauthenticated route that is not explicitly public is rejected (default deny)', async () => {
    const app = buildApp({ authRequired: true })
    app.get('/other', async () => ({ ok: true }))
    const r = await app.inject({ method: 'GET', url: '/other' })
    expect(r.statusCode).toBe(401)
    await app.close()
  })

  it('authRequired=false → /api/runs passes even without user (gate not active)', async () => {
    const app = buildApp({ authRequired: false })
    const r = await app.inject({ method: 'GET', url: '/api/runs' })
    expect(r.statusCode).not.toBe(401)
    await app.close()
  })

  it('登录服务暂时不可用（authTransient）→ 503 auth_unavailable，而不是 401', async () => {
    const app = Fastify()
    app.addHook('onRequest', async (req) => { req.authTransient = true })
    registerAuthGate(app, { authRequired: true })
    app.get('/api/runs', async () => ({ ok: true }))
    const r = await app.inject({ method: 'GET', url: '/api/runs' })
    expect(r.statusCode).toBe(503)
    expect(r.json()).toMatchObject({ error: 'auth_unavailable' })
    await app.close()
  })

  describe('local mode host guard (authRequired=false)', () => {
    it('allows localhost / 127.0.0.1 hosts and same-machine origins', async () => {
      const app = buildApp({ authRequired: false })
      for (const headers of [{ host: 'localhost:4040' }, { host: '127.0.0.1:4040', origin: 'http://localhost:5040' }, { host: '[::1]:4040' }]) {
        const r = await app.inject({ method: 'GET', url: '/api/runs', headers })
        expect(r.statusCode, JSON.stringify(headers)).toBe(200)
      }
      await app.close()
    })

    it('rejects DNS-rebinding hosts and cross-site origins with 403 host_not_allowed', async () => {
      const app = buildApp({ authRequired: false })
      for (const headers of [{ host: 'evil.example.com:4040' }, { host: 'localhost:4040', origin: 'https://evil.example.com' }, { host: 'localhost:4040', origin: 'null' }]) {
        const r = await app.inject({ method: 'GET', url: '/ws/test', headers })
        expect(r.statusCode, JSON.stringify(headers)).toBe(403)
        expect(r.json().error).toBe('host_not_allowed')
      }
      await app.close()
    })

    it('ignores X-Forwarded-Host and honours ALLOWED_HOSTS', async () => {
      const app = Fastify({ trustProxy: true })
      registerAuthGate(app, { authRequired: false, allowedHosts: ['arena.example.com'] })
      app.get('/api/runs', async () => ({ ok: true }))
      expect((await app.inject({ method: 'GET', url: '/api/runs', headers: { host: 'evil.example.com', 'x-forwarded-host': 'localhost' } })).statusCode).toBe(403)
      expect((await app.inject({ method: 'GET', url: '/api/runs', headers: { host: 'arena.example.com', origin: 'https://arena.example.com' } })).statusCode).toBe(200)
      await app.close()
    })
  })
})
