export interface TargetMeta {
  sessionId?: string
  messageId?: number
  emotionState?: unknown
  memoryUsed?: boolean
  safetyMode?: boolean
}

export interface TargetChatResult {
  text: string
  firstTokenMs: number | null
  totalMs: number
  done: boolean
  error: { errorType: string; message: string; retryable: boolean } | null
  meta: TargetMeta
}

export interface Dialogue {
  role: 'persona' | 'target'
  text: string
}

export interface PersonaStructured {
  age?: number
  gender?: string
  hometown?: string
  occupation?: string
  personality?: string
  speakingStyle?: string
  intent?: string
  // 生成行为开关（存于 structuredJson，无需 DB 迁移）
  maxChars?: number   // 每条用户消息字数上限（默认 50）
  innerOS?: boolean   // 是否允许在消息里带简短「内心OS」（默认 false）
  avatar?: string     // 头像（data URL；为空则用首字母默认头像）
}

export interface InjectedFact {
  key: string
  value: string
  injectAtTurn: number
}

export interface RecallProbe {
  factKey: string
  probeAtTurn: number
  question: string
}

export interface Persona {
  id: string
  name: string
  category: 'normal' | 'redteam'
  structured: PersonaStructured
  systemPrompt: string
  redteamTactics?: string[]
  injectedFacts?: InjectedFact[]
  recallProbes?: RecallProbe[]
  tags?: string[]
}

export interface TargetRolePromptPersona {
  identityBase?: string
  dailyStyle?: string
  relationshipBase?: string
  emotionSupport?: string
  mediaPolicy?: string
  realityBoundary?: string
  safetyBoundary?: string
}

export interface TargetRole {
  id: number
  name: string
  nickname?: string
  gender: number          // 1=male, 2=female
  age?: number
  city?: string
  height?: number
  voice?: string
  avatar?: string
  brief?: string
  title?: string
  tags?: string[]
  chatPersona?: string
  promptPersona?: TargetRolePromptPersona
  renderedPrompt?: string
}
