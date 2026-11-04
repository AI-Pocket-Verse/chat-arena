import { enableWal } from '@chat-arena/db-kit'
import { PrismaClient } from '../generated/prisma/index.js'

export const prisma = new PrismaClient()

export async function initDb(): Promise<void> {
  await enableWal(prisma)
  // PRAGMA busy_timeout returns a row, so it must use queryRaw (executeRaw rejects results on SQLite)
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000')
}
