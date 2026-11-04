import type { PrismaClient } from '../../generated/prisma'

export interface CreateRunInput {
  id: string
  name?: string
  targetBaseUrl: string
  targetLabel?: string
  taGender: number
  replayFromRunId?: string
  personaSetJson: string
  userModel: string
  judgeModel: string
  endConditionJson: string
  concurrency: number
  repetitions: number
  status: string
  createdAt: Date
}
export function createRun(prisma: PrismaClient, data: CreateRunInput) {
  return prisma.run.create({ data })
}

export interface CreateSessionInput {
  id: string
  runId: string
  personaId: string
  repetitionIndex?: number
  targetUid?: number
  targetMemoryId?: number
  targetRoleId?: number
  targetToken?: string
  status: string
  createdAt: Date
}
export function createSession(prisma: PrismaClient, data: CreateSessionInput) {
  return prisma.session.create({ data })
}

export interface SaveTurnInput {
  turn: {
    id: string; sessionId: string; idx: number
    userText: string; targetText: string
    targetMessageId?: number; targetSessionId?: string
    firstTokenMs?: number; totalMs?: number
    errorType?: string; replyLen?: number; rawMetaJson?: string
    createdAt: Date
  }
  score?: {
    turnId: string; dimsJson: string; overall: number
    comment: string; improvementSuggestion: string
    violation: boolean; memoryHit?: boolean; judgeError?: string
  }
}
export async function saveTurnWithScore(prisma: PrismaClient, input: SaveTurnInput): Promise<void> {
  const score = input.score
  await prisma.$transaction(async (tx) => {
    await tx.turn.create({ data: input.turn })
    if (score) await tx.turnScore.create({ data: score })
  })
}

export function finishSession(
  prisma: PrismaClient,
  id: string,
  data: { status: string; endReason: string; turnCount: number; avgScore: number | null; finishedAt: Date },
) {
  return prisma.session.update({ where: { id }, data })
}

export function updateRunStatus(
  prisma: PrismaClient,
  id: string,
  data: { status: string; summaryJson?: string; startedAt?: Date; finishedAt?: Date },
) {
  return prisma.run.update({ where: { id }, data })
}

export function upsertPersona(
  prisma: PrismaClient,
  p: {
    id: string; name: string; category: string; structuredJson: string; systemPrompt: string;
    redteamTacticsJson?: string | null; injectedFactsJson?: string | null; recallProbesJson?: string | null; tags?: string | null
  },
) {
  const now = new Date()
  return prisma.persona.upsert({
    where: { id: p.id },
    create: { ...p, createdAt: now, updatedAt: now },
    update: { ...p, updatedAt: now },
  })
}

// 人设库列表：默认只返回未归档的人设（软删除的对用户不可见）。
export function listPersonas(prisma: PrismaClient) {
  return prisma.persona.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'desc' } })
}

export function deletePersona(prisma: PrismaClient, id: string) {
  return prisma.persona.delete({ where: { id } })
}

// 软删除/归档：保留行（历史报告仍能按 id 解析人设名），仅从库中隐藏。
export function archivePersona(prisma: PrismaClient, id: string) {
  return prisma.persona.update({ where: { id }, data: { archivedAt: new Date() } })
}

export function saveMemoryCheck(
  prisma: PrismaClient,
  data: { id: string; sessionId: string; factKey: string; factValue: string; injectTurn: number; probeTurn: number; injected: boolean; recalled: boolean; evidenceText?: string | null },
) {
  return prisma.memoryCheck.create({ data })
}
