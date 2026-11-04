import { prisma } from '../db'
import { SEED_PERSONAS } from './personas'

async function main() {
  if (SEED_PERSONAS.length > 0) {
    for (const p of SEED_PERSONAS) {
      const now = new Date()
      await prisma.persona.upsert({
        where: { id: p.id },
        create: {
          id: p.id, name: p.name, category: p.category,
          structuredJson: JSON.stringify(p.structured),
          systemPrompt: p.systemPrompt,
          redteamTacticsJson: p.redteamTactics ? JSON.stringify(p.redteamTactics) : null,
          injectedFactsJson: p.injectedFacts ? JSON.stringify(p.injectedFacts) : null,
          recallProbesJson: p.recallProbes ? JSON.stringify(p.recallProbes) : null,
          createdAt: now, updatedAt: now,
        },
        update: {},
      })
    }
  }
  console.log(`seeded ${SEED_PERSONAS.length} personas`)
  await prisma.$disconnect()
}

void main()
