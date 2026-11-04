# Backend protocol

English | [中文](target-protocol-CN.md)

chat-arena talks to the chat backend under test through three HTTP endpoints: mint a test account, list roles, and stream a chat reply. Implement these three and chat-arena can evaluate your backend. [`mock/server.mjs`](../mock/server.mjs) is a complete, dependency-free reference implementation.

## Conventions

- **Base URL**: you configure a prefix such as `https://example.com/companion`; endpoints are appended to it, e.g. `https://example.com/companion/debug/token`.
- **Extra headers**: the JSON object in `TARGET_HEADERS` is added to every request (for client-version headers and the like).
- **Response envelope**: every response except the `/chat` stream is `{"code": 200, "msg": "ok", "data": {...}}`. Business errors (wrong key, expired token, ...) may use HTTP 200 with a non-200 `code`; chat-arena checks `code` and shows `msg` as the error reason. On error, `/chat` may return a JSON envelope (`Content-Type: application/json`) instead of an event stream.
- **Language**: requests carry `Accept-Language` (`zh-CN` or `en`): the UI language for the roles list and connection test, and the evaluation's language for its token and chat requests. A backend that supports several languages can return role profiles and replies in that language; others can ignore it. An `Accept-Language` in `TARGET_HEADERS` takes precedence.
- **Auth**: `/debug/*` endpoints use the `X-Debug-Key` header (the value of `TARGET_DEBUG_KEY`). `/chat` uses the `Authorization` header, whose value is the raw token returned by `/debug/token` -- no `Bearer` prefix.
- Fields chat-arena does not use are ignored, so a backend may return or accept more than described here.

## `POST /debug/token`

Mints a session token for a fresh test account. Every evaluated conversation gets its own account, so memory from one conversation does not leak into another.

- Request: `{"ta_gender": 1 | 2, "count": 1, "expires_at": 0}`. `ta_gender` picks the role to bind: `1` for the male role, `2` for the female role. `expires_at: 0` means "never expires" and may be ignored.
- Response `data`: `{"tokens": [{"token", "uid", "memory_id"}]}`. These three fields are required; `user_code` and `expires_at` may be returned and are not used.

## `GET /debug/roles`

Lists the roles (characters) of the backend. Response `data`: `{"roles": [{"id": 1, "name": "...", "gender": 1}]}`.

`id`, `name` and `gender` (1 male / 2 female) are required: chat-arena pairs `gender` with `ta_gender` to pick a role, and falls back to the first role when `gender` is missing. All other fields are optional and only used for display and reports:

| Field | Purpose |
| --- | --- |
| `nickname`, `age`, `city`, `height`, `voice`, `avatar`, `brief`, `title`, `tags` | Profile shown on the "AI roles" page and when creating an evaluation |
| `chat_persona` | One-paragraph persona summary |
| `prompt_persona` | Persona by section: `identity_base`, `daily_style`, `relationship_base`, `emotion_support`, `media_policy`, `reality_boundary`, `safety_boundary` |
| `rendered_prompt` | The full system prompt. The optimization report proposes a revised version of it with a line-by-line diff; without it that section is skipped |

## `POST /chat`

- Request body: `{"content": "what the user says this turn", "content_type": "text", "client_message_id": "<uuid>"}`.
- Response: `text/event-stream`. Each frame is one line `data: <envelope JSON>` followed by a blank line:

| Frame | Shape | Handling |
| --- | --- | --- |
| Text | `{"code": 200, "data": {"text": "delta"}}` | Appended to the reply |
| Done | `{"code": 200, "type": "done"}` | The turn is complete |
| Error | `{"code": <non-200>, "type": "done", "data": {"error_type", "message", "retryable"}}` | The turn failed. Send all three fields: `error_type` and `retryable` decide whether to retry, `data.message` (or `msg`) is shown to the user |

- Text frames may also carry `session_id`, `message_id`, `memory_used`, `safety_mode`, `emotion_state` in `data`; they are stored as turn metadata. `data.image_url` is recorded as image metadata. Frames with neither `text` nor `image_url` are treated as progress and ignored.
- A stream that ends without a done frame is recorded as a retryable `stream_incomplete` error. Error frames with `retryable: true`, or an envelope `code` in the 5xx range, are retried; key and token errors (4xx) are not. A single failed turn does not end the conversation; several failed turns in a row do.

Time to first text frame is reported as first-token latency, so stream as early as you can.
