import { randomUUID } from 'node:crypto'
import { createTargetClient } from '../clients/target-client'
import { buildModelRegistry, createModelClient, defaultModelId } from '../clients/model-client'
import { createJudgeEngine } from '../engine/judge-engine'
import { buildPersonaSystemPrompt, createPersonaEngine } from '../engine/persona-engine'
import { env } from '../env'
import { xiaoming } from '../seed/personas'
import type { Dialogue } from '../types'

const MAX_TURNS = Number(process.env['MAX_TURNS'] ?? 6)

async function main(): Promise<void> {
  const target = createTargetClient({ baseUrl: env.TARGET_BASE_URL, debugKey: env.TARGET_DEBUG_KEY, headers: env.TARGET_HEADERS })
  const registry = buildModelRegistry(process.env)
  const modelId = defaultModelId(registry, env.DEFAULT_MODEL)
  if (!modelId) throw new Error('没有可用模型：请在 api/.env.dev 的 <供应商>_MODELS 里登记模型并配置对应 key')
  const model = createModelClient(registry)
  const personaEngine = createPersonaEngine(model, modelId)
  const judge = createJudgeEngine(model, modelId)

  const { token } = await target.generateDebugToken({ taGender: 2 })
  const history: Dialogue[] = []
  const personaSummary = buildPersonaSystemPrompt(xiaoming).slice(0, 120)

  for (let i = 0; i < MAX_TURNS; i++) {
    const userText = await personaEngine.nextUserMessage(xiaoming, history)
    history.push({ role: 'persona', text: userText })
    console.log(`\n[${i}] 小明：${userText}`)

    const reply = await target.chat(token, userText, randomUUID())
    history.push({ role: 'target', text: reply.text })
    console.log(`[${i}] target：${reply.text}  (firstToken=${reply.firstTokenMs}ms, total=${reply.totalMs}ms)`)

    if (reply.error) {
      console.error(`[${i}] target error: ${reply.error.errorType} — ${reply.error.message}`)
      if (!reply.error.retryable) break
      continue
    }

    const result = await judge.judgeTurn({
      personaSummary,
      userText,
      targetText: reply.text,
      recentHistory: history.slice(-6),
      timing: { firstTokenMs: reply.firstTokenMs, totalMs: reply.totalMs, errorType: null, replyText: reply.text },
    })

    if (result.judge) {
      console.log(`[${i}] 评分 overall=${result.judge.overall} dims=${JSON.stringify(result.judge.dims)} | ${result.judge.comment}`)
      console.log(`[${i}] 改进：${result.judge.improvementSuggestion} | replyLen=${result.hard.replyLen}`)
    } else {
      console.log(`[${i}] 裁判失败（judgeError=${result.judgeError}）| hard=${JSON.stringify(result.hard)}`)
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
