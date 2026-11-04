# 被测后端接口约定

[English](target-protocol.md) | 中文

chat-arena 通过三个 HTTP 接口和被测对话后端交互：铸造测试账号、列出角色、流式对话。实现这三个接口，就能用 chat-arena 评测你的后端。[`mock/server.mjs`](../mock/server.mjs) 是一份完整的、无第三方依赖的示例实现。

## 共同约定

- **地址**：配置的是前缀，如 `https://example.com/companion`，接口拼成 `https://example.com/companion/debug/token`。
- **额外请求头**：`TARGET_HEADERS` 配置的 JSON 对象会加到每个请求上，用于后端要求的客户端版本头等。
- **响应信封**：除 `/chat` 的流式响应外都返回 `{"code": 200, "msg": "ok", "data": {...}}`。业务错误（口令错、token 失效等）可以用 HTTP 200 + `code` 非 200，chat-arena 会检查 `code` 并把 `msg` 显示为错误原因。`/chat` 出错时可以直接返回 JSON 信封（`Content-Type: application/json`）代替事件流。
- **语言**：请求带 `Accept-Language`（`zh-CN` 或 `en`）：角色列表和连接测试用当前界面语言，评测中的铸造 token 与对话请求用该次评测的语言。支持多语言的后端可以据此返回对应语言的角色资料和回复，不支持的忽略即可。`TARGET_HEADERS` 里写了 `Accept-Language` 时以它为准。
- **鉴权**：`/debug/*` 接口用请求头 `X-Debug-Key`（即 `TARGET_DEBUG_KEY`）；`/chat` 用请求头 `Authorization`，值是 `/debug/token` 返回的 token 原文，不加 `Bearer` 前缀。
- chat-arena 不用的字段会被忽略，后端多返回、多接收字段不会出错。

## `POST /debug/token`

为一个新的测试账号铸造会话 token。每个评测会话使用独立账号，会话之间的记忆互不影响。

- 请求：`{"ta_gender": 1 | 2, "count": 1, "expires_at": 0}`。`ta_gender` 决定绑定哪个角色：1 对应男性角色，2 对应女性角色。`expires_at: 0` 表示不过期，后端可以忽略。
- 响应 `data`：`{"tokens": [{"token", "uid", "memory_id"}]}`。必需字段是这三个；`user_code`、`expires_at` 可以返回，不会被使用。

## `GET /debug/roles`

角色列表。响应 `data`：`{"roles": [{"id": 1, "name": "...", "gender": 1}]}`。

`id`、`name`、`gender`（1 男 / 2 女）是必需字段：chat-arena 用 `gender` 与 `ta_gender` 配对选角色，没有 `gender` 时退回第一个角色。其余字段都可以缺省，只用于展示和报告：

| 字段 | 用途 |
| --- | --- |
| `nickname`、`age`、`city`、`height`、`voice`、`avatar`、`brief`、`title`、`tags` | 角色资料，用于「AI 角色库」页面和新建评测时展示 |
| `chat_persona` | 人设概述 |
| `prompt_persona` | 分段人设：`identity_base`、`daily_style`、`relationship_base`、`emotion_support`、`media_policy`、`reality_boundary`、`safety_boundary` |
| `rendered_prompt` | 拼好的完整系统提示词。优化报告会基于它给出修订版并逐行对比；不返回则跳过这一节 |

## `POST /chat`

- 请求体：`{"content": "用户这一轮说的话", "content_type": "text", "client_message_id": "<uuid>"}`。
- 响应：`text/event-stream`，每帧一行 `data: <信封 JSON>`，以空行结束：

| 帧 | 形状 | 处理 |
| --- | --- | --- |
| 正文 | `{"code": 200, "data": {"text": "增量文字"}}` | 累加成回答 |
| 结束 | `{"code": 200, "type": "done"}` | 本轮结束 |
| 出错 | `{"code": <非 200>, "type": "done", "data": {"error_type", "message", "retryable"}}` | 本轮出错。三个字段都要给：`error_type`、`retryable` 决定是否重试，`data.message`（没有时用 `msg`）显示给用户 |

- 正文帧的 `data` 里可以带 `session_id`、`message_id`、`memory_used`、`safety_mode`、`emotion_state`，作为本轮元数据保存；`data.image_url` 记录为图片元数据；既没有 `text` 也没有 `image_url` 的帧视为进度，忽略。
- 流在没有结束帧的情况下断开，记为可重试的 `stream_incomplete` 错误；出错帧 `retryable` 为 true、或信封 `code` 为 5xx 时会重试，口令、token 类（4xx）错误不重试。单轮出错不会终止会话，连续多轮出错才会放弃该会话。

首个正文帧到达的时间记为首字延迟，所以尽早开始推送。
