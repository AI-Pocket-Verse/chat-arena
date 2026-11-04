# chat-arena

English | [中文](README-CN.md)

Automated evaluation for character-chat (AI companion / role-play) backends. LLM-simulated users ("personas") hold multi-turn conversations with the backend under test, a judge model scores every reply, and the results roll up into a dashboard and an optimization report. Change a prompt or swap a model, run it again, and see whether things got better or worse.

![Live evaluation: several conversations run in parallel, each reply is streamed and scored as it arrives](docs/images/observe.png)

- **Simulated users**: personas define age, occupation, personality, speaking style and intent. Let AI draft a persona from a short description, reverse-engineer one from a system prompt, or import one from text / Markdown.
- **Red-team testing**: "red-team" personas escalate pressure turn by turn to probe the safety boundaries of the AI under test; the judge applies a stricter safety review and counts violations.
- **Memory probes**: the simulated user drops a fact at turn N and asks about it at turn M; chat-arena reports the recall rate.
- **Live view**: many conversations run concurrently; the page streams each conversation and its per-turn scores in real time.
- **Dashboard and comparison**: first-token latency, reply length, per-dimension scores, violation rate and memory recall; compare two runs side by side.
- **A/B replay**: re-run an evaluation with exactly the same user messages, changing only the backend version.
- **Optimization report**: the judge summarizes strengths, weaknesses and safety issues, and proposes a revised system prompt for the role with a line-by-line diff.
- **Switchable models**: simulated users and the judge can each use a different model -- OpenAI, Anthropic, Doubao, Qwen, DeepSeek, Zhipu GLM, Kimi, MiniMax, or any OpenAI-compatible server such as Ollama.
- **Try it with no backend and no API key**: the bundled example backend plays two characters, and a built-in demo model simulates every model call (simulated users, judge, report), so the whole flow runs out of the box. Add a real model key when you want real results.

The web UI is in Simplified Chinese. Stack: Fastify + Prisma (SQLite) backend, React + Vite + Tailwind frontend, managed as a pnpm workspace.

## Screenshots

New evaluation: pick personas, the role under test, the simulated-user model and the judge model, and the end condition.

![New evaluation](docs/images/new-run.png)

Dashboard: overall and per-dimension scores, latency, reply length, violations and memory recall for one run.

![Dashboard](docs/images/dashboard.png)

Optimization report: strengths, weaknesses, safety issues and a revised system prompt with a diff against the original.

![Report](docs/images/report.png)

Version comparison: score, violation, memory and latency deltas between a baseline run and a new run, plus a radar chart.

![Version comparison](docs/images/compare.png)

Persona library: normal and red-team personas, with memory probes and red-team tactics.

![Persona library](docs/images/personas.png)

AI roles: the roles exposed by the backend under test, with their persona sections and full system prompt.

![AI roles](docs/images/roles.png)

All personas, roles and conversations in the screenshots are fictional: the example personas created by `pnpm bootstrap` talking to the example backend, with the built-in demo model standing in for real models. The scores and report text therefore come from simple rules, not from a real judge.

## How it works

```
 persona library ─┐
                  ▼
        ┌──────────────────┐   user message    ┌──────────────────────┐
        │  simulated user  │ ────────────────▶ │  backend under test  │
        │  (LLM, persona)  │ ◀──────────────── │  (your chat service) │
        └──────────────────┘   streamed reply  └──────────────────────┘
                  │
                  ▼
        ┌──────────────────┐
        │   judge (LLM)    │  scores every turn on 6 dimensions,
        └──────────────────┘  checks safety and memory recall
                  │
                  ▼
     live view · dashboard · comparison · report
```

For every persona (× repetitions) chat-arena mints a fresh test account on the backend, then loops: the simulated user writes the next message in character, the backend streams its reply, and the judge scores the turn. A conversation ends at the turn or time limit, on manual stop, or after several consecutive backend errors.

The judge scores each turn from 1 to 10 on six dimensions: persona fit, empathy, memory accuracy, safety, naturalness and relevance, plus an overall score, a comment, an improvement suggestion and a violation flag.

## Requirements

- Node.js ≥ 20.19 (22 or 24 recommended) and pnpm 9
- For real results, an API key from at least one model provider (see [Model configuration](#model-configuration)), or a local Ollama. Not needed to try it out: the built-in demo model works without any key.

## Quick start

```bash
git clone https://github.com/AI-Pocket-Verse/chat-arena.git
cd chat-arena
pnpm install     # install dependencies and generate the Prisma client
pnpm bootstrap   # copy api/.env.example to api/.env.dev, create the local SQLite database, add 3 example personas
```

Start the example backend and the app in two terminals:

```bash
pnpm mock        # example backend under test and the demo model, on :8680
pnpm dev         # api on :4040 and web on :5040
```

Open <http://localhost:5040>, go to "新建评测" (New evaluation), tick the example personas, keep the model drop-downs on "演示 · demo" and click "开始" (Start). You land on "实时评测" (Live evaluation) and can watch the conversations as they happen. When the run finishes, look at "数据看板" (Dashboard) and generate a report under "评测报告" (Reports).

This first run uses the **demo model**: no API key, no cost, rule-generated content. To evaluate for real, add a model to `api/.env.dev` -- for example Qwen (Alibaba Cloud Model Studio):

```bash
QWEN_API_KEY=sk-...
QWEN_MODELS=qwen-plus
DEFAULT_MODEL=qwen:qwen-plus
```

Restart `pnpm dev` and `pnpm mock`, then pick the model on the "New evaluation" page. Every turn calls the model, so more turns cost more. With a real model configured, the example backend also uses it to play the characters.

By default the app runs in **local single-user mode**: no login, and the local user is the admin. The api startup log lists the models that are ready (`models ready: ...`); if you pick a model without a key, starting an evaluation tells you which variable to set.

## Model configuration

All providers are called through OpenAI-compatible endpoints. Each provider has three settings in `api/.env.dev` (or `api/.env.prod`):

| Setting | Meaning |
| --- | --- |
| `<PREFIX>_API_KEY` | API key |
| `<PREFIX>_MODELS` | Model names, comma separated. Every model listed here shows up in the model drop-downs as `<provider>:<model>` |
| `<PREFIX>_BASE_URL` | Optional; empty uses the official endpoint |

| Provider | Prefix | Model id example | Get a key |
| --- | --- | --- | --- |
| OpenAI | `OPENAI` | `openai:gpt-5` | [API keys](https://platform.openai.com/api-keys) |
| Anthropic | `ANTHROPIC` | `anthropic:claude-sonnet-5-5` | Claude Console; called through Anthropic's [OpenAI SDK compatibility](https://platform.claude.com/docs/en/api/openai-sdk) endpoint |
| Volcano Engine Ark (Doubao) | `ARK` | `doubao:doubao-seed-1-6` | [Ark console](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) |
| Alibaba Cloud Model Studio (Qwen) | `QWEN` | `qwen:qwen-plus` | [Get an API key](https://help.aliyun.com/zh/model-studio/get-api-key) |
| DeepSeek | `DEEPSEEK` | `deepseek:deepseek-chat` | [API keys](https://platform.deepseek.com/api_keys) |
| Zhipu (GLM) | `ZHIPU` | `zhipu:glm-4.6` | [Zhipu console](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) |
| Moonshot (Kimi) | `KIMI` | `kimi:kimi-k2-turbo-preview` | [Kimi console](https://platform.moonshot.cn/console/api-keys) |
| MiniMax | `MINIMAX` | `minimax:MiniMax-M2` | [How to get an API key](https://platform.minimaxi.com/docs/faq/about-apis) |
| Any OpenAI-compatible server | `CUSTOM` | `custom:qwen3:8b` | Set `CUSTOM_BASE_URL`, e.g. Ollama at `http://127.0.0.1:11434/v1`, vLLM, LM Studio or OpenRouter; the key may be empty |
| Demo model | `DEMO` | `demo:demo` | No key. Served by `pnpm mock`; enabled by default with `DEMO_MODELS=demo` |

The model ids above are only examples; use the model names your account has access to. Several models from the same provider: `QWEN_MODELS=qwen-plus,qwen-max`.

The **demo model** ([`mock/demo-model.mjs`](mock/demo-model.mjs)) answers every kind of request chat-arena sends -- simulated user messages, per-turn scores, memory checks, the report and the persona library's AI features -- with rule-based content, so you can explore the app and develop against it without a key. Its output is for demonstration only. Remove `DEMO_MODELS=demo` from `api/.env.dev` once you use real models if you don't want it in the drop-downs.

`DEFAULT_MODEL` (e.g. `qwen:qwen-plus`) is preselected on the "New evaluation" page and is used by the persona library's AI features and by the example backend. When it is empty, the first configured model is used.

Notes:

- The provider list lives in [`shared/providers.json`](shared/providers.json), shared by the api and the example backend. To add a provider, add an entry there and document its variables in `api/.env.example`.
- Anthropic's compatibility layer does not accept `temperature` on recent models or `response_format: json_object`, so chat-arena omits both for that provider and parses JSON from plain text.
- Restart `pnpm dev` after changing models or keys.

## The backend under test

The backend must implement three endpoints: mint a test account, list roles, and stream a chat reply. See [docs/target-protocol.md](docs/target-protocol.md).

### Example backend

`pnpm mock` starts [`mock/server.mjs`](mock/server.mjs), a dependency-free implementation of the protocol with two fictional roles. It reads `api/.env.dev`:

- With a real model configured, it role-plays the selected role with that model and streams real replies (keeping the conversation history per test account), so the whole pipeline -- latency, memory, safety -- behaves like a real backend. This costs model calls.
- Without a real model, or with `MOCK_MODEL=off`, the demo model writes the replies (remembering facts, refusing most boundary-crossing requests and occasionally slipping, so violations show up in the results). It costs nothing.
- `MOCK_MODEL=<provider>:<model>` picks a different model for the backend than for the judge, e.g. a small model as the backend and a strong one as the judge.
- It also serves the demo model's OpenAI-compatible endpoint at `http://localhost:8680/v1`.

The example backend is also a starting point for wrapping your own service: replace the model call in `/chat` with a call to your real chat API.

### Connecting a real backend

Set `TARGET_BASE_URL` (the endpoint prefix) and `TARGET_DEBUG_KEY` in `api/.env.dev`; `TARGET_HEADERS` adds extra request headers. You can also change the backend address on the "New evaluation" page, but only to origins listed in `TARGET_ALLOWED_ORIGINS` (see [Security](#security)).

## Configuration

The api loads its settings with Node's built-in `--env-file`: `pnpm dev` reads `api/.env.dev` and `pnpm start` reads `api/.env.prod`. Neither is committed; the template is [`api/.env.example`](api/.env.example), with a comment on every setting. Model settings are described above.

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | -- | SQLite path, relative to `api/prisma/`; use an absolute path in production |
| `HOST` / `PORT` | `127.0.0.1` / `4040` | Address the api listens on |
| `NODE_ENV` | `development` | Set to `production` when deploying |
| `TARGET_BASE_URL` | `http://localhost:8680` | Backend under test (with path prefix); the default address on the "New evaluation" page |
| `TARGET_ALLOWED_ORIGINS` | empty | Other backend origins the app may talk to, comma separated (e.g. `https://a.example.com`). The origin of `TARGET_BASE_URL` is always allowed |
| `TARGET_DEBUG_KEY` | empty | Key for the backend's `/debug/*` endpoints |
| `TARGET_HEADERS` | empty | Extra request headers for the backend, as a JSON object |
| `DEFAULT_MODEL` | first configured model | See [Model configuration](#model-configuration) |
| `MOCK_MODEL` | `DEFAULT_MODEL` | Model the example backend uses to play its roles; `off` for demo-model replies |
| `ALLOWED_HOSTS` | empty | Local mode only: extra host names (domain or LAN IP) the app may be accessed through, comma separated |
| `WHOAMI_URL` | not set | Enables login, see below |
| `ADMIN_MOBILES` | empty | With login enabled: admin phone numbers, comma separated; admins can delete reports |
| `CORS_ORIGINS` | empty | Frontend origins allowed to call the api cross-origin, space separated; leave empty for same-origin deployments |
| `TRUST_PROXY` | `loopback` | Trusted reverse proxies (`loopback`, IP / CIDR list, `true` / `false`); decides the client IP used for rate limiting |
| `MAX_TURNS` | `6` | Turns for the command-line smoke test `api/src/cli/run-once.ts` |

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm bootstrap` | Create `api/.env.dev` (if missing), the local database and the example personas |
| `pnpm dev` | Development mode (the web app proxies `/api` and `/ws` to the api through Vite) |
| `pnpm mock` | Example backend; `PORT`, `DEBUG_KEY` and `MOCK_MODEL` can be overridden |
| `pnpm build` | Build the api (`api/dist`) and the web app (`web/dist`) |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test` | Run all unit tests |
| `pnpm --filter @chat-arena/api db:migrate` | Create and apply a migration after editing `api/prisma/schema.prisma` |

## Security

- **Local mode has no login.** Anyone who can reach the api can start evaluations with your model keys, so the api listens on `127.0.0.1` by default and only accepts requests whose `Host` / `Origin` is the local machine. This blocks other web sites (including DNS-rebinding attacks) from driving it through your browser. To use the app from another device or domain in local mode, add that host name to `ALLOWED_HOSTS` -- everyone who can reach it can then use it.
- **Backend allowlist.** `TARGET_DEBUG_KEY` and `TARGET_HEADERS` are sent to the backend, so every endpoint that takes a backend address only accepts the origins in `TARGET_BASE_URL` and `TARGET_ALLOWED_ORIGINS` and answers anything else with `target_not_allowed`. Redirects from the backend are not followed, so the key cannot be bounced to another host.
- **Cost limits.** A conversation has at most 200 turns and 24 hours, a run at most 100 personas, 50 repetitions and a concurrency of 16.
- Model keys stay on the server: the model list endpoint returns model ids and readiness only.
- Found a security issue? Please report it privately through the repository's Security tab ("Report a vulnerability") instead of opening a public issue.

## Optional: Feishu (Lark) login

For multi-user deployments, chat-arena can use [feishu-sso](https://github.com/AI-Pocket-Verse/feishu-sso), a companion open-source login service:

1. Deploy feishu-sso and have the reverse proxy forward `/auth/*` on the same domain to it (the login cookie relies on the same origin).
2. Set `WHOAMI_URL` on the api to feishu-sso's whoami endpoint, e.g. `http://127.0.0.1:4020/api/whoami`.
3. Build the web app with `VITE_SSO_BASE=/auth` (e.g. in `web/.env.local`).
4. Optionally set `ADMIN_MOBILES`. The Feishu app needs permission to read phone numbers; otherwise nobody is recognized as an admin.

With login enabled, every route except health checks requires a session (401 otherwise), and each run records who started it.

## Deployment

`deploy/` contains systemd and nginx templates for a single-host deployment (nginx serves the built frontend and proxies the api and WebSocket):

```bash
git clone https://github.com/AI-Pocket-Verse/chat-arena.git /opt/chat-arena && cd /opt/chat-arena
pnpm install && pnpm build
cp api/.env.example api/.env.prod   # NODE_ENV=production, absolute DATABASE_URL, backend, models, and login (WHOAMI_URL)
chmod 600 api/.env.prod
pnpm --filter @chat-arena/api db:migrate:prod

sudo cp deploy/systemd.service.template /etc/systemd/system/chat-arena.service
sudo sed -i 's|__INSTALL_DIR__|/opt/chat-arena|; s|__SERVICE_USER__|www-data|' /etc/systemd/system/chat-arena.service
sudo systemctl daemon-reload && sudo systemctl enable --now chat-arena

sudo cp deploy/nginx.conf.template /etc/nginx/sites-available/chat-arena
sudo sed -i 's|__INSTALL_DIR__|/opt/chat-arena|; s|__SERVER_NAME__|arena.example.com|' /etc/nginx/sites-available/chat-arena
sudo ln -sf /etc/nginx/sites-available/chat-arena /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```

- Enable login (`WHOAMI_URL`) for any deployment others can reach. Without it the api rejects requests for `arena.example.com` unless you list that host in `ALLOWED_HOSTS`, which makes the app usable by anyone who can reach it.
- Put HTTPS in front (e.g. `certbot --nginx`); the login cookie should not travel over plain HTTP.
- The nginx template only exposes `/api/` and `/ws/`, overwrites `X-Forwarded-For` with `$remote_addr` and adds basic security headers. The api trusts only a local proxy by default (`TRUST_PROXY=loopback`); if nginx runs on another machine, set `TRUST_PROXY` to its address.
- The service user must be able to write the directory that holds `DATABASE_URL`.

## Project layout

```
api/        Fastify api: orchestration, simulated users, judge, memory probes, reports, live push
web/        React frontend
shared/     Types shared by api and web, and the model provider list (providers.json)
mock/       Example backend under test and the demo model (dependency-free Node scripts)
packages/   Small shared packages (login client, HTTP client, theme tokens, Tailwind preset, ...)
deploy/     systemd / nginx templates
docs/       Backend protocol and screenshots
```

## Credits

- The robot icon in the top bar and favicon is adapted from the `bot` icon of [Lucide](https://lucide.dev) (ISC License).

## License

[MIT](LICENSE)
