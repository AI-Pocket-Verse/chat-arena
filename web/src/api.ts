import type { RunConfig } from '@chat-arena/shared'
import { createHttpClient } from '@chat-arena/http-client'
import { currentLang } from './i18n/lang'

// API prefix = vite base + "api"（默认部署在根路径时为 /api）。
// 本地开发由 vite 代理到 :4040，生产由 nginx 反代（见 deploy/）。
const API_BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '') + '/api'
// X-Lang：当前界面语言。api 据此返回对应语言的错误提示，发起评测时记下语言，AI 生成的内容（点评、报告等）跟随它
const http = createHttpClient({ baseUrl: window.location.origin, getHeaders: () => ({ 'X-Lang': currentLang() }) })

export interface RunAggregate {
  turnCount: number
  avgOverall: number | null
  dimMeans: {
    personaFit: number | null
    empathy: number | null
    memoryAccuracy: number | null
    safety: number | null
    naturalness: number | null
    relevance: number | null
  }
  errorRate: number
  violationCount: number
  memoryHitRate: number | null
  avgFirstTokenMs: number | null
}

export interface PersonaStructured {
  age?: number
  gender?: string
  hometown?: string
  occupation?: string
  personality?: string
  speakingStyle?: string
  intent?: string
  maxChars?: number   // 每条用户消息字数上限（默认 50）
  innerOS?: boolean   // 是否允许带「内心OS」
  avatar?: string     // 头像（data URL；为空用首字母默认头像）
}

export interface ReportRow {
  id: string
  runId: string
  createdAt: string
  runName: string | null
  targetLabel: string | null
  avgOverall: number | null
  createdByName: string | null
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

export interface PersonaInput {
  name: string
  category: 'normal' | 'redteam'
  structured: PersonaStructured
  systemPrompt: string
  redteamTactics?: string[]
  injectedFacts?: InjectedFact[]
  recallProbes?: RecallProbe[]
  tags?: string[]
}

export interface PersonaRow {
  id: string
  name: string
  category: string
  systemPrompt: string
  structuredJson: string | null
  redteamTacticsJson: string | null
  injectedFactsJson: string | null
  recallProbesJson: string | null
  tags: string | null
  createdAt: string
  updatedAt: string
}

// 与 api 的 mapTargetRole 一致：除 id / name / gender 外，被测后端可以不返回任何字段。
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
  gender: 1 | 2
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

/** 新建评测页可选的模型（来自 api/.env.* 的 <供应商>_MODELS） */
export interface ModelOption {
  id: string
  label: string
  /** key 等配置齐全；false 时 message 说明缺什么 */
  ready: boolean
  message?: string
}

export const api = {
  listPersonas: () => http.get<{ personas: PersonaRow[] }>(`${API_BASE}/personas`),
  extractPersona: (body: { systemPrompt: string }) =>
    http.post<{ structured: PersonaStructured; tags: string[] }>(`${API_BASE}/personas/extract`, body),
  generatePersona: (body: { brief?: string; name?: string; gender?: string; age?: number; occupation?: string; category?: 'normal' | 'redteam' }) =>
    http.post<{ name: string; category: 'normal' | 'redteam'; systemPrompt: string; structured: PersonaStructured; tags: string[] }>(`${API_BASE}/personas/generate`, body),
  importPersona: (body: { text: string }) =>
    http.post<{
      name: string; category: 'normal' | 'redteam'; systemPrompt: string; structured: PersonaStructured
      tags: string[]; redteamTactics: string[]; injectedFacts: InjectedFact[]; recallProbes: RecallProbe[]
    }>(`${API_BASE}/personas/import`, body),
  createPersona: (body: PersonaInput) =>
    http.post<{ persona: unknown }>(`${API_BASE}/personas`, body),
  updatePersona: (id: string, body: PersonaInput) =>
    http.put<{ persona: unknown }>(`${API_BASE}/personas/${id}`, body),
  // 返回 archived: true=被评测引用过故归档（库中隐藏，保留历史报告引用）；false=未被引用，已物理删除
  deletePersona: (id: string) =>
    http.delete<{ archived: boolean }>(`${API_BASE}/personas/${id}`),
  listRuns: () => http.get<{ runs: unknown[] }>(`${API_BASE}/runs`),
  createRun: (cfg: RunConfig) => http.post<{ runId: string }>(`${API_BASE}/runs`, cfg),
  getRun: (id: string) => http.get<{ run: unknown }>(`${API_BASE}/runs/${id}`),
  stopRun: (id: string) => http.post<{ ok: boolean }>(`${API_BASE}/runs/${id}/stop`, {}),
  getRunTurns: (id: string) => http.get<{ sessions: unknown[] }>(`${API_BASE}/runs/${id}/turns`),
  getRunMetrics: (id: string) => http.get<RunAggregate>(`${API_BASE}/runs/${id}/metrics`),
  generateReport: (runId: string) => http.post<{ reportId: string }>(`${API_BASE}/runs/${runId}/report`, {}),
  getReport: (runId: string) => http.get<{ report: { id: string; markdown: string } }>(`${API_BASE}/runs/${runId}/report`),
  listReports: () => http.get<{ reports: ReportRow[] }>(`${API_BASE}/reports`),
  // 当前登录者能力位：isAdmin=手机号命中 ADMIN_MOBILES（未开启登录的本地单机恒为 true）
  getMe: () => http.get<{ isAdmin: boolean; defaultTargetBaseUrl?: string }>(`${API_BASE}/me`),
  deleteReport: (id: string) => http.delete<{ ok: boolean }>(`${API_BASE}/reports/${id}`),
  getReportById: (id: string) => http.get<{ report: { id: string; runId: string; createdAt: string; markdown: string; json: string } }>(`${API_BASE}/reports/${id}`),
  compareRuns: (a: string, b: string) =>
    http.get<{
      runA: RunAggregate
      runB: RunAggregate
      comparison: {
        overallDelta: number
        dimDeltas: Record<string, number | null>
        regressions: string[]
        violationDelta: number
        memoryHitRateDelta: number | null
      }
    }>(`${API_BASE}/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  listModels: () => http.get<{ models: ModelOption[]; defaultModel: string | null }>(`${API_BASE}/models`),
  listRoles: () => http.get<{ roles: TargetRole[] }>(`${API_BASE}/roles`),
  connectionTest: (body: { targetBaseUrl: string; taGender?: 1 | 2 }) =>
    http.post<{
      ok: boolean
      stage?: string
      error?: string
      tokenOk?: boolean
      replyOk?: boolean
      sampleReply?: string
      firstTokenMs?: number | null
      totalMs?: number
    }>(`${API_BASE}/connection-test`, body),
}
