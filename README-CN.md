# chat-arena

[English](README.md) | 中文

角色陪聊类（AI 陪伴 / 角色扮演）对话后端的自动化评测：用大模型扮演各种用户（「人设」），和被测后端连续多轮对话，裁判模型逐轮打分，最后汇总成看板和优化报告。改了 prompt 或换了模型后跑一遍，就能看出变好还是变差。

![演示：新建评测、实时观战、数据看板、优化报告、版本对比、人设库与语言切换](docs/images/zh/demo.gif)

<sub>约 75 秒的操作演示，使用内置演示模型录制。[观看 MP4 版](docs/media/demo-zh.mp4) · [English demo](README.md)</sub>

- **模拟用户**：人设定义年龄、职业、性格、说话风格、来意；可以让 AI 从一段描述生成人设、从系统提示词反推，或从文本 / Markdown 导入
- **对抗测试**：「对抗」类人设会逐轮升级施压，试探被测 AI 的安全边界，裁判对这类会话加严安全审查并统计违规
- **记忆考核**：模拟用户在第 N 轮埋下一条事实，第 M 轮再反问，统计记忆命中率
- **实时观战**：多个会话并发进行，页面实时显示对话流和每轮评分
- **看板与对比**：首字延迟、回复长度、各维度得分、违规率、记忆命中率；两次评测逐项对比
- **A/B 回放**：复用某次评测的用户台词重跑，只换被测版本，保证输入完全一致
- **优化报告**：裁判模型总结优缺点和安全问题，并基于被测角色的系统提示词给出修订版，可逐行对比原文
- **模型可切换**：模拟用户和裁判可以分别选用不同模型，支持 OpenAI、Anthropic、豆包、千问、DeepSeek、智谱 GLM、Kimi、MiniMax，以及 Ollama 等任意 OpenAI 兼容服务
- **中英文双语**：界面默认跟随浏览器语言，可在顶栏切换；每次评测按发起人的界面语言进行，模拟用户台词、裁判点评和报告都用这种语言
- **没有后端、没有 API Key 也能体验**：自带的示例后端扮演两个角色，内置的演示模型模拟所有模型调用（模拟用户、裁判、报告），装好就能跑完整流程；想要真实结果时再配置模型 key

技术栈：Fastify + Prisma（SQLite）后端，React + Vite + Tailwind 前端，pnpm workspace 管理。

## 截图

实时评测：多个会话并发进行，回复流式显示，每轮出分。图中对抗人设逐轮施压，被测角色一时失守，裁判当即标记违规。

![实时评测](docs/images/zh/observe.png)

新建评测：选择人设、被测角色、模拟用户模型和裁判模型，以及结束条件。

![新建评测](docs/images/zh/new-run.png)

数据看板：单次评测的总分与各维度得分、延迟、回复长度、违规和记忆命中率。

![数据看板](docs/images/zh/dashboard.png)

优化报告：优点、问题、安全问题，以及系统提示词修订版和原文的逐行对比。

![评测报告](docs/images/zh/report.png)

版本对比：基线评测与新评测的总分、违规、记忆、延迟差值，以及维度雷达图。

![版本对比](docs/images/zh/compare.png)

用户人设库：普通人设和对抗人设，可配置记忆考核和对抗策略。

![用户人设库](docs/images/zh/personas.png)

AI 角色库：被测后端提供的角色，含分段人设和完整系统提示词。

![AI 角色库](docs/images/zh/roles.png)

截图中的人设、角色和对话均为虚构：`pnpm bootstrap` 写入的示例人设与示例后端对话，由内置演示模型代替真实模型，所以分数和报告内容由简单规则生成，并非真实裁判的结论。演示和截图可以用 `pnpm demo-media` 重新录制（见[常用命令](#常用命令)）。

## 工作原理

```
   人设库 ─┐
           ▼
   ┌──────────────┐    用户消息     ┌────────────────┐
   │   模拟用户    │ ─────────────▶ │   被测后端      │
   │ （大模型扮演） │ ◀───────────── │ （你的对话服务） │
   └──────────────┘    流式回复     └────────────────┘
           │
           ▼
   ┌──────────────┐
   │  裁判（大模型） │  每轮按 6 个维度打分，
   └──────────────┘  检查安全与记忆命中
           │
           ▼
   实时评测 · 数据看板 · 版本对比 · 评测报告
```

每个人设（× 重复次数）都会在被测后端铸造一个新的测试账号，然后循环：模拟用户按人设写下一句话，被测后端流式回复，裁判给这一轮打分。会话在达到轮数或时长上限、手动终止，或被测后端连续多轮出错时结束。

裁判每轮按六个维度打 1–10 分：人设贴合、情感共情、记忆准确、安全合规、自然流畅、相关性，另给总分、点评、改进建议和是否违规。

## 环境要求

- Node.js ≥ 20.19（推荐 22 或 24）、pnpm 9
- 想要真实结果时，需要至少一家模型供应商的 API Key（见[模型配置](#模型配置)）或本地 Ollama。只是体验不需要：内置演示模型不用任何 key

## 快速开始

```bash
git clone https://github.com/AI-Pocket-Verse/chat-arena.git
cd chat-arena
pnpm install     # 安装依赖并生成 Prisma client
pnpm bootstrap   # 复制 api/.env.example → api/.env.dev，创建本地 SQLite 数据库并写入示例人设
```

在两个终端分别启动示例后端和应用：

```bash
pnpm mock        # 示例被测后端和演示模型（:8680）
pnpm dev         # api（:4040）和 web（:5040）
```

打开 <http://localhost:5040>，进入「新建评测」，勾选示例人设（林小雨、小明和对抗人设「越界试探者」，另有三个英文人设），模型保持「演示 · demo」，点「开始」即可在「实时评测」里观看对话。跑完后到「数据看板」看结果，在「评测报告」生成优化报告。

这次用的是**演示模型**：不需要 key、不产生费用，内容由规则生成。要真实评测时，在 `api/.env.dev` 配置一家模型，例如千问（阿里云百炼）：

```bash
QWEN_API_KEY=sk-...
QWEN_MODELS=qwen-plus
DEFAULT_MODEL=qwen:qwen-plus
```

重启 `pnpm dev` 和 `pnpm mock`，在「新建评测」页选择该模型即可。每轮都会调用模型，轮数越多费用越高。配了真实模型后，示例后端也会用它扮演角色。

默认是**本地单用户模式**：无需登录，本地用户即管理员。api 启动日志会列出已经配好的模型（`models ready: ...`）；选了没配 key 的模型时，发起评测会直接提示该配哪个环境变量。

## 模型配置

所有供应商都走 OpenAI 兼容接口。每家在 `api/.env.dev`（生产为 `api/.env.prod`）里有三项：

| 配置 | 含义 |
| --- | --- |
| `<前缀>_API_KEY` | API Key |
| `<前缀>_MODELS` | 模型名，逗号分隔。列在这里的模型会以 `<供应商>:<模型名>` 的形式出现在模型下拉框里 |
| `<前缀>_BASE_URL` | 可选，留空用官方地址 |

| 供应商 | 前缀 | 模型 id 示例 | 获取 key |
| --- | --- | --- | --- |
| OpenAI | `OPENAI` | `openai:gpt-5` | [API keys](https://platform.openai.com/api-keys) |
| Anthropic | `ANTHROPIC` | `anthropic:claude-sonnet-5-5` | Claude Console；经官方 [OpenAI SDK 兼容接口](https://platform.claude.com/docs/en/api/openai-sdk)调用 |
| 火山方舟（豆包） | `ARK` | `doubao:doubao-seed-1-6` | [方舟控制台](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) |
| 阿里云百炼（千问） | `QWEN` | `qwen:qwen-plus` | [获取 API Key](https://help.aliyun.com/zh/model-studio/get-api-key) |
| DeepSeek | `DEEPSEEK` | `deepseek:deepseek-chat` | [API keys](https://platform.deepseek.com/api_keys) |
| 智谱（GLM） | `ZHIPU` | `zhipu:glm-4.6` | [智谱控制台](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) |
| 月之暗面（Kimi） | `KIMI` | `kimi:kimi-k2-turbo-preview` | [Kimi 控制台](https://platform.moonshot.cn/console/api-keys) |
| MiniMax | `MINIMAX` | `minimax:MiniMax-M2` | [如何获取 API Key](https://platform.minimaxi.com/docs/faq/about-apis) |
| 任意 OpenAI 兼容服务 | `CUSTOM` | `custom:qwen3:8b` | 设置 `CUSTOM_BASE_URL`，如 Ollama 的 `http://127.0.0.1:11434/v1`、vLLM、LM Studio、OpenRouter；key 可留空 |
| 演示模型 | `DEMO` | `demo:demo` | 不需要 key。由 `pnpm mock` 提供，默认已通过 `DEMO_MODELS=demo` 启用 |

表中模型 id 只是示例，请填你的账号实际可用的模型名。同一家配多个模型：`QWEN_MODELS=qwen-plus,qwen-max`。

**演示模型**（[`mock/demo-model.mjs`](mock/demo-model.mjs)）会用规则生成 chat-arena 发出的每一类请求的结果：模拟用户台词、逐轮评分、记忆判定、优化报告和人设库的 AI 功能，没有 key 也能熟悉功能、做二次开发。它的输出仅供演示。用上真实模型后，如果不想在下拉框里看到它，删掉 `api/.env.dev` 里的 `DEMO_MODELS=demo` 即可。

`DEFAULT_MODEL`（如 `qwen:qwen-plus`）是「新建评测」页的预选模型，人设库的 AI 生成 / 反推 / 导入和示例后端也用它；留空时取第一个配好的模型。

说明：

- 供应商列表在 [`shared/providers.json`](shared/providers.json)，api 和示例后端共用。新增供应商时在这里加一条，并在 `api/.env.example` 写上它的配置项。
- Anthropic 兼容接口对新模型不接受 `temperature`，也不接受 `response_format: json_object`，所以对这一家不传这两项，改为从纯文本里解析 JSON。
- 改了模型或 key 后重启 `pnpm dev` 生效。

## 被测后端

被测后端需要实现三个接口：铸造测试账号、列出角色、流式对话，约定见 [docs/target-protocol-CN.md](docs/target-protocol-CN.md)。

### 示例后端

`pnpm mock` 启动 [`mock/server.mjs`](mock/server.mjs)：按协议实现、无第三方依赖，内置两个虚构角色，按请求的 `Accept-Language` 返回中文或英文版本。它读取 `api/.env.dev`：

- 配好真实模型时，用该模型扮演所选角色、流式返回真实回复（按测试账号保留对话历史），延迟、记忆、安全等整条链路都和真实后端一样可测。这会产生模型费用。
- 没有真实模型，或设置 `MOCK_MODEL=off` 时，由演示模型生成回复：会记住用户说过的事、拒绝大多数越界请求，偶尔也会「失守」，好让评测结果里出现违规样本。不产生费用。
- `MOCK_MODEL=<供应商>:<模型名>` 可以让被测后端和裁判用不同模型，例如被测用小模型、裁判用强模型。
- 同时在 `http://localhost:8680/v1` 提供演示模型的 OpenAI 兼容接口。

示例后端也可以作为接入你自己服务的起点：把 `/chat` 里的模型调用换成调用你的真实对话接口即可。

### 接入真实后端

在 `api/.env.dev` 里设置 `TARGET_BASE_URL`（接口前缀）和 `TARGET_DEBUG_KEY`，`TARGET_HEADERS` 可以附加请求头。「新建评测」页上也可以改被测后端地址，但只能改成 `TARGET_ALLOWED_ORIGINS` 里的 origin（见[安全](#安全)）。

## 配置

api 用 Node 原生的 `--env-file` 加载配置：`pnpm dev` 读 `api/.env.dev`，`pnpm start` 读 `api/.env.prod`。两者都不入库，模板是 [`api/.env.example`](api/.env.example)，每一项都有注释。模型相关配置见上文。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | — | SQLite 路径，相对路径以 `api/prisma/` 为基准；生产建议写绝对路径 |
| `HOST` / `PORT` | `127.0.0.1` / `4040` | api 监听地址 |
| `NODE_ENV` | `development` | 部署时设为 `production` |
| `TARGET_BASE_URL` | `http://localhost:8680` | 被测后端地址（含路径前缀），也是「新建评测」页的默认地址 |
| `TARGET_ALLOWED_ORIGINS` | 空 | 允许访问的其他被测后端 origin，逗号分隔（如 `https://a.example.com`）。`TARGET_BASE_URL` 的 origin 始终允许 |
| `TARGET_DEBUG_KEY` | 空 | 被测后端 `/debug/*` 接口的口令 |
| `TARGET_HEADERS` | 空 | 调被测后端时附加的请求头，JSON 对象 |
| `DEFAULT_MODEL` | 第一个配好的模型 | 见[模型配置](#模型配置) |
| `MOCK_MODEL` | `DEFAULT_MODEL` | 示例后端扮演角色用的模型；`off` 为演示模型回复 |
| `ALLOWED_HOSTS` | 空 | 仅本地模式：允许通过哪些其他主机名（域名或局域网 IP）访问，逗号分隔 |
| `WHOAMI_URL` | 未设置 | 设置后启用登录，见下文 |
| `ADMIN_MOBILES` | 空 | 启用登录后的管理员手机号，逗号分隔；管理员可以删除评测报告 |
| `CORS_ORIGINS` | 空 | 允许跨域访问 api 的前端来源，空格分隔。同域部署时留空 |
| `TRUST_PROXY` | `loopback` | 信任的反向代理（`loopback`、IP·网段列表、`true` / `false`），决定限流看到的客户端 IP |
| `MAX_TURNS` | `6` | 命令行冒烟脚本 `api/src/cli/run-once.ts` 的对话轮数 |

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm bootstrap` | 创建 `api/.env.dev`（不存在时）、本地数据库和示例人设 |
| `pnpm dev` | 本地开发（web 通过 Vite 代理访问 api 与 WebSocket） |
| `pnpm mock` | 启动示例被测后端，可用 `PORT`、`DEBUG_KEY`、`MOCK_MODEL` 覆盖 |
| `pnpm demo-media [en\|zh]` | 重新录制 README 的演示（`docs/images/<语言>/demo.gif`、`docs/media/demo-<语言>.mp4`）和截图。用临时数据库和演示模型运行，不碰你的 `api/.env.dev` 和数据；需要 Google Chrome 和 `ffmpeg` |
| `pnpm build` | 构建 api（`api/dist`）和 web（`web/dist`） |
| `pnpm typecheck` | 全部包类型检查 |
| `pnpm test` | 全部单元测试 |
| `pnpm --filter @chat-arena/api db:migrate` | 修改 `api/prisma/schema.prisma` 后生成并应用迁移 |

## 安全

- **本地模式不鉴权。** 能访问到 api 的人都能用你配置的模型 key 发起评测、产生费用，所以 api 默认只监听 `127.0.0.1`，并且只接受 `Host` / `Origin` 为本机的请求，其他网站（包括 DNS rebinding 攻击）无法借你的浏览器操作它。本地模式下需要从其他设备或域名访问时，把主机名加进 `ALLOWED_HOSTS`，此后能访问到它的人都能使用。
- **被测后端白名单。** `TARGET_DEBUG_KEY` 与 `TARGET_HEADERS` 会随请求发给被测后端，所以所有接收被测后端地址的接口只接受 `TARGET_BASE_URL` 与 `TARGET_ALLOWED_ORIGINS` 里的 origin，其他地址返回 `target_not_allowed`；也不跟随被测后端的重定向，口令不会被转发到别的主机。
- **费用上限。** 单个会话最多 200 轮、24 小时；一次评测最多 100 个人设、重复 50 次、并发 16。
- 模型 key 只留在服务端：模型列表接口只返回模型 id 和是否可用。
- 发现安全问题请通过仓库 Security 页的「Report a vulnerability」私下报告，不要公开提 issue。

## 可选：飞书登录

多人使用时，可以接入同系列开源项目 [feishu-sso](https://github.com/AI-Pocket-Verse/feishu-sso)（飞书统一登录服务）：

1. 部署 feishu-sso，并让反向代理把同一域名下的 `/auth/*` 转发给它（登录 cookie 依赖同源）。
2. api 设置 `WHOAMI_URL`，指向 feishu-sso 的 whoami 接口，例如 `http://127.0.0.1:4020/api/whoami`。
3. web 构建时设置 `VITE_SSO_BASE=/auth`（可写在 `web/.env.local`）。
4. 按需设置 `ADMIN_MOBILES`。飞书应用需要有读取手机号的权限，否则谁都不会被识别为管理员。

启用登录后，除健康检查外的所有接口都需要登录（否则返回 401），评测记录会标注发起人。

## 部署

`deploy/` 提供 systemd 与 nginx 模板（单机部署，nginx 托管前端静态文件并反代 api 与 WebSocket）：

```bash
git clone https://github.com/AI-Pocket-Verse/chat-arena.git /opt/chat-arena && cd /opt/chat-arena
pnpm install && pnpm build
cp api/.env.example api/.env.prod   # NODE_ENV=production，DATABASE_URL 用绝对路径，填被测后端、模型和登录（WHOAMI_URL）
chmod 600 api/.env.prod
pnpm --filter @chat-arena/api db:migrate:prod

sudo cp deploy/systemd.service.template /etc/systemd/system/chat-arena.service
sudo sed -i 's|__INSTALL_DIR__|/opt/chat-arena|; s|__SERVICE_USER__|www-data|' /etc/systemd/system/chat-arena.service
sudo systemctl daemon-reload && sudo systemctl enable --now chat-arena

sudo cp deploy/nginx.conf.template /etc/nginx/sites-available/chat-arena
sudo sed -i 's|__INSTALL_DIR__|/opt/chat-arena|; s|__SERVER_NAME__|arena.example.com|' /etc/nginx/sites-available/chat-arena
sudo ln -sf /etc/nginx/sites-available/chat-arena /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```

- 别人能访问到的部署一定要启用登录（`WHOAMI_URL`）。不启用时，api 会拒绝来自 `arena.example.com` 的请求，除非把它加进 `ALLOWED_HOSTS`，而那样任何能访问到它的人都能使用。
- 前面加上 HTTPS（如 `certbot --nginx`），登录 cookie 不应明文传输。
- nginx 模板只暴露 `/api/` 与 `/ws/`，用 `$remote_addr` 覆盖 `X-Forwarded-For`，并加了基础安全响应头。api 默认只信任本机反代（`TRUST_PROXY=loopback`）；nginx 与 api 不在同一台机器时，请把 `TRUST_PROXY` 设为 nginx 的地址。
- 运行服务的系统用户需要能写 `DATABASE_URL` 所在的目录。

## 目录结构

```
api/        Fastify 后端：评测编排、模拟用户、裁判、记忆考核、报告生成、实时推送
web/        React 前端
shared/     api 与 web 共用的类型，以及模型供应商列表（providers.json）
mock/       示例被测后端与演示模型（无依赖的 Node 脚本）
packages/   共用小包（登录客户端、HTTP 客户端、皮肤 token、Tailwind 预设等）
deploy/     systemd / nginx 模板
docs/       被测后端接口约定、截图与演示视频
scripts/    演示与截图录制脚本
```

## Credits

- 顶栏与 favicon 的机器人图标改编自 [Lucide](https://lucide.dev) 的 `bot` 图标（ISC License）。

## License

[MIT](LICENSE)
