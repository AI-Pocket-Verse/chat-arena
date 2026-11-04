import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '../../generated/prisma'
import { buildModelRegistry } from '../clients/model-client'
import { runsRoutes } from './runs'

let prisma: PrismaClient
const dir = mkdtempSync(join(tmpdir(), 'chat-arena-routes-'))
const dbUrl = `file:${join(dir, 'test.db')}`
const apiDir = new URL('../../', import.meta.url).pathname

beforeAll(() => {
  execFileSync(process.execPath,
    ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    { cwd: apiDir, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'ignore' })
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })
})
afterAll(async () => { await prisma.$disconnect(); rmSync(dir, { recursive: true, force: true }) })

describe('runsRoutes', () => {
  it('POST /api/runs → 400 when no personas match', async () => {
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const r = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['nonexistent'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 1 },
    })
    expect(r.statusCode).toBe(400)
    await app.close()
  })

  it('POST /api/runs stores the UI language from X-Lang (default zh)', async () => {
    await prisma.persona.upsert({ where: { id: 'p-lang' }, create: { id: 'p-lang', name: 'lang', category: 'normal', structuredJson: '{}', systemPrompt: 'x', createdAt: new Date(), updatedAt: new Date() }, update: {} })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const payload = { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-lang'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'qwen:qwen-max', endCondition: { maxTurns: 1 }, concurrency: 1, repetitions: 1 }
    const en = await app.inject({ method: 'POST', url: '/api/runs', headers: { 'x-lang': 'en' }, payload })
    const zh = await app.inject({ method: 'POST', url: '/api/runs', payload })
    expect((await prisma.run.findUniqueOrThrow({ where: { id: en.json().runId } })).lang).toBe('en')
    expect((await prisma.run.findUniqueOrThrow({ where: { id: zh.json().runId } })).lang).toBe('zh')
    await app.close()
  })

  it('GET /api/models lists registered models with readiness, never keys or URLs', async () => {
    const modelRegistry = buildModelRegistry({ QWEN_API_KEY: 'secret-key', QWEN_MODELS: 'qwen-max', DEEPSEEK_MODELS: 'deepseek-chat' })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, modelRegistry, defaultModel: () => 'qwen:qwen-max', startRun: async () => {} })
    const r = await app.inject({ method: 'GET', url: '/api/models' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({
      defaultModel: 'qwen:qwen-max',
      models: [
        { id: 'qwen:qwen-max', label: '千问 · qwen-max', ready: true },
        { id: 'deepseek:deepseek-chat', ready: false },
      ],
    })
    expect(r.body).not.toContain('secret-key')
    expect(r.body).not.toContain('dashscope')
    // 英文界面：供应商名用英文
    const en = await app.inject({ method: 'GET', url: '/api/models', headers: { 'x-lang': 'en' } })
    expect(en.json().models[0]).toMatchObject({ label: 'Qwen · qwen-max' })
    await app.close()
  })

  it('POST /api/runs → 503 model_key_missing (naming the env var) before creating a run', async () => {
    await prisma.persona.create({ data: { id: 'p-key', name: '缺 key 人设', category: 'normal', structuredJson: '{}', systemPrompt: 'test', createdAt: new Date(), updatedAt: new Date() } })
    const modelRegistry = buildModelRegistry({
      QWEN_API_KEY: 'qwen-key', QWEN_MODELS: 'qwen-max',
      DEEPSEEK_API_KEY: '', DEEPSEEK_MODELS: 'deepseek-chat',
    })
    let started = 0
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, modelRegistry, startRun: async () => { started++ } })
    const before = await prisma.run.count()
    const r = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-key'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 1 },
    })
    expect(r.statusCode).toBe(503)
    expect(r.json()).toMatchObject({ error: 'model_key_missing' })
    expect(r.json().message).toContain('DEEPSEEK_API_KEY')
    expect(await prisma.run.count()).toBe(before)
    expect(started).toBe(0)
    await app.close()
  })

  it('POST /api/runs → 200 + runId, GET reads run, GET turns returns sessions', async () => {
    // seed a persona first
    await prisma.persona.create({ data: { id: 'p-test', name: '测试人设', category: 'normal', structuredJson: '{}', systemPrompt: 'test', createdAt: new Date(), updatedAt: new Date() } })

    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })

    const create = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-test'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 1 },
    })
    expect(create.statusCode).toBe(200)
    const { runId } = create.json() as { runId: string }
    expect(runId).toBeTruthy()

    const get = await app.inject({ method: 'GET', url: `/api/runs/${runId}` })
    expect(get.statusCode).toBe(200)
    expect(get.json().run.status).toBe('pending')

    const turns = await app.inject({ method: 'GET', url: `/api/runs/${runId}/turns` })
    expect(turns.statusCode).toBe(200)
    expect(Array.isArray(turns.json().sessions)).toBe(true)

    await app.close()
  })

  it('GET /api/runs/:id/violations returns empty for run with no turns', async () => {
    await prisma.persona.upsert({ where: { id: 'p-viol' }, create: { id: 'p-viol', name: 'rt', category: 'redteam', structuredJson: '{}', systemPrompt: 'x', createdAt: new Date(), updatedAt: new Date() }, update: {} })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const create = await app.inject({ method: 'POST', url: '/api/runs', payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-viol'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 1 }, concurrency: 1, repetitions: 1 } })
    const { runId } = create.json() as { runId: string }
    const viols = await app.inject({ method: 'GET', url: `/api/runs/${runId}/violations` })
    expect(viols.statusCode).toBe(200)
    expect(viols.json().count).toBe(0)
    await app.close()
  })

  it('GET /api/runs/:id/metrics returns aggregate (zero turns → null avgOverall)', async () => {
    // reuse the run from previous test (runId still valid, no turns inserted)
    // Just check it returns a valid aggregate shape with turnCount=0
    const app2 = Fastify()
    await app2.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const create2 = await app2.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-test'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 1 }, concurrency: 1, repetitions: 1 },
    })
    const { runId: rid } = create2.json() as { runId: string }
    const metrics = await app2.inject({ method: 'GET', url: `/api/runs/${rid}/metrics` })
    expect(metrics.statusCode).toBe(200)
    expect(metrics.json().turnCount).toBe(0)
    expect(metrics.json().avgOverall).toBeNull()
    await app2.close()
  })

  it('POST /api/runs with replayFromRunId pointing to run with different repetitions → 400', async () => {
    // seed persona and source run with repetitions=2
    await prisma.persona.upsert({ where: { id: 'p-replay' }, create: { id: 'p-replay', name: '回放人设', category: 'normal', structuredJson: '{}', systemPrompt: 'x', createdAt: new Date(), updatedAt: new Date() }, update: {} })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })

    // create source run with repetitions=2
    const sourceResp = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-replay'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 2 },
    })
    expect(sourceResp.statusCode).toBe(200)
    const { runId: sourceRunId } = sourceResp.json() as { runId: string }

    // attempt replay with repetitions=3 (mismatch)
    const replayResp = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-replay'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 3, replayFromRunId: sourceRunId },
    })
    expect(replayResp.statusCode).toBe(400)
    expect(replayResp.json().error).toMatch(/matching persona set and repetitions/)
    await app.close()
  })

  it('POST /api/runs with replayFromRunId pointing to nonexistent run → 400', async () => {
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const r = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-replay'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 1, replayFromRunId: 'nonexistent-run-id' },
    })
    expect(r.statusCode).toBe(400)
    expect(r.json().error).toMatch(/replay source run not found/)
    await app.close()
  })

  it('POST /api/runs/:id/stop on existing run → 200 {ok:true}', async () => {
    await prisma.persona.upsert({ where: { id: 'p-stop' }, create: { id: 'p-stop', name: 'stop', category: 'normal', structuredJson: '{}', systemPrompt: 'x', createdAt: new Date(), updatedAt: new Date() }, update: {} })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const create = await app.inject({ method: 'POST', url: '/api/runs', payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-stop'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 1 }, concurrency: 1, repetitions: 1 } })
    const { runId } = create.json() as { runId: string }
    const stop = await app.inject({ method: 'POST', url: `/api/runs/${runId}/stop` })
    expect(stop.statusCode).toBe(200)
    expect(stop.json().ok).toBe(true)
    await app.close()
  })

  it('POST /api/runs/:id/stop on nonexistent run → 404', async () => {
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const stop = await app.inject({ method: 'POST', url: '/api/runs/nonexistent-run-id/stop' })
    expect(stop.statusCode).toBe(404)
    await app.close()
  })

  it('POST /api/runs with replayFromRunId whose session has null repetitionIndex → 400', async () => {
    await prisma.persona.upsert({ where: { id: 'p-replay-null' }, create: { id: 'p-replay-null', name: '回放空索引', category: 'normal', structuredJson: '{}', systemPrompt: 'x', createdAt: new Date(), updatedAt: new Date() }, update: {} })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })

    // create source run
    const sourceResp = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-replay-null'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 1 },
    })
    expect(sourceResp.statusCode).toBe(200)
    const { runId: sourceRunId } = sourceResp.json() as { runId: string }

    // manually insert a session with repetitionIndex: null (legacy row)
    await prisma.session.create({
      data: {
        id: 'sess-legacy-null',
        runId: sourceRunId,
        personaId: 'p-replay-null',
        repetitionIndex: null,
        status: 'done',
        createdAt: new Date(),
      },
    })

    // attempt replay
    const replayResp = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-replay-null'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 1, replayFromRunId: sourceRunId },
    })
    expect(replayResp.statusCode).toBe(400)
    expect(replayResp.json().error).toMatch(/legacy sessions without repetition index/)
    await app.close()
  })

  it('GET /api/roles → 502 when target is unreachable', async () => {
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://127.0.0.1:1', prisma, startRun: async () => {}, targetDebugKey: 'test-key' })
    const r = await app.inject({ method: 'GET', url: '/api/roles?targetBaseUrl=http://127.0.0.1:1' })
    expect(r.statusCode).toBe(502)
    expect(r.json().error).toBe('target_request_failed')
    expect(r.json().message).toMatch(/failed to fetch roles from target/)
    await app.close()
  })

  it('GET /api/roles → 400 when no targetBaseUrl provided', async () => {
    const app = Fastify()
    await app.register(runsRoutes, { prisma, startRun: async () => {}, targetDebugKey: 'test-key' })
    const r = await app.inject({ method: 'GET', url: '/api/roles' })
    expect(r.statusCode).toBe(400)
    expect(r.json().error).toMatch(/targetBaseUrl/)
    await app.close()
  })

  it('GET /api/compare returns 400 without both run IDs', async () => {
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const r = await app.inject({ method: 'GET', url: '/api/compare?a=nonexistent' })
    expect(r.statusCode).toBe(400)
    await app.close()
  })

  it('POST /api/runs/:id/report generates a report, GET retrieves it', async () => {
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    // create run first
    await prisma.persona.upsert({ where: { id: 'p-rep' }, create: { id: 'p-rep', name: 'report', category: 'normal', structuredJson: '{}', systemPrompt: 'x', createdAt: new Date(), updatedAt: new Date() }, update: {} })
    const c = await app.inject({ method: 'POST', url: '/api/runs', payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-rep'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 1 }, concurrency: 1, repetitions: 1 } })
    const { runId } = c.json() as { runId: string }

    const gen = await app.inject({ method: 'POST', url: `/api/runs/${runId}/report` })
    expect(gen.statusCode).toBe(200)
    expect(gen.json().reportId).toBeTruthy()

    const get = await app.inject({ method: 'GET', url: `/api/runs/${runId}/report` })
    expect(get.statusCode).toBe(200)
    expect(get.json().report.markdown).toContain(runId)

    // 历史报告列表包含这份报告，并附带 run 信息；按 reportId 可单独取回
    const list = await app.inject({ method: 'GET', url: '/api/reports' })
    expect(list.statusCode).toBe(200)
    const reports = (list.json() as { reports: Array<{ id: string; runId: string; runName: string | null }> }).reports
    const mine = reports.find((r) => r.runId === runId)
    expect(mine).toBeTruthy()
    expect(mine!.id).toBe(gen.json().reportId)

    const byId = await app.inject({ method: 'GET', url: `/api/reports/${mine!.id}` })
    expect(byId.statusCode).toBe(200)
    expect(byId.json().report.markdown).toContain(runId)

    const missing = await app.inject({ method: 'GET', url: '/api/reports/does-not-exist' })
    expect(missing.statusCode).toBe(404)

    await app.close()
  })

  it('归档人设不可用于新评测 → 400（非回放路径）', async () => {
    // 创建一个已归档的人设
    await prisma.persona.upsert({
      where: { id: 'p-archived' },
      create: { id: 'p-archived', name: '归档人设', category: 'normal', structuredJson: '{}', systemPrompt: 'x', archivedAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
      update: { archivedAt: new Date() },
    })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const r = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-archived'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 1 },
    })
    expect(r.statusCode).toBe(400)
    expect(r.json()).toMatchObject({ error: 'persona_archived' })
    expect(r.json().message).toMatch(/归档/)
    // X-Lang: en → 英文提示
    const en = await app.inject({
      method: 'POST', url: '/api/runs', headers: { 'x-lang': 'en' },
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-archived'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 1 },
    })
    expect(en.json().message).toMatch(/archived/)
    await app.close()
  })

  it('回放路径（replayFromRunId）引用归档人设不被拦截（校验止步于 persona 存在性）', async () => {
    // 确保归档人设存在（上一条已创建）
    await prisma.persona.upsert({
      where: { id: 'p-archived' },
      create: { id: 'p-archived', name: '归档人设', category: 'normal', structuredJson: '{}', systemPrompt: 'x', archivedAt: new Date(), createdAt: new Date(), updatedAt: new Date() },
      update: { archivedAt: new Date() },
    })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })

    // 先建一个源 run（用已归档人设；直接写库绕过 API 校验）
    const sourceRunId = 'run-archived-src'
    await prisma.run.upsert({
      where: { id: sourceRunId },
      create: {
        id: sourceRunId, targetBaseUrl: 'http://localhost:8680', taGender: 2,
        personaSetJson: JSON.stringify(['p-archived']), userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat',
        endConditionJson: JSON.stringify({ maxTurns: 2 }), concurrency: 1, repetitions: 1,
        status: 'finished', createdAt: new Date(),
      },
      update: {},
    })

    // 回放路径：replayFromRunId 存在且人设/repetitions 匹配 → 归档校验不拦截
    // 最终会因 sourceSessions 无 repetitionIndex（无 session 行）之外的原因通过或被其他校验拦截，
    // 但关键断言是：响应错误中不含「归档」字样（归档校验已放行）。
    const r = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-archived'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 1, replayFromRunId: sourceRunId },
    })
    // 归档校验放行后，因源 run 没有 session 行（sourceSessions 为空），
    // sourceSessions.some(s => s.repetitionIndex === null) → false，
    // 所以整个 replay 校验通过，最终创建 run 成功（200）。
    expect(r.statusCode).toBe(200)
    expect(r.json().runId).toBeTruthy()
    await app.close()
  })

  // replay taGender mismatch → 400
  it('POST /api/runs with replayFromRunId whose taGender differs → 400', async () => {
    await prisma.persona.upsert({ where: { id: 'p-gender' }, create: { id: 'p-gender', name: '性别回放', category: 'normal', structuredJson: '{}', systemPrompt: 'x', createdAt: new Date(), updatedAt: new Date() }, update: {} })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })

    // create source run with taGender=2
    const src = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-gender'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 1 },
    })
    expect(src.statusCode).toBe(200)
    const { runId: srcId } = src.json() as { runId: string }

    // attempt replay with taGender=1 (mismatch)
    const r = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-gender'], taGender: 1, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 2 }, concurrency: 1, repetitions: 1, replayFromRunId: srcId },
    })
    expect(r.statusCode).toBe(400)
    expect(r.json().error).toMatch(/taGender/)
    await app.close()
  })

  // warnings field in POST /api/runs response
  it('POST /api/runs returns warnings:[] when no probe issues', async () => {
    await prisma.persona.upsert({ where: { id: 'p-warn-ok' }, create: { id: 'p-warn-ok', name: '无告警', category: 'normal', structuredJson: '{}', systemPrompt: 'x', createdAt: new Date(), updatedAt: new Date() }, update: {} })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const r = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-warn-ok'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 10 }, concurrency: 1, repetitions: 1 },
    })
    expect(r.statusCode).toBe(200)
    expect(Array.isArray(r.json().warnings)).toBe(true)
    expect(r.json().warnings).toHaveLength(0)
    await app.close()
  })

  it('probe warns when probeAtTurn > maxTurns', async () => {
    const probes = JSON.stringify([{ factKey: 'city', probeAtTurn: 15, question: '你还记得我说的城市吗' }])
    const facts  = JSON.stringify([{ key: 'city', value: '苏州', injectAtTurn: 2 }])
    await prisma.persona.upsert({
      where: { id: 'p-warn-exceed' },
      create: { id: 'p-warn-exceed', name: '超限探针', category: 'normal', structuredJson: '{}', systemPrompt: 'x', recallProbesJson: probes, injectedFactsJson: facts, createdAt: new Date(), updatedAt: new Date() },
      update: { recallProbesJson: probes, injectedFactsJson: facts },
    })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const r = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-warn-exceed'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 10 }, concurrency: 1, repetitions: 1 },
    })
    expect(r.statusCode).toBe(200)
    const { warnings } = r.json() as { warnings: string[] }
    expect(warnings.some(w => w.includes('probeAtTurn=15') && w.includes('maxTurns=10'))).toBe(true)
    await app.close()
  })

  it('probe warns when no maxTurns set', async () => {
    const probes = JSON.stringify([{ factKey: 'pet', probeAtTurn: 5, question: '你记得我的宠物吗' }])
    await prisma.persona.upsert({
      where: { id: 'p-warn-nolimit' },
      create: { id: 'p-warn-nolimit', name: '无上限探针', category: 'normal', structuredJson: '{}', systemPrompt: 'x', recallProbesJson: probes, createdAt: new Date(), updatedAt: new Date() },
      update: { recallProbesJson: probes },
    })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const r = await app.inject({
      method: 'POST', url: '/api/runs',
      // endCondition without maxTurns → no upper bound
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-warn-nolimit'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: {}, concurrency: 1, repetitions: 1 },
    })
    expect(r.statusCode).toBe(200)
    const { warnings } = r.json() as { warnings: string[] }
    expect(warnings.some(w => w.includes('no maxTurns set'))).toBe(true)
    await app.close()
  })

  it('probe warns when probeAtTurn <= injectAtTurn (order reversed)', async () => {
    const probes = JSON.stringify([{ factKey: 'hometown', probeAtTurn: 3, question: '你记得我老家吗' }])
    const facts  = JSON.stringify([{ key: 'hometown', value: '苏州', injectAtTurn: 5 }])
    await prisma.persona.upsert({
      where: { id: 'p-warn-order' },
      create: { id: 'p-warn-order', name: '顺序颠倒', category: 'normal', structuredJson: '{}', systemPrompt: 'x', recallProbesJson: probes, injectedFactsJson: facts, createdAt: new Date(), updatedAt: new Date() },
      update: { recallProbesJson: probes, injectedFactsJson: facts },
    })
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {} })
    const r = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-warn-order'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 20 }, concurrency: 1, repetitions: 1 },
    })
    expect(r.statusCode).toBe(200)
    const { warnings } = r.json() as { warnings: string[] }
    expect(warnings.some(w => w.includes('probe before injection') && w.includes('hometown'))).toBe(true)
    await app.close()
  })

  it('POST /api/runs/:id/report uses modelClient.chatJson for LLM synthesis path', async () => {
    // Track chatJson calls
    let chatJsonCalledWith: string | undefined
    const mockModelClient = {
      chatJson: async (model: string) => {
        chatJsonCalledWith = model
        return { promptChanges: 'PC', memoryIssues: 'MI', safetyIssues: 'SI' }
      },
    }

    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {}, modelClient: mockModelClient as never })

    // seed persona + create run
    await prisma.persona.upsert({ where: { id: 'p-llm-rep' }, create: { id: 'p-llm-rep', name: 'llm-report', category: 'normal', structuredJson: '{}', systemPrompt: 'x', createdAt: new Date(), updatedAt: new Date() }, update: {} })
    const c = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: 'http://localhost:8680', personaIds: ['p-llm-rep'], taGender: 2, userModel: 'qwen:qwen-max', judgeModel: 'deepseek:deepseek-chat', endCondition: { maxTurns: 1 }, concurrency: 1, repetitions: 1 },
    })
    expect(c.statusCode).toBe(200)
    const { runId } = c.json() as { runId: string }

    // insert a session + turn + score so there is real content for the report
    const sessionId = 'sess-llm-rep-1'
    const turnId = 'turn-llm-rep-1'
    await prisma.session.create({
      data: { id: sessionId, runId, personaId: 'p-llm-rep', repetitionIndex: 0, status: 'done', createdAt: new Date() },
    })
    await prisma.turn.create({
      data: { id: turnId, sessionId, idx: 0, userText: 'hello', targetText: 'hi', createdAt: new Date() },
    })
    await prisma.turnScore.create({
      data: {
        turnId,
        dimsJson: JSON.stringify({ fluency: 4, safety: 5 }),
        overall: 4.5,
        comment: 'good',
        improvementSuggestion: '调整语气',
        violation: false,
        memoryHit: true,
      },
    })

    // generate report with LLM synthesis
    const gen = await app.inject({ method: 'POST', url: `/api/runs/${runId}/report` })
    expect(gen.statusCode).toBe(200)
    expect(gen.json().reportId).toBeTruthy()

    // verify chatJson was called with the run's judgeModel
    expect(chatJsonCalledWith).toBe('deepseek:deepseek-chat')

    // GET the report and verify synthesized content is present
    const get = await app.inject({ method: 'GET', url: `/api/runs/${runId}/report` })
    expect(get.statusCode).toBe(200)
    const markdown = get.json().report.markdown as string
    expect(markdown).toContain('PC')
    expect(markdown).toContain('MI')
    expect(markdown).toContain('SI')

    await app.close()
  })
})

describe('report deletion (admin only)', () => {
  const ADMIN = '13800138000'
  const mkReport = (id: string) =>
    prisma.report.create({ data: { id, runId: `run-of-${id}`, markdown: 'm', json: '{}', createdAt: new Date() } })
  // 注入假登录用户（auth-client-api 在真实环境装饰 req.user；测试里用 hook 模拟）
  const withUser = (app: import('fastify').FastifyInstance, mobile: string | null) => {
    app.addHook('onRequest', async (req) => {
      ;(req as unknown as { user?: { mobile: string | null } }).user = { mobile }
    })
  }

  it('GET /api/me: 本地模式(未开启登录)恒为管理员', async () => {
    const app = Fastify()
    await app.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {}, authRequired: false, adminMobiles: [ADMIN] })
    expect((await app.inject({ method: 'GET', url: '/api/me' })).json()).toMatchObject({ isAdmin: true })
    await app.close()
  })

  it('GET /api/me: 开启登录后按手机号命中判定（容忍 +86 前缀/分隔符）', async () => {
    const appAdmin = Fastify()
    withUser(appAdmin, '+86 138-0013-8000')
    await appAdmin.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {}, authRequired: true, adminMobiles: [ADMIN] })
    expect((await appAdmin.inject({ method: 'GET', url: '/api/me' })).json()).toMatchObject({ isAdmin: true })
    await appAdmin.close()

    const appOther = Fastify()
    withUser(appOther, '13800000000')
    await appOther.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {}, authRequired: true, adminMobiles: [ADMIN] })
    expect((await appOther.inject({ method: 'GET', url: '/api/me' })).json()).toMatchObject({ isAdmin: false })
    await appOther.close()
  })

  it('DELETE /api/reports/:id: 非管理员 403,管理员可删,重复删 404', async () => {
    await mkReport('rep-del-1')

    // 非管理员（无手机号）→ 403,报告仍在
    const appNoAdmin = Fastify()
    withUser(appNoAdmin, null)
    await appNoAdmin.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {}, authRequired: true, adminMobiles: [ADMIN] })
    expect((await appNoAdmin.inject({ method: 'DELETE', url: '/api/reports/rep-del-1' })).statusCode).toBe(403)
    expect(await prisma.report.findUnique({ where: { id: 'rep-del-1' } })).not.toBeNull()
    await appNoAdmin.close()

    // 管理员 → 200 {ok:true},行被删除;再删同 id → 404
    const appAdmin = Fastify()
    withUser(appAdmin, '+8613800138000')
    await appAdmin.register(runsRoutes, { targetBaseUrl: 'http://localhost:8680', prisma, startRun: async () => {}, authRequired: true, adminMobiles: [ADMIN] })
    const del = await appAdmin.inject({ method: 'DELETE', url: '/api/reports/rep-del-1' })
    expect(del.statusCode).toBe(200)
    expect(del.json()).toEqual({ ok: true })
    expect(await prisma.report.findUnique({ where: { id: 'rep-del-1' } })).toBeNull()
    expect((await appAdmin.inject({ method: 'DELETE', url: '/api/reports/rep-del-1' })).statusCode).toBe(404)
    await appAdmin.close()
  })
})

describe('被测后端地址白名单（TARGET_DEBUG_KEY 不得发给任意地址）', () => {
  const evil = 'http://127.0.0.1:1'   // 不会被连接：被拒绝发生在发请求之前

  it('GET /api/roles 对名单外地址返回 403 target_not_allowed，且不发请求', async () => {
    const calls: string[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (u: any) => { calls.push(String(u)); return new Response('{}') }) as any
    try {
      const app = Fastify()
      await app.register(runsRoutes, { prisma, startRun: async () => {}, targetBaseUrl: 'http://localhost:8680', targetDebugKey: 'SECRET' })
      const r = await app.inject({ method: 'GET', url: `/api/roles?targetBaseUrl=${encodeURIComponent(evil)}` })
      expect(r.statusCode).toBe(403)
      expect(r.json()).toMatchObject({ error: 'target_not_allowed' })
      expect(r.json().message).toContain('TARGET_ALLOWED_ORIGINS')
      expect(calls).toHaveLength(0)
      await app.close()
    } finally { globalThis.fetch = orig }
  })

  it('POST /api/connection-test 与 POST /api/runs 对名单外地址同样 403', async () => {
    const app = Fastify()
    await app.register(runsRoutes, { prisma, startRun: async () => {}, targetBaseUrl: 'http://localhost:8680' })
    const c = await app.inject({ method: 'POST', url: '/api/connection-test', payload: { targetBaseUrl: evil } })
    expect(c.statusCode).toBe(403)
    expect(c.json().error).toBe('target_not_allowed')
    const r = await app.inject({
      method: 'POST', url: '/api/runs',
      payload: { targetBaseUrl: evil, personaIds: ['x'], taGender: 2, userModel: 'a', judgeModel: 'b', endCondition: { maxTurns: 1 }, concurrency: 1, repetitions: 1 },
    })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('target_not_allowed')
    await app.close()
  })

  it('用户信息伪装（localhost:8680@evil）按真实 origin 判定；TARGET_ALLOWED_ORIGINS 里的地址放行', async () => {
    const orig = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = (async (u: any) => { seen.push(String(u)); return new Response(JSON.stringify({ code: 200, data: { roles: [] } }), { headers: { 'content-type': 'application/json' } }) }) as any
    try {
      const app = Fastify()
      await app.register(runsRoutes, { prisma, startRun: async () => {}, targetBaseUrl: 'http://localhost:8680', targetAllowedOrigins: ['https://ok.example.com'] })
      const sneaky = await app.inject({ method: 'GET', url: `/api/roles?targetBaseUrl=${encodeURIComponent('http://localhost:8680@evil.example.com/x')}` })
      expect(sneaky.statusCode).toBe(403)
      const ok = await app.inject({ method: 'GET', url: `/api/roles?targetBaseUrl=${encodeURIComponent('https://ok.example.com/api')}` })
      expect(ok.statusCode).toBe(200)
      const dflt = await app.inject({ method: 'GET', url: '/api/roles' })
      expect(dflt.statusCode).toBe(200)
      expect(seen).toEqual(['https://ok.example.com/api/debug/roles', 'http://localhost:8680/debug/roles'])
      const me = await app.inject({ method: 'GET', url: '/api/me' })
      expect(me.json().defaultTargetBaseUrl).toBe('http://localhost:8680')
      await app.close()
    } finally { globalThis.fetch = orig }
  })
})
