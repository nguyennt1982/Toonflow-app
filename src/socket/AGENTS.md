# src/socket — realtime agent channel

Socket.io (initialized in `src/app.ts`: `const io = new Server(server, { cors: { origin: "*" } }); socketInit(io)`).

Two namespaces, both stream long-running LLM agent runs to the client (no polling here — that's only for REST-driven image/video tasks):

- `/api/socket/productionAgent` → `src/socket/routes/productionAgent.ts`
- `/api/socket/scriptAgent` → `src/socket/routes/scriptAgent.ts`

## Client → server events

| Event | Purpose |
|---|---|
| `chat` | Aborts previous run, builds `AgentContext`, calls `runDecisionAI(ctx)` (long-running orchestration). |
| `updateContext` | Switch project/script context `{isolationKey, projectId, scriptId}` (production only). |
| `updateThinkConfig` | Toggle reasoning `{think, thinlLevel}` (default `{think:false, thinlLevel:0}`). |
| `stop` | Abort current run (`AbortController`). |

## Server → client events

Push (message streaming):
- `message` — new chat message created
- `message:update` — status transitions `pending|streaming|complete|stop|error`
- `content:add` — content blocks: `text`, `markdown`, `thinking`, `search`, `image`, `toolcall`, `activity`, `reasoning`
- `content:update` — streaming deltas (`strategy: append|merge`)

Ack (request/response; client does the heavy work and the ack resolves the tool result):
- `getFlowData` / `getPlanData` — workspace read
- `addDeriveAsset` / `delDeriveAsset` — derived-asset CRUD
- `generateDeriveAsset` — kick off asset image generation
- `generateStoryboard` — kick off storyboard image generation (serialized via `createSocketQueue(800ms)`)
- `addStoryboard` — add storyboard panel

## Key files

- `resTool.ts` — `ResTool(socket, {projectId, scriptId})`: `newMessage(role, name)` → `MessageBuilder` emitting the message/content events above; `AutoThinkingTextStream` parses `<think>…</think>` out of the stream into separate thinking content. (`resTool copy.ts` is an older variant — ignore.)
- Route handlers JWT-verify using `o_setting.tokenKey` and require `isolationKey` in handshake auth.

Cancellation: `stop` or a new `chat` aborts the in-flight LLM stream via `AbortController`.
