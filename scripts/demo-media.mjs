/**
 * Records the README demo video and screenshots in English and Chinese:
 *
 *   pnpm demo-media [en|zh]
 *     → docs/images/{en,zh}/demo.gif, docs/media/demo-{en,zh}.mp4
 *     → docs/images/{en,zh}/{new-run,observe,dashboard,report,compare,personas,roles}.png
 *
 * Everything runs on throwaway state: for each language it creates a fresh SQLite database
 * under .tmp/demo-media/, starts the example backend (pnpm mock) on port 4288 and the real api
 * on port 4289 with only the built-in demo model configured (no API key, your api/.env.dev is
 * not read), serves the built web app on port 4290 with /api and /ws proxied to the api, and
 * drives the locally installed Google Chrome with Playwright.
 *
 * Needs ffmpeg on PATH and Playwright's recorder (`pnpm exec playwright install ffmpeg`).
 * Set PW_CHANNEL= (empty) to use Playwright's bundled Chromium instead of Google Chrome.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API_DIR = join(ROOT, 'api')
const WORK = join(ROOT, '.tmp/demo-media')
const MOCK_PORT = 4288
const API_PORT = 4289
const WEB_PORT = 4290
const BASE = `http://localhost:${WEB_PORT}`
const CHANNEL = process.env.PW_CHANNEL ?? 'chrome'
const VIDEO = { width: 1280, height: 800 }
const SHOT_WIDTH = 1440
const REPO = 'github.com/AI-Pocket-Verse/chat-arena'
const LANGS = process.argv.slice(2).filter((a) => a === 'en' || a === 'zh')

// ── captions, demo data and UI strings the script clicks (must match web/src/i18n/messages/*.ts) ──
const TEXT = {
  en: {
    locale: 'en-US',
    personas: ['mia', 'redteam-boundary-en', 'leo'],
    personaNames: ['Mia', 'Boundary Tester', 'Leo'],
    redteamName: 'Boundary Tester',
    memoryPersona: 'Mia',
    role: 'Chloe (Female)',
    baseline: { name: 'mia-chloe-baseline', label: 'chloe-v1' },
    intro: {
      title: 'chat-arena',
      sub: 'Automated evaluation for character-chat backends',
      lines: ['LLM-simulated users hold multi-turn conversations with your chat backend', 'A judge model scores every reply: persona, empathy, memory, safety…', 'Red-team personas, memory probes, A/B comparison, optimization reports'],
    },
    outro: {
      title: 'Get started',
      sub: 'MIT licensed · ' + REPO,
      lines: [`git clone https://${REPO}.git`, 'cd chat-arena && pnpm install && pnpm bootstrap', 'pnpm mock   # example backend + demo model, no API key', 'pnpm dev    # open http://localhost:5040'],
    },
    cap: {
      config: 'Pick personas, the role under test, the models and when to stop',
      live: 'Conversations run in parallel; every reply is streamed and scored live',
      redteam: 'Red-team personas escalate turn by turn to probe safety boundaries',
      dashboard: 'Dashboard: scores per dimension, latency, violations, memory recall',
      report: 'One click: an optimization report with a revised system prompt',
      compare: 'Compare two runs to catch regressions after a prompt or model change',
      personas: 'Personas with memory probes: plant a fact, ask about it later',
      lang: 'English / 中文 UI, following the browser language by default',
    },
    ui: { start: 'Start', generate: 'Generate latest report', strengths: 'Strengths', pickA: 'Select Run A (baseline)', pickB: 'Select Run B (new version)', compare: 'Compare', other: '中文', system: 'System' },
  },
  zh: {
    locale: 'zh-CN',
    personas: ['linxiaoyu', 'redteam-boundary', 'xiaoming'],
    personaNames: ['林小雨', '越界试探者', '小明'],
    redteamName: '越界试探者',
    memoryPersona: '林小雨',
    role: '苏晚（女）',
    baseline: { name: 'linxiaoyu-suwan-baseline', label: 'suwan-v1' },
    intro: {
      title: 'chat-arena',
      sub: '角色陪聊类对话后端的自动化评测',
      lines: ['大模型扮演各种用户，和你的对话后端连续多轮对话', '裁判模型逐轮打分：人设、共情、记忆、安全……', '对抗测试、记忆考核、版本对比、优化报告'],
    },
    outro: {
      title: '开始使用',
      sub: 'MIT 开源协议 · ' + REPO,
      lines: [`git clone https://${REPO}.git`, 'cd chat-arena && pnpm install && pnpm bootstrap', 'pnpm mock   # 示例后端 + 演示模型，无需 API Key', 'pnpm dev    # 打开 http://localhost:5040'],
    },
    cap: {
      config: '选择人设、被测角色、模型和结束条件',
      live: '多个会话并发进行，回复流式显示，逐轮打分',
      redteam: '对抗人设逐轮升级施压，试探安全边界',
      dashboard: '数据看板：各维度得分、延迟、违规、记忆命中率',
      report: '一键生成优化报告，给出系统提示词修订版',
      compare: '版本对比：改了 prompt 或换了模型后，回归一目了然',
      personas: '人设可配置记忆考核：先埋一条事实，之后再反问',
      lang: '中文 / English 界面，默认跟随浏览器语言',
    },
    ui: { start: '开始', generate: '生成最新评测报告', strengths: '亮点', pickA: '选择 Run A（基线）', pickB: '选择 Run B（新版）', compare: '对比', other: 'English', system: '跟随系统' },
  },
}

// ── helpers ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...opts })
  if (r.status !== 0) throw new Error(`${cmd} failed: ${cmdArgs.join(' ')}`)
}
const ff = (a) => run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...a])

async function waitFor(check, what, ms = 60_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      if (await check()) return
    } catch {
      /* not ready yet */
    }
    await sleep(400)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** api 只拿演示所需的配置：不继承你的环境变量，也不读 api/.env.dev，所以不会用到任何真实模型 key */
function apiEnv(db) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(API_PORT),
    DATABASE_URL: `file:${db}`,
    TARGET_BASE_URL: `http://localhost:${MOCK_PORT}`,
    TARGET_DEBUG_KEY: 'mock-debug-key',
    DEMO_MODELS: 'demo',
    DEMO_BASE_URL: `http://localhost:${MOCK_PORT}/v1`,
    DEFAULT_MODEL: 'demo:demo',
  }
}

async function startStack(lang) {
  const dir = join(WORK, lang)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const env = apiEnv(join(dir, 'demo.db'))
  run('node', ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: API_DIR, env, stdio: 'ignore' })
  run('node_modules/.bin/tsx', ['src/seed/index.ts'], { cwd: API_DIR, env, stdio: 'ignore' })
  const mock = spawn('node', [join(ROOT, 'mock/server.mjs')], { env: { PATH: process.env.PATH, PORT: String(MOCK_PORT), MOCK_MODEL: 'off' }, stdio: 'ignore' })
  const api = spawn('node_modules/.bin/tsx', ['src/index.ts'], { cwd: API_DIR, env, stdio: 'ignore' })
  await waitFor(async () => (await fetch(`http://localhost:${MOCK_PORT}/v1/models`)).ok, 'example backend')
  await waitFor(async () => (await fetch(`http://localhost:${API_PORT}/api/ping`)).ok, 'api')
  // 演示库只留当前语言的示例人设，画面里不混另一种语言
  const other = TEXT[lang === 'en' ? 'zh' : 'en'].personas
  for (const id of other) await fetch(`http://localhost:${API_PORT}/api/personas/${id}`, { method: 'DELETE' })
  return () => Promise.all([mock, api].map((p) => new Promise((r) => { p.once('exit', r); p.kill('SIGTERM') })))
}

/** 托管 web/dist，/api 和 /ws 转给 api —— 和生产 nginx 的分工一样 */
function startWeb() {
  const dist = join(ROOT, 'web/dist')
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
  const server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      const up = request({ host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers)
        r.pipe(res)
      })
      up.on('error', () => { res.writeHead(502); res.end() })
      req.pipe(up)
      return
    }
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
    let file = join(dist, rel)
    if (!(await stat(file).then((s) => s.isFile(), () => false))) file = join(dist, 'index.html')
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })
  // WebSocket：原样转发握手和后续字节
  server.on('upgrade', (req, socket, head) => {
    const up = connect(API_PORT, '127.0.0.1', () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
      up.write(head)
      socket.pipe(up).pipe(socket)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
  })
  return new Promise((r) => server.listen(WEB_PORT, '127.0.0.1', () => r(server)))
}

const api = (lang, path, init = {}) =>
  fetch(`${BASE}${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-lang': lang, ...init.headers } }).then((r) => r.json())

async function waitRunDone(lang, runId) {
  await waitFor(async () => ['finished', 'failed', 'stopped'].includes((await api(lang, `/api/runs/${runId}`)).run.status), `run ${runId}`, 180_000)
}
async function latestRun(lang) {
  const { runs } = await api(lang, '/api/runs')
  return runs[0]
}

/** 先跑一次基线评测（不录），给「版本对比」用 */
async function baselineRun(lang) {
  const T = TEXT[lang]
  const r = await api(lang, '/api/runs', {
    method: 'POST',
    body: JSON.stringify({
      name: T.baseline.name, targetLabel: T.baseline.label, targetBaseUrl: `http://localhost:${MOCK_PORT}`,
      personaIds: T.personas, taGender: 2, userModel: 'demo:demo', judgeModel: 'demo:demo',
      endCondition: { maxTurns: 6 }, concurrency: 3, repetitions: 1,
    }),
  })
  if (!r.runId) throw new Error(`baseline run failed: ${JSON.stringify(r)}`)
  await waitRunDone(lang, r.runId)
}

/** 录屏里看不到系统鼠标：注入指针、字幕条和全屏标题卡 */
async function installOverlay(page) {
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const font = 'font-family:Inter,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif'
      const dot = document.createElement('div')
      dot.style.cssText =
        'position:fixed;z-index:2147483647;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;' +
        'background:rgba(22,100,255,.3);border:2px solid rgba(22,100,255,.95);pointer-events:none;transition:transform .12s;left:-50px;top:-50px'
      document.addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px` })
      document.addEventListener('mousedown', () => (dot.style.transform = 'scale(.65)'))
      document.addEventListener('mouseup', () => (dot.style.transform = 'scale(1)'))
      const cap = document.createElement('div')
      cap.style.cssText =
        `position:fixed;z-index:2147483646;left:50%;bottom:28px;transform:translateX(-50%);max-width:90%;${font};` +
        'background:rgba(17,24,39,.88);color:#fff;font-size:21px;font-weight:600;padding:12px 26px;border-radius:14px;' +
        'box-shadow:0 8px 30px rgba(0,0,0,.25);pointer-events:none;opacity:0;transition:opacity .3s;white-space:nowrap'
      const card = document.createElement('div')
      card.style.cssText =
        `position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;align-items:center;justify-content:center;${font};` +
        'background:linear-gradient(135deg,#1664FF,#7c3aed);color:#fff;text-align:center;opacity:0;pointer-events:none;transition:opacity .5s'
      document.body.append(card, cap, dot)
      window.__demo = {
        caption(text) { cap.textContent = text; cap.style.opacity = text ? '1' : '0' },
        card({ title, sub, lines, code }) {
          const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
          const items = lines
            .map((l) => code
              ? `<div style="font-family:ui-monospace,Menlo,monospace;font-size:20px;background:rgba(0,0,0,.28);padding:10px 22px;border-radius:10px;margin:6px 0;text-align:left;min-width:760px">$ ${esc(l)}</div>`
              : `<div style="font-size:23px;margin:8px 0;opacity:.95">✓ ${esc(l)}</div>`)
            .join('')
          card.innerHTML =
            `<div style="font-size:64px;font-weight:800;letter-spacing:-.02em">${esc(title)}</div>` +
            `<div style="font-size:26px;opacity:.9;margin:14px 0 36px">${esc(sub)}</div><div>${items}</div>`
          card.style.opacity = '1'
          dot.style.opacity = '0'
        },
        hideCard() { card.style.opacity = '0'; dot.style.opacity = '1' },
      }
    })
  })
}
const caption = (page, text) => page.evaluate((t) => window.__demo.caption(t), text)

/** 平滑移动到元素中心再点击，录屏里能看清在点哪 */
async function moveTo(page, locator, pause = 300) {
  await locator.waitFor()
  await locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  await page.waitForTimeout(500)
  const box = await locator.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 })
  await page.waitForTimeout(pause)
}
async function moveClick(page, locator, pause = 300) {
  await moveTo(page, locator, pause)
  await page.mouse.down()
  await page.mouse.up()
}
async function scrollTo(page, locator, pause = 2000) {
  await locator.waitFor()
  await locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  await page.waitForTimeout(pause)
}

/** 新建评测页：选角色、6 轮、并发 3、勾选三个人设 */
async function fillConfig(page, T, smooth) {
  const click = (loc) => (smooth ? moveClick(page, loc) : loc.click())
  await page.getByRole('checkbox', { name: new RegExp(`^${T.personaNames[0]}`) }).waitFor()
  await page.getByRole('combobox').first().selectOption(T.role)
  await page.getByRole('spinbutton').first().fill('6')
  await page.getByRole('spinbutton').nth(1).fill('3')
  for (const n of T.personaNames) await click(page.getByRole('checkbox', { name: new RegExp(`^${n}`) }))
}
/** 实时评测页切到对抗人设的会话（会话标签只显示 id，逐个点开找） */
async function openRedteamSession(page, T, smooth) {
  const tabs = page.locator('button', { hasText: /^…[0-9a-f]{8}$/ })
  await tabs.first().waitFor()
  for (let i = 0; i < (await tabs.count()); i++) {
    if (smooth) await moveClick(page, tabs.nth(i)); else await tabs.nth(i).click()
    await page.waitForTimeout(800)
    if (await page.getByText(T.redteamName).first().isVisible().catch(() => false)) return
  }
}
async function pickCompare(page, T, a, b, smooth) {
  const click = (loc) => (smooth ? moveClick(page, loc) : loc.click())
  await click(page.getByText(T.ui.pickA))
  await click(page.getByText(a).first())
  await click(page.getByText(T.ui.pickB))
  await click(page.getByText(b).last())
  await click(page.getByRole('button', { name: T.ui.compare, exact: true }))
  await page.waitForTimeout(1500)
}
async function generateReport(page, T, smooth) {
  const btn = page.getByRole('button', { name: T.ui.generate })
  if (smooth) await moveClick(page, btn); else await btn.click()
  await page.getByText(T.ui.strengths, { exact: true }).first().waitFor({ timeout: 60_000 })
  await page.waitForTimeout(800)
}

// ── recording ───────────────────────────────────────────────────────────
async function record(browser, lang) {
  const T = TEXT[lang]
  const base = await latestRun(lang)
  const rawDir = join(WORK, `raw-${lang}`)
  await rm(rawDir, { recursive: true, force: true })
  const context = await browser.newContext({ viewport: VIDEO, locale: T.locale, recordVideo: { dir: rawDir, size: VIDEO } })
  const t0 = Date.now()
  const page = await context.newPage()
  await installOverlay(page)
  await page.goto(`${BASE}/config`)
  await page.evaluate((c) => window.__demo.card(c), T.intro)
  const trim = (Date.now() - t0) / 1000 + 0.6
  await page.getByRole('checkbox', { name: new RegExp(`^${T.personaNames[0]}`) }).waitFor()
  await page.waitForTimeout(4500)
  await page.evaluate(() => window.__demo.hideCard())
  await page.waitForTimeout(700)

  // 1. 新建评测
  await caption(page, T.cap.config)
  await fillConfig(page, T, true)
  await moveClick(page, page.getByRole('button', { name: T.ui.start, exact: true }))
  await page.waitForURL((u) => !u.pathname.startsWith('/config'))
  // 2. 实时评测
  await caption(page, T.cap.live)
  await page.waitForTimeout(5000)
  await caption(page, T.cap.redteam)
  await openRedteamSession(page, T, true)
  await page.waitForTimeout(5000)
  const current = await latestRun(lang)
  await waitRunDone(lang, current.id)
  await page.waitForTimeout(1000)
  // 3. 数据看板
  await caption(page, T.cap.dashboard)
  await page.goto(`${BASE}/dashboard`)
  await page.waitForTimeout(2500)
  await page.mouse.move(VIDEO.width / 2, 500, { steps: 10 })
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 260); await page.waitForTimeout(600) }
  await page.waitForTimeout(800)
  // 4. 优化报告
  await caption(page, T.cap.report)
  await page.goto(`${BASE}/reports`)
  await page.waitForTimeout(1200)
  await generateReport(page, T, true)
  await scrollTo(page, page.getByText(T.ui.strengths, { exact: true }).first(), 2200)
  await page.mouse.move(VIDEO.width / 2, 500, { steps: 10 })
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(700) }
  await page.waitForTimeout(1200)
  // 5. 版本对比
  await caption(page, T.cap.compare)
  await page.goto(`${BASE}/compare`)
  await page.waitForTimeout(1000)
  await pickCompare(page, T, base.name, current.name, true)
  await page.waitForTimeout(2200)
  // 6. 人设库
  await caption(page, T.cap.personas)
  await page.goto(`${BASE}/personas`)
  await page.waitForTimeout(800)
  await moveClick(page, page.getByRole('button', { name: new RegExp(T.memoryPersona) }).first())
  await page.waitForTimeout(1500)
  await scrollTo(page, page.getByText(/cat_name/).first(), 2200)
  // 7. 切换语言
  await caption(page, T.cap.lang)
  await moveClick(page, page.locator('header button[aria-haspopup="menu"]'))
  await page.waitForTimeout(500)
  await moveClick(page, page.getByRole('menuitemradio', { name: T.ui.other }))
  await page.waitForTimeout(2200)
  await moveClick(page, page.locator('header button[aria-haspopup="menu"]'))
  await page.waitForTimeout(500)
  await moveClick(page, page.getByRole('menuitemradio').first())
  await page.waitForTimeout(1200)
  // 结尾卡片
  await caption(page, '')
  await page.evaluate((c) => window.__demo.card({ ...c, code: true }), T.outro)
  await page.waitForTimeout(5500)
  await context.close()

  const [webm] = (await readdir(rawDir)).filter((f) => f.endsWith('.webm'))
  const src = join(rawDir, webm)
  const mediaDir = join(ROOT, 'docs/media')
  const imgDir = join(ROOT, 'docs/images', lang)
  await mkdir(mediaDir, { recursive: true })
  await mkdir(imgDir, { recursive: true })
  const mp4 = join(mediaDir, `demo-${lang}.mp4`)
  const gif = join(imgDir, 'demo.gif')
  ff(['-ss', trim.toFixed(2), '-i', src, '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4])
  // GIF 从压好的 MP4 转：录屏原始 webm 的编码噪点会让 GIF 体积翻倍
  ff([
    '-i', mp4,
    '-vf', 'fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0', gif,
  ])
  await rm(rawDir, { recursive: true, force: true })
  console.log(`  ✓ docs/media/demo-${lang}.mp4`)
  console.log(`  ✓ docs/images/${lang}/demo.gif`)
}

// ── screenshots ─────────────────────────────────────────────────────────
async function screenshots(browser, lang) {
  const T = TEXT[lang]
  const dir = join(ROOT, 'docs/images', lang)
  await mkdir(dir, { recursive: true })
  const context = await browser.newContext({ viewport: { width: SHOT_WIDTH, height: 900 }, locale: T.locale })
  const page = await context.newPage()
  const shot = async (name, height = 900) => {
    await page.setViewportSize({ width: SHOT_WIDTH, height })
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(dir, `${name}.png`) })
    await page.setViewportSize({ width: SHOT_WIDTH, height: 900 })
  }
  const base = (await api(lang, '/api/runs')).runs.at(-1)

  await page.goto(`${BASE}/config`)
  await fillConfig(page, T, false)
  await shot('new-run', 1440)
  await page.getByRole('button', { name: T.ui.start, exact: true }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/config'))
  await page.waitForTimeout(6000)
  await openRedteamSession(page, T, false)
  await page.waitForTimeout(1500)
  await shot('observe')
  const current = await latestRun(lang)
  await waitRunDone(lang, current.id)

  await page.goto(`${BASE}/dashboard`)
  await page.waitForTimeout(2500)
  await shot('dashboard', 1060)

  await page.goto(`${BASE}/reports`)
  await page.waitForTimeout(1000)
  await generateReport(page, T, false)
  await page.setViewportSize({ width: SHOT_WIDTH, height: 1225 })
  await scrollTo(page, page.getByText(T.ui.strengths, { exact: true }).first(), 800)
  await page.evaluate(() => document.querySelectorAll('*').forEach((el) => { if (el.scrollTop > 0) el.scrollTop -= 120 }))
  await shot('report', 1225)

  await page.goto(`${BASE}/compare`)
  await page.waitForTimeout(1000)
  await pickCompare(page, T, base.name, current.name, false)
  await shot('compare', 660)

  await page.goto(`${BASE}/personas`)
  await page.getByRole('button', { name: new RegExp(T.memoryPersona) }).first().click()
  await page.waitForTimeout(1000)
  await shot('personas')

  await page.goto(`${BASE}/roles`)
  await page.waitForTimeout(1500)
  await shot('roles')
  await context.close()
  console.log(`  ✓ docs/images/${lang}/*.png`)
}

// ── main ────────────────────────────────────────────────────────────────
await mkdir(WORK, { recursive: true })
run('pnpm', ['--filter', '@chat-arena/web', 'build'], { cwd: ROOT, stdio: 'ignore' })
const web = await startWeb()
const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {})
try {
  for (const lang of LANGS.length ? LANGS : ['en', 'zh']) {
    console.log(`demo media (${lang})…`)
    const stop = await startStack(lang)
    try {
      await baselineRun(lang)
      await record(browser, lang)
      await screenshots(browser, lang)
    } catch (e) {
      const shot = join(WORK, `failed-${lang}.png`)
      await browser.contexts().at(-1)?.pages().at(-1)?.screenshot({ path: shot }).catch(() => {})
      console.error(`  ✗ failed, screenshot: ${shot}`)
      throw e
    } finally {
      await stop()
    }
  }
} finally {
  await browser.close()
  web.close()
}
