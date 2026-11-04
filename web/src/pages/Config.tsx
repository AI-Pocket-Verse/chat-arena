import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import type { ModelOption, TargetRole } from '../api'
import { ErrorState } from '../error-state'
import { buildRunName, buildVersionLabel, ensurePinyinLoaded, NAME_ALLOWED_HINT, NAME_ALLOWED_RE } from '../naming'
import { type RunRow, RunPicker } from '../run-picker'
import { useUi } from '../ui-store'

interface PersonaRow {
  id: string
  name: string
  category: string
  structuredJson?: string | null
  tags?: string | null
}

// 从人设行解析出选择列表要展示的元信息（性别 / 意图 / 标签）。
function personaMeta(p: PersonaRow): { gender: string; intent: string; tags: string[] } {
  let gender = ''
  let intent = ''
  try {
    const s = p.structuredJson ? (JSON.parse(p.structuredJson) as { gender?: string; intent?: string }) : {}
    gender = s.gender?.trim() ?? ''
    intent = s.intent?.trim() ?? ''
  } catch { /* 坏 JSON 当作无结构化信息 */ }
  const tags = (p.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean)
  return { gender, intent, tags }
}

type EndMode = 'turns' | 'duration' | 'unlimited'

interface ConnectionTestResult {
  ok: boolean
  stage?: string
  error?: string
  tokenOk?: boolean
  replyOk?: boolean
  sampleReply?: string
  firstTokenMs?: number | null
  totalMs?: number
}

// ── Role info mini-card ───────────────────────────────────────────────────────

function RoleAvatar({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState(false)
  if (failed || !src) {
    return (
      <div className="w-10 h-10 rounded-lg bg-[#F7F8FB] border border-[#E8E8EE] flex items-center justify-center text-sm text-[#6B7280] shrink-0">
        {name.slice(0, 1)}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className="w-10 h-10 rounded-lg object-cover shrink-0 border border-[#E8E8EE]"
    />
  )
}

function RoleInfoCard({ role }: { role: TargetRole }) {
  return (
    <div
      className="mt-3 rounded-xl border border-[#ECECF2] bg-[#F7F8FB] p-4"
    >
      <div className="flex items-start gap-3">
        <RoleAvatar src={role.avatar} name={role.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-[#15171E]">{role.name}</span>
            {role.gender === 1 ? (
              <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-[#2563EB]/10 text-[#2563EB] border border-[#2563EB]/20">♂ 男</span>
            ) : (
              <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-[#1664FF]/10 text-[#1664FF] border border-[#1664FF]/20">♀ 女</span>
            )}
            {role.age != null && <span className="text-xs text-[#6B7280]">{role.age} 岁</span>}
            {role.city && <span className="text-xs text-[#6B7280]">{role.city}</span>}
          </div>
          {role.title && (
            <p className="text-xs text-[#1664FF] font-medium mb-2">{role.title}</p>
          )}
          {role.tags && role.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {role.tags.map((t) => (
                <span key={t} className="text-xs bg-white border border-[#E8E8EE] text-[#6B7280] px-1.5 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
          )}
          {role.promptPersona?.identityBase && (
            <p className="text-xs text-[#6B7280] leading-relaxed line-clamp-3">
              <span className="text-[#9CA3AF]">你是谁: </span>
              {role.promptPersona.identityBase}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// 模型下拉：选项来自 GET /api/models（api/.env.* 里各家 <供应商>_MODELS 登记的模型）。
// 缺 key 的模型仍列出并标注，选中后发起评测会被预检拦下并提示该配哪个环境变量。
function ModelSelect({ value, onChange, models }: { value: string; onChange: (v: string) => void; models: ModelOption[] }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {models.length === 0 && <option value="">未配置模型（见 api/.env.dev 的 *_MODELS）</option>}
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.ready ? m.label : `${m.label}（未配置 key）`}
        </option>
      ))}
    </select>
  )
}

const inputCls =
  'w-full bg-white border border-[#E8E8EE] rounded-lg px-3 py-2 text-sm text-[#15171E] placeholder-[#9CA3AF] focus:outline-none focus:border-[#1664FF] focus:ring-1 focus:ring-[#1664FF]/20 transition-colors'

const labelCls = 'block text-xs font-medium text-[#6B7280] mb-1'

const sectionCls = 'space-y-4 p-4 rounded-xl border border-[#ECECF2] bg-[#F7F8FB]'

const sectionTitleCls = 'text-xs font-semibold text-[#9CA3AF] uppercase tracking-widest mb-3'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-[#9CA3AF]">{hint}</p>}
    </div>
  )
}

// 记住上一次评测用的角色 id（精确还原"最近一次评测的角色"）。
const LAST_ROLE_KEY = 'chat-arena:lastRoleId'

// 默认 TA 角色 = 最近一次评测用的角色：优先精确匹配上次保存的角色 id；
// 否则按最近一次 Run 的 taGender 匹配同性别角色；再否则取第一个。
function pickDefaultRole(roles: TargetRole[], runs: RunRow[]): TargetRole | null {
  if (roles.length === 0) return null
  const lastId = localStorage.getItem(LAST_ROLE_KEY)
  const byLast = lastId ? roles.find((r) => String(r.id) === lastId) : undefined
  if (byLast) return byLast
  const recent = runs[0] // listRuns 按 createdAt 倒序，[0] 即最近一次
  if (recent) {
    const byGender = roles.find((r) => r.gender === recent.taGender)
    if (byGender) return byGender
  }
  return roles[0]!
}

export function Config() {
  const { setRunId } = useUi()
  const [personas, setPersonas] = useState<PersonaRow[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  // Target roles (optional — falls back to plain gender select if fetch fails)
  const [roles, setRoles] = useState<TargetRole[]>([])
  const [selectedRole, setSelectedRole] = useState<TargetRole | null>(null)

  // 历史 Run（用于 A/B 回放源的下拉选择）
  const [runs, setRuns] = useState<RunRow[]>([])

  // Run params
  // 名称/版本标注：默认自动生成（人设/角色拼音 + 自增 v + 日期）；用户一旦编辑则转为自定义、不再自动变化。
  const [name, setName] = useState('')
  const [nameCustom, setNameCustom] = useState(false)
  const [targetLabel, setTargetLabel] = useState('')
  const [targetLabelCustom, setTargetLabelCustom] = useState(false)
  const [today] = useState(() => new Date())
  const [pinyinReady, setPinyinReady] = useState(false)
  const [targetBaseUrl, setTargetBaseUrl] = useState('')
  const [taGender, setTaGender] = useState<1 | 2>(2)
  const [models, setModels] = useState<ModelOption[]>([])
  const [userModel, setUserModel] = useState('')
  const [judgeModel, setJudgeModel] = useState('')
  const [concurrency, setConcurrency] = useState(2)
  const [repetitions, setRepetitions] = useState(1)
  const [replayFromRunId, setReplayFromRunId] = useState('')

  // End condition
  const [endModes, setEndModes] = useState<Set<EndMode>>(new Set(['turns']))
  const [maxTurns, setMaxTurns] = useState(10)
  const [maxDurationSec, setMaxDurationSec] = useState(3600)

  // Connection test
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)

  const nav = useNavigate()

  // 只用「已完成」的 Run 作为 A/B 回放源（排除失败/已停止/进行中等异常或未就绪的）
  const finishedRuns = useMemo(() => runs.filter((r) => r.status === 'finished'), [runs])

  // 自动命名：人设名取首个被选中的人设；角色名跟随下方角色选择；v 在已有命名基础上自增。
  const firstPersonaName = useMemo(() => {
    const id = selected[0]
    return id ? (personas.find((p) => p.id === id)?.name ?? '') : ''
  }, [selected, personas])
  const roleName = selectedRole?.name ?? ''

  // 懒加载拼音词典；加载完成后置 pinyinReady → 触发下面的自动命名重算。
  useEffect(() => { void ensurePinyinLoaded().then(() => setPinyinReady(true)) }, [])
  // 被测后端地址默认取服务端配置（TARGET_BASE_URL），用户已手填则不覆盖
  useEffect(() => {
    let cancelled = false
    void api.getMe()
      .then((r) => { if (!cancelled && r.defaultTargetBaseUrl) setTargetBaseUrl((cur) => cur || r.defaultTargetBaseUrl!) })
      .catch(() => { /* 取不到默认值时留空，用户手填 */ })
    return () => { cancelled = true }
  }, [])

  // 模型列表与默认模型来自服务端配置，用户已选则不覆盖
  useEffect(() => {
    let cancelled = false
    void api.listModels()
      .then((r) => {
        if (cancelled) return
        setModels(r.models)
        const def = r.defaultModel ?? r.models[0]?.id ?? ''
        setUserModel((cur) => cur || def)
        setJudgeModel((cur) => cur || def)
      })
      .catch(() => { /* 取不到时下拉为空，发起评测会提示 */ })
    return () => { cancelled = true }
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps -- pinyinReady 仅用于在词典就绪后重算
  const autoName = useMemo(
    () => buildRunName(firstPersonaName, roleName, runs.map((r) => r.name), today),
    [firstPersonaName, roleName, runs, today, pinyinReady],
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 同上
  const autoTargetLabel = useMemo(
    () => buildVersionLabel(roleName, runs.map((r) => r.targetLabel), today),
    [roleName, runs, today, pinyinReady],
  )

  const nameValue = nameCustom ? name : autoName
  const targetValue = targetLabelCustom ? targetLabel : autoTargetLabel
  const nameInvalid = !NAME_ALLOWED_RE.test(nameValue)
  const targetInvalid = !NAME_ALLOWED_RE.test(targetValue)

  useEffect(() => {
    void api
      .listPersonas()
      .then((r) => setPersonas((r as { personas: PersonaRow[] }).personas))
    // 角色 + 历史 Run 一起加载，据此把 TA 角色默认为「最近一次评测的角色」。
    void Promise.all([
      api.listRoles().then((r) => r.roles).catch(() => [] as TargetRole[]),
      api.listRuns().then((r) => (r as { runs: RunRow[] }).runs).catch(() => [] as RunRow[]),
    ]).then(([roleList, runList]) => {
      setRoles(roleList)
      setRuns(runList)
      const def = pickDefaultRole(roleList, runList)
      if (def) {
        setSelectedRole(def)
        setTaGender(def.gender)
      }
    })
  }, [])

  function handleRoleSelect(roleId: number) {
    const found = roles.find((r) => r.id === roleId)
    const role = found ?? null
    setSelectedRole(role)
    if (role) setTaGender(role.gender)
  }

  function toggleEndMode(mode: EndMode) {
    setEndModes((prev) => {
      const next = new Set(prev)
      if (mode === 'unlimited') {
        // exclusive: unlimited clears everything else
        return new Set<EndMode>(['unlimited'])
      }
      // toggling turns/duration: remove unlimited if present
      next.delete('unlimited')
      if (next.has(mode)) {
        next.delete(mode)
        // if nothing left, fall back to unlimited
        if (next.size === 0) return new Set<EndMode>(['unlimited'])
      } else {
        next.add(mode)
      }
      return next
    })
  }

  function buildEndCondition(): { maxTurns?: number; maxDurationSec?: number } {
    const cond: { maxTurns?: number; maxDurationSec?: number } = {}
    if (endModes.has('turns') && !endModes.has('unlimited')) {
      const v = Number(maxTurns)
      if (!isNaN(v) && v > 0) cond.maxTurns = v
    }
    if (endModes.has('duration') && !endModes.has('unlimited')) {
      const v = Number(maxDurationSec)
      if (!isNaN(v) && v > 0) cond.maxDurationSec = v
    }
    return cond
  }

  async function handleConnectionTest() {
    setTestLoading(true)
    setTestResult(null)
    try {
      const result = await api.connectionTest({
        targetBaseUrl: targetBaseUrl.trim(),
        taGender,
      })
      setTestResult(result as ConnectionTestResult)
    } catch (err) {
      setTestResult({
        ok: false,
        stage: 'network',
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setTestLoading(false)
    }
  }

  async function start() {
    if (selected.length === 0) return
    if (nameInvalid || targetInvalid) {
      setError(`名称不合法：${NAME_ALLOWED_HINT}`)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const cfg: Parameters<typeof api.createRun>[0] = {
        targetBaseUrl: targetBaseUrl.trim(),
        personaIds: selected,
        taGender,
        userModel,
        judgeModel,
        endCondition: buildEndCondition(),
        concurrency: Math.max(1, Math.min(16, Number(concurrency) || 2)),
        repetitions: Math.max(1, Math.min(50, Number(repetitions) || 1)),
      }
      if (nameValue.trim()) cfg.name = nameValue.trim()
      if (targetValue.trim()) cfg.targetLabel = targetValue.trim()
      if (replayFromRunId.trim()) cfg.replayFromRunId = replayFromRunId.trim()

      const r = (await api.createRun(cfg)) as { runId: string }
      // 记住本次角色，下次「新建评测」默认选它
      if (selectedRole) localStorage.setItem(LAST_ROLE_KEY, String(selectedRole.id))
      // 必须走 ui-store（内部会同步 sessionStorage），直写 sessionStorage 不会触发
      // Observe/Dashboard 的响应式订阅，导致新建后观战页仍盯着旧 runId
      setRunId(r.runId)
      nav('/')
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  const modeBtn = (mode: EndMode, label: string) => (
    <button
      type="button"
      onClick={() => toggleEndMode(mode)}
      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
        endModes.has(mode)
          ? 'bg-[#1664FF]/10 border-[#1664FF]/30 text-[#1664FF]'
          : 'bg-white border-[#E8E8EE] text-[#6B7280] hover:border-[#1664FF]/30 hover:text-[#1664FF]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div
      className="min-h-screen p-6"
      style={{
        background:
          'radial-gradient(50rem 30rem at 80% -10%, rgba(22,100,255,0.05), transparent 60%), #ffffff',
      }}
    >
      <div className="space-y-5">
        <h2 className="text-xl font-semibold text-[#15171E]">新建评测</h2>

        {/* ── Basic info ── */}
        <div className={sectionCls}>
          <p className={sectionTitleCls}>基本信息</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-[#6B7280]">Run 名称</label>
                {nameCustom && (
                  <button type="button" onClick={() => { setNameCustom(false); setName('') }} className="text-[11px] text-[#1664FF] hover:underline">恢复默认</button>
                )}
              </div>
              <input
                className={`${inputCls} ${nameInvalid ? '!border-[#DC2626] focus:!border-[#DC2626] focus:!ring-[#DC2626]/20' : ''}`}
                placeholder="自动生成：人设-角色-v1-日期"
                value={nameValue}
                onChange={(e) => { setName(e.target.value); setNameCustom(true) }}
                spellCheck={false}
              />
              <p className={`mt-1 text-[11px] leading-relaxed ${nameInvalid ? 'text-[#DC2626]' : 'text-[#9CA3AF]'}`}>
                {nameInvalid ? NAME_ALLOWED_HINT : '默认按「人设名-角色名-v版本-日期」自动生成（中文转拼音），不修改则每次自增版本号。'}
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-[#6B7280]">被测版本标注</label>
                {targetLabelCustom && (
                  <button type="button" onClick={() => { setTargetLabelCustom(false); setTargetLabel('') }} className="text-[11px] text-[#1664FF] hover:underline">恢复默认</button>
                )}
              </div>
              <input
                className={`${inputCls} ${targetInvalid ? '!border-[#DC2626] focus:!border-[#DC2626] focus:!ring-[#DC2626]/20' : ''}`}
                placeholder="自动生成：角色-v1-日期"
                value={targetValue}
                onChange={(e) => { setTargetLabel(e.target.value); setTargetLabelCustom(true) }}
                spellCheck={false}
              />
              <p className={`mt-1 text-[11px] leading-relaxed ${targetInvalid ? 'text-[#DC2626]' : 'text-[#9CA3AF]'}`}>
                {targetInvalid ? NAME_ALLOWED_HINT : '默认按「角色名-v版本-日期」自动生成，不修改则每次自增版本号。'}
              </p>
            </div>
          </div>
          <Field label="被测后端地址">
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={targetBaseUrl}
                placeholder="http://localhost:8680"
                onChange={(e) => setTargetBaseUrl(e.target.value)}
                spellCheck={false}
              />
              <button
                type="button"
                onClick={handleConnectionTest}
                disabled={testLoading || !targetBaseUrl.trim()}
                className="shrink-0 px-3 py-2 rounded-lg text-xs font-medium border border-[#1664FF]/30 text-[#1664FF] hover:bg-[#1664FF]/5 disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                {testLoading ? '测试中…' : '连接测试'}
              </button>
            </div>
          </Field>

          {/* Connection test result */}
          {testResult && (
            <div
              className={`rounded-lg px-4 py-3 text-xs space-y-1 border ${
                testResult.ok
                  ? 'bg-[#059669]/5 border-[#059669]/20 text-[#059669]'
                  : 'bg-[#DC2626]/5 border-[#DC2626]/20 text-[#DC2626]'
              }`}
            >
              {testResult.ok ? (
                <>
                  <p className="font-semibold">连接成功</p>
                  {testResult.tokenOk && (
                    <p className="text-[#059669]/80">Token: OK</p>
                  )}
                  {testResult.replyOk != null && (
                    <p className="text-[#059669]/80">
                      Reply: {testResult.replyOk ? 'OK' : '无响应'}
                    </p>
                  )}
                  {testResult.sampleReply && (
                    <p className="text-[#6B7280] italic truncate">
                      &ldquo;{testResult.sampleReply}&rdquo;
                    </p>
                  )}
                  <div className="flex gap-4 text-[#059669]/70">
                    {testResult.firstTokenMs != null && (
                      <span>首 Token {testResult.firstTokenMs} ms</span>
                    )}
                    {testResult.totalMs != null && (
                      <span>总耗时 {testResult.totalMs} ms</span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="font-semibold">
                    连接失败{testResult.stage ? `（${testResult.stage}）` : ''}
                  </p>
                  {testResult.error && (
                    <p className="text-[#DC2626]/80 font-mono break-all">
                      {testResult.error}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* ── TA config ── */}
        <div className={sectionCls}>
          <p className={sectionTitleCls}>TA 配置</p>
          <div className="grid grid-cols-3 gap-4">
            <Field label="TA 角色">
              {roles.length > 0 ? (
                <select
                  className={inputCls}
                  value={selectedRole?.id ?? ''}
                  onChange={(e) => handleRoleSelect(Number(e.target.value))}
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}（{r.gender === 1 ? '男' : '女'}）
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  className={inputCls}
                  value={taGender}
                  onChange={(e) => setTaGender(Number(e.target.value) as 1 | 2)}
                >
                  <option value={2}>女 (2)</option>
                  <option value={1}>男 (1)</option>
                </select>
              )}
            </Field>
            <Field label="模拟用户模型">
              <ModelSelect value={userModel} onChange={setUserModel} models={models} />
            </Field>
            <Field label="裁判模型">
              <ModelSelect value={judgeModel} onChange={setJudgeModel} models={models} />
            </Field>
          </div>
          {selectedRole && <RoleInfoCard role={selectedRole} />}
        </div>

        {/* ── End condition ── */}
        <div className={sectionCls}>
          <p className={sectionTitleCls}>结束条件</p>
          <div className="flex gap-2 mb-4">
            {modeBtn('turns', '轮数上限')}
            {modeBtn('duration', '时长上限')}
            {modeBtn('unlimited', '不限制')}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {endModes.has('turns') && !endModes.has('unlimited') && (
              <Field label="最大轮数">
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(Number(e.target.value))}
                />
              </Field>
            )}
            {endModes.has('duration') && !endModes.has('unlimited') && (
              <Field label="最大时长（秒）">
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  value={maxDurationSec}
                  onChange={(e) => setMaxDurationSec(Number(e.target.value))}
                />
              </Field>
            )}
          </div>
        </div>

        {/* ── Execution ── */}
        <div className={sectionCls}>
          <p className={sectionTitleCls}>执行参数</p>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="并发数（1–16）"
              hint="同时进行的会话数。越大整体跑得越快，但对被测后端和模型接口的压力也越大；本地联调建议 2–4。"
            >
              <input
                type="number"
                min={1}
                max={16}
                className={inputCls}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
              />
            </Field>
            <Field
              label="重复次数（1–50）"
              hint="每个人设独立重跑的次数。多次重复可摊平单次随机性、让评分更稳定（总会话数 = 人设数 × 重复次数）。"
            >
              <input
                type="number"
                min={1}
                max={50}
                className={inputCls}
                value={repetitions}
                onChange={(e) => setRepetitions(Number(e.target.value))}
              />
            </Field>
          </div>
          <Field
            label="A/B 回放：源 Run（可选）"
            hint="选择一个已完成的历史 Run，逐轮复用它的「用户台词」回放——用于 A/B 对比：只换被测后端版本/模型，保持用户输入完全一致。不选则由模拟用户实时生成。"
          >
            <RunPicker
              runs={finishedRuns}
              value={replayFromRunId}
              onChange={setReplayFromRunId}
              placeholder="选择源 Run（仅已完成；默认不回放，实时生成）"
              allowClear
              clearLabel="（不回放，实时生成）"
            />
          </Field>
        </div>

        {/* ── Personas ── */}
        <div className={sectionCls}>
          <p className={sectionTitleCls}>人设选择</p>
          {personas.length === 0 ? (
            <p className="text-[#6B7280] text-sm">
              暂无人设。请先在「人设库」页面创建人设。
            </p>
          ) : (
            <div className="space-y-2">
              {personas.map((p) => {
                const { gender, intent, tags } = personaMeta(p)
                const redteam = p.category === 'redteam'
                return (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 p-3 rounded-xl border border-[#E8E8EE] bg-white cursor-pointer hover:border-[#1664FF]/30 hover:bg-[#1664FF]/[0.02] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={(e) =>
                        setSelected((s) =>
                          e.target.checked
                            ? [...s, p.id]
                            : s.filter((x) => x !== p.id),
                        )
                      }
                      className="accent-[#1664FF] shrink-0"
                    />
                    <span className="text-sm text-[#15171E] shrink-0">{p.name}</span>
                    {gender && (
                      <span className="text-[11px] text-[#6B7280] shrink-0">
                        {gender === '男' ? '♂' : gender === '女' ? '♀' : ''} {gender}
                      </span>
                    )}
                    {/* 意图：占据剩余空间，超出单行省略 */}
                    {intent && (
                      <span className="text-xs text-[#9CA3AF] truncate min-w-0 flex-1" title={intent}>
                        意图：{intent}
                      </span>
                    )}
                    {/* 标签：最多 3 个，固定宽度不挤压，超出不换行 */}
                    {tags.length > 0 && (
                      <span className={`flex items-center gap-1 shrink-0 ${intent ? '' : 'ml-auto'}`}>
                        {tags.slice(0, 3).map((t) => (
                          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F7F8FB] border border-[#E8E8EE] text-[#6B7280] max-w-[6rem] truncate">
                            {t}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${!intent && tags.length === 0 ? 'ml-auto' : ''} ${redteam ? 'bg-[#DC2626]/10 text-[#DC2626]' : 'bg-[#1664FF]/10 text-[#1664FF]'}`}>
                      {redteam ? '对抗' : '普通'}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Error + Submit ── */}
        {error != null && <ErrorState error={error} title="无法开始评测" />}

        <button
          className="w-full px-6 py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #1664FF, #5B9CFF)' }}
          disabled={selected.length === 0 || loading || nameInvalid || targetInvalid}
          onClick={start}
        >
          {loading ? '启动中…' : '开始'}
        </button>
      </div>
    </div>
  )
}
