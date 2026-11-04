import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '../../generated/prisma'
import { createRun, createSession, deletePersona, finishSession, listPersonas, saveTurnWithScore, updateRunStatus, upsertPersona } from './repositories'

let prisma: PrismaClient
const dir = mkdtempSync(join(tmpdir(), 'chat-arena-db-'))
const dbUrl = `file:${join(dir, 'test.db')}`
const apiDir = new URL('../../', import.meta.url).pathname

beforeAll(() => {
  // Push schema to a fresh temp db (no migrations needed for tests)
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    { cwd: apiDir, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'ignore' },
  )
  prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })
})
afterAll(async () => { await prisma.$disconnect(); rmSync(dir, { recursive: true, force: true }) })

describe('repositories', () => {
  it('run → session → turn(+score) → finishSession', async () => {
    const now = new Date('2026-06-04T00:00:00Z')
    await createRun(prisma, {
      id: 'run1', targetBaseUrl: 'http://localhost:8680', taGender: 2,
      personaSetJson: '["p1"]', userModel: 'qwen:qwen-plus', judgeModel: 'deepseek:deepseek-chat',
      endConditionJson: '{"maxTurns":12}', concurrency: 1, repetitions: 1,
      status: 'running', createdAt: now,
    })
    await createSession(prisma, {
      id: 's1', runId: 'run1', personaId: 'p1', repetitionIndex: 0, status: 'running', createdAt: now,
    })
    await saveTurnWithScore(prisma, {
      turn: {
        id: 't1', sessionId: 's1', idx: 0, userText: '在吗', targetText: '在的',
        firstTokenMs: 100, totalMs: 500, replyLen: 2, createdAt: now,
      },
      score: {
        turnId: 't1', dimsJson: '{"empathy":5}', overall: 4.2,
        comment: 'ok', improvementSuggestion: '追问', violation: false,
      },
    })
    await finishSession(prisma, 's1', {
      status: 'finished', endReason: 'max_turns', turnCount: 1, avgScore: 4.2, finishedAt: now,
    })
    const turn = await prisma.turn.findUnique({ where: { id: 't1' }, include: { score: true } })
    expect(turn?.targetText).toBe('在的')
    expect(turn?.score?.overall).toBe(4.2)
    const s = await prisma.session.findUnique({ where: { id: 's1' } })
    expect(s?.endReason).toBe('max_turns')
    expect(s?.repetitionIndex).toBe(0)
  })

  it('updateRunStatus sets status and summary', async () => {
    await updateRunStatus(prisma, 'run1', { status: 'finished', summaryJson: '{"ok":true}' })
    const run = await prisma.run.findUnique({ where: { id: 'run1' } })
    expect(run?.status).toBe('finished')
    expect(run?.summaryJson).toBe('{"ok":true}')
  })
})

describe('persona CRUD', () => {
  it('upsert creates a persona, update changes name', async () => {
    await upsertPersona(prisma, { id: 'p-test', name: '测试人设', category: 'normal', structuredJson: '{}', systemPrompt: 'test' })
    const rows = await listPersonas(prisma)
    expect(rows.some(r => r.id === 'p-test')).toBe(true)
    // update
    await upsertPersona(prisma, { id: 'p-test', name: '改名了', category: 'normal', structuredJson: '{}', systemPrompt: 'test' })
    const updated = await prisma.persona.findUnique({ where: { id: 'p-test' } })
    expect(updated?.name).toBe('改名了')
  })
  it('delete removes the persona', async () => {
    await upsertPersona(prisma, { id: 'p-del', name: '待删除', category: 'normal', structuredJson: '{}', systemPrompt: 'x' })
    await deletePersona(prisma, 'p-del')
    expect(await prisma.persona.findUnique({ where: { id: 'p-del' } })).toBeNull()
  })
})
