function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '')
}

export function isInjected(factValue: string, userText: string): boolean {
  return normalize(userText).includes(normalize(factValue))
}

export interface RecallInput {
  factValue: string
  reply: string
}

export async function checkRecall(
  input: RecallInput,
  judgeRecall?: (input: RecallInput) => Promise<boolean>,
): Promise<{ recalled: boolean; evidence: string | null }> {
  if (normalize(input.reply).includes(normalize(input.factValue))) {
    return { recalled: true, evidence: input.reply }
  }
  if (judgeRecall) {
    const ok = await judgeRecall(input)
    return { recalled: ok, evidence: ok ? input.reply : null }
  }
  return { recalled: false, evidence: null }
}
