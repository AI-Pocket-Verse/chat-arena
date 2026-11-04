import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '../../generated/prisma'
import { hasExplicitMemoryPlan, personasRoutes } from './personas'
import type { ModelClient } from '../clients/model-client'

describe('hasExplicitMemoryPlan (记忆埋点闸门)', () => {
  it('普通人设描述（含记忆墙/记住等泛词）判为 false', () => {
    expect(hasExplicitMemoryPlan('记忆墙：记录”喜欢奶茶””独居”。核心需求：被记得，希望AI记住她的小习惯。')).toBe(false)
    expect(hasExplicitMemoryPlan('事件记忆：记录会议、汇报；事件回访：记得他今天有汇报。')).toBe(false)
    expect(hasExplicitMemoryPlan('记忆系统：记住”不喜欢说教””深夜容易难过”。')).toBe(false)
  })
  it('普通叙述中带「第N轮」但无埋点动词 → false（收紧后新增反例）', () => {
    expect(hasExplicitMemoryPlan('她第3轮就开始抱怨，情绪明显不对。')).toBe(false)
    expect(hasExplicitMemoryPlan('聊到第二轮面试时她才说起这件事。')).toBe(false)
  })
  it('显式轮次埋点编排判为 true', () => {
    expect(hasExplicitMemoryPlan('第3轮注入：老家在苏州；第8轮回问：你还记得我老家吗')).toBe(true)
    // 「第三轮说出宠物名字」：「说出」在 0~8 字符窗口内 → 命中
    expect(hasExplicitMemoryPlan('第三轮说出宠物名字')).toBe(true)
    expect(hasExplicitMemoryPlan('记忆埋点设计：...')).toBe(true)
    expect(hasExplicitMemoryPlan('回溯探针：probeAtTurn=5')).toBe(true)
    expect(hasExplicitMemoryPlan('考记忆：复述之前提到的事实')).toBe(true)
  })
  it('显式轮次埋点编排新增正例（动词紧跟轮次）→ true', () => {
    expect(hasExplicitMemoryPlan('第3轮注入：老家在苏州')).toBe(true)
    expect(hasExplicitMemoryPlan('第2轮说出宠物名')).toBe(true)
    expect(hasExplicitMemoryPlan('第8轮回问你还记得吗')).toBe(true)
  })
})

let prisma: PrismaClient
const dir = mkdtempSync(join(tmpdir(), 'chat-arena-personas-'))
const dbUrl = `file:${join(dir, 'test.db')}`
const apiDir = new URL('../../', import.meta.url).pathname

beforeAll(() => {
  execFileSync(process.execPath,
    ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    { cwd: apiDir, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'ignore' })
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })
})
afterAll(async () => { await prisma.$disconnect(); rmSync(dir, { recursive: true, force: true }) })

describe('personasRoutes CRUD', () => {
  it('POST creates, GET lists, PUT updates, DELETE removes', async () => {
    const app = Fastify()
    await app.register(personasRoutes, { prisma })

    const create = await app.inject({ method: 'POST', url: '/api/personas', payload: { name: '测试', category: 'normal', systemPrompt: 'test' } })
    expect(create.statusCode).toBe(201)
    const { persona } = create.json() as { persona: { id: string } }

    const list = await app.inject({ method: 'GET', url: '/api/personas' })
    expect((list.json() as { personas: unknown[] }).personas).toHaveLength(1)

    const update = await app.inject({ method: 'PUT', url: `/api/personas/${persona.id}`, payload: { name: '改名', category: 'normal', systemPrompt: 'updated' } })
    expect(update.statusCode).toBe(200)
    expect((update.json() as { persona: { name: string } }).persona.name).toBe('改名')

    // 未被任何评测引用 → 物理删除（archived:false）
    const del = await app.inject({ method: 'DELETE', url: `/api/personas/${persona.id}` })
    expect(del.statusCode).toBe(200)
    expect((del.json() as { archived: boolean }).archived).toBe(false)

    const list2 = await app.inject({ method: 'GET', url: '/api/personas' })
    expect((list2.json() as { personas: unknown[] }).personas).toHaveLength(0)

    await app.close()
  })

  it('POST /extract returns 503 without a model client', async () => {
    const app = Fastify()
    await app.register(personasRoutes, { prisma })
    const res = await app.inject({ method: 'POST', url: '/api/personas/extract', payload: { systemPrompt: 'x' } })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('DELETE archives (soft-deletes) a persona referenced by a run, hiding it from the list but keeping the row', async () => {
    const app = Fastify()
    await app.register(personasRoutes, { prisma })

    const create = await app.inject({ method: 'POST', url: '/api/personas', payload: { name: '被引用人设', category: 'normal', systemPrompt: 'x' } })
    const { persona } = create.json() as { persona: { id: string } }

    // 造一个引用该人设的 run + session（session 对 run 有 FK）
    const now = new Date()
    const run = await prisma.run.create({ data: {
      id: 'run-ref-1', targetBaseUrl: 'http://x', taGender: 1,
      personaSetJson: JSON.stringify([persona.id]), userModel: 'qwen:qwen-plus', judgeModel: 'qwen:qwen-plus',
      endConditionJson: '{}', concurrency: 1, repetitions: 1, status: 'finished', createdAt: now,
    } })
    await prisma.session.create({ data: {
      id: 'sess-ref-1', runId: run.id, personaId: persona.id, status: 'finished', createdAt: now,
    } })

    const del = await app.inject({ method: 'DELETE', url: `/api/personas/${persona.id}` })
    expect(del.statusCode).toBe(200)
    expect((del.json() as { archived: boolean }).archived).toBe(true)

    // 从库列表隐藏
    const list = await app.inject({ method: 'GET', url: '/api/personas' })
    expect((list.json() as { personas: { id: string }[] }).personas.find(p => p.id === persona.id)).toBeUndefined()

    // 行仍保留，archivedAt 已写入 —— 历史报告仍可按 id 解析人设名
    const row = await prisma.persona.findUnique({ where: { id: persona.id } })
    expect(row).not.toBeNull()
    expect(row?.archivedAt).not.toBeNull()

    // 清理（避免污染后续用例的共享 prisma 实例）
    await prisma.session.delete({ where: { id: 'sess-ref-1' } })
    await prisma.run.delete({ where: { id: run.id } })
    await prisma.persona.delete({ where: { id: persona.id } })
    await app.close()
  })

  it('POST /import returns 503 without a model client', async () => {
    const app = Fastify()
    await app.register(personasRoutes, { prisma })
    const res = await app.inject({ method: 'POST', url: '/api/personas/import', payload: { text: '一段人设描述' } })
    expect(res.statusCode).toBe(503)
    await app.close()
  })

  it('POST /import normalizes parsed persona (turn coercion + filtering)', async () => {
    const app = Fastify()
    const modelClient: ModelClient = {
      chatText: async () => '',
      async chatJson<T>(): Promise<T> {
        return {
          name: ' 小芸 ',
          category: 'normal',
          systemPrompt: ' 你是小芸… ',
          structured: { age: '26', gender: '女', hometown: '苏州', occupation: '设计师' },
          tags: ['倾诉', ''],
          redteamTactics: [],
          injectedFacts: [
            { key: 'pet', value: '养了只橘猫', injectAtTurn: '3' },   // 字符串轮次 → 3
            { key: '', value: '无 key 应被过滤', injectAtTurn: 1 },
          ],
          recallProbes: [
            { factKey: 'pet', probeAtTurn: null, question: '我家猫叫什么来着？' }, // 非法轮次 → 默认 2
          ],
        } as unknown as T
      },
    }
    await app.register(personasRoutes, { prisma, modelClient, defaultModel: () => 'qwen:qwen-plus' })
    // 源文本含显式埋点编排（「第3轮注入」「第8轮回问」），闸门放行 → 正常归一/过滤
    const res = await app.inject({ method: 'POST', url: '/api/personas/import', payload: { text: '# 小芸\n26 岁苏州人…\n记忆测试编排：第3轮注入：养了只橘猫；第8轮回问：我家猫叫什么来着？' } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      name: string; systemPrompt: string; structured: Record<string, unknown>; tags: string[]
      injectedFacts: Array<{ key: string; injectAtTurn: number }>
      recallProbes: Array<{ factKey: string; probeAtTurn: number }>
    }
    expect(body.name).toBe('小芸')
    expect(body.systemPrompt).toBe('你是小芸…')
    expect(body.structured.age).toBe(26)
    expect(body.tags).toEqual(['倾诉'])
    expect(body.injectedFacts).toHaveLength(1)
    expect(body.injectedFacts[0]).toMatchObject({ key: 'pet', injectAtTurn: 3 })
    expect(body.recallProbes[0]).toMatchObject({ factKey: 'pet', probeAtTurn: 2 })
    await app.close()
  })

  it('POST /import drops fabricated facts/probes when the source has no explicit memory plan (gate)', async () => {
    const app = Fastify()
    // 模型「脑补」出了 facts/probes（模拟 P1 记忆墙被误读的情况）
    const modelClient: ModelClient = {
      chatText: async () => '',
      async chatJson<T>(): Promise<T> {
        return {
          name: '林夏', category: 'normal', systemPrompt: '你叫林夏…',
          structured: { age: 27, gender: '女' }, tags: ['陪伴'], redteamTactics: [],
          injectedFacts: [{ key: 'likes_milk_tea', value: '喜欢喝奶茶', injectAtTurn: 1 }],
          recallProbes: [{ factKey: 'likes_milk_tea', probeAtTurn: 3, question: '上次的奶茶怎么样？' }],
        } as unknown as T
      },
    }
    await app.register(personasRoutes, { prisma, modelClient, defaultModel: () => 'qwen:qwen-plus' })
    // 源文本是普通人设描述（含“记忆墙/记住”等泛词，但无显式轮次埋点编排）→ 闸门拦截
    const text = '# 林夏\n独居互联网运营。\n产品侧重点：记忆墙：记录“喜欢奶茶”“独居”。核心需求：被记得，希望AI记住她的小习惯。'
    const res = await app.inject({ method: 'POST', url: '/api/personas/import', payload: { text } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { injectedFacts: unknown[]; recallProbes: unknown[] }
    expect(body.injectedFacts).toEqual([])   // 虚构埋点被无条件丢弃
    expect(body.recallProbes).toEqual([])
    await app.close()
  })

  it('POST /extract normalizes model output into structured + tags', async () => {
    const app = Fastify()
    const modelClient: ModelClient = {
      chatText: async () => '',
      async chatJson<T>(): Promise<T> {
        return { age: '28', gender: '女', occupation: '小学教师', intent: '咨询暑期课程', personality: '', tags: ['家长', '   ', 'tier-1'] } as unknown as T
      },
    }
    await app.register(personasRoutes, { prisma, modelClient, defaultModel: () => 'qwen:qwen-plus' })
    const res = await app.inject({ method: 'POST', url: '/api/personas/extract', payload: { systemPrompt: '你是一位28岁的小学教师家长，想咨询暑期课程' } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { structured: Record<string, unknown>; tags: string[] }
    expect(body.structured.age).toBe(28)            // 字符串 "28" 被归一为数字
    expect(body.structured.gender).toBe('女')
    expect(body.structured.occupation).toBe('小学教师')
    expect(body.structured.personality).toBeUndefined() // 空串被丢弃
    expect(body.tags).toEqual(['家长', 'tier-1'])    // 空白标签被过滤
    await app.close()
  })
})
