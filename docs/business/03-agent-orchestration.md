# Agent Orchestration & Domain Flow

This document explains how the two AI agents drive the Toonflow pipeline (novel → script → storyboard → assets → video). Code: `src/agents/`, `src/socket/`, `src/utils/ai.ts`, `src/utils/agent/`. Prompts: `data/skills/`.

## How an agent run is triggered

The Electron frontend opens a Socket.io namespace (`/api/socket/scriptAgent` or `/api/socket/productionAgent`), authenticates with JWT + `isolationKey`, then emits `chat {content}`. The route handler (`src/socket/routes/*.ts`) builds an `AgentContext` and calls `runDecisionAI(ctx)`. Streamed output (text/reasoning/tool-calls) is pushed back over the socket (`content:add`/`content:update`). `stop` or a new `chat` aborts via `AbortController`.

## Shared pattern: decision → sub-agents → supervision

Both agents follow the same 3-layer design:

1. **Decision layer** — a single LLM (`<agentKey>:decisionAgent`) streams its plan/reasoning and dispatches work by calling sub-agent **tools** (`createSubAgent`). System prompt: `data/skills/<agent>_agent_decision.md`.
2. **Execution layer** — sub-agents are AI SDK `tool()`s that each run their own `streamText` with a dedicated prompt (`data/skills/<agent>_execution_*.md`). They emit structured **XML documents** (e.g. `<storySkeleton>`, `<scriptItem>`, `<scriptPlan>`, `<storyboardTable>`, `<storyboardItem>`).
3. **Supervision layer** — a review sub-agent (`<agent>_agent_supervision.md`) validates the produced XML and can reject/re-request.

Model for each layer is resolved by `src/utils/ai.ts` `resolveModelName`:
- `o_setting.agentUseMode = "0"` (simple): all sub-agents reuse the main agent's model.
- `= "1"` (advanced): per-key `o_agentDeploy.modelName`.

`consumeFullStream` pipes AI SDK `fullStream` chunks (`reasoning-start/delta/end`, `text-delta`, `error`, `finish`) into the socket message stream.

## scriptAgent — novel → scripts

Entry: `src/agents/scriptAgent/index.ts` (`runDecisionAI`). Injects project info (novel name/type/intro, artStyle, videoRatio, chapter count) + memory.

Output chain (persisted in `o_agentWorkData` via `key`, JSON in `data`):
1. **story skeleton** `<storySkeleton>` — `script_execution_skeleton.md`
2. **adaptation strategy** `<adaptationStrategy>` — `script_execution_adaptation.md`
3. **scripts** `<scriptItem>` list — `script_execution_script.md`; upserts `o_script` (content = XML)

Read tools (`scriptAgent/tools.ts`): `get_novel_events`, `get_planData` (workspace), `get_novel_text`, `get_script_content`.

## productionAgent — scripts → storyboard + assets

Entry: `src/agents/productionAgent/index.ts` (`runDecisionAI`). Injects project image/video model + multi-ref mode. Reads workspace via `get_flowData` (`o_agentWorkData`).

Sub-agent chain (prompts `production_execution_*.md`):
1. **derive assets** — decide which character/scene/prop assets to derive
2. **generate assets** — kick off asset image generation
3. **director plan** `<scriptPlan>` — shooting plan
4. **storyboard gen** → 5. **storyboard panel** `<storyboardItem>` → 6. **storyboard table** `<storyboardTable>`
7. **supervision** — review

Action tools (`productionAgent/tools.ts`) persist to DB **and** emit socket ack requests (the client does heavy work, ack resolves the tool):
- `add_deriveAsset` / `del_deriveAsset` → `o_assets`
- `generate_deriveAsset` / `generate_storyboard` → kick off image generation (serialized queue, 800ms spacing)
- `add_flowData_storyboard` → `o_storyboard`
- `get_flowData` → workspace read

Skill system (`createArtSkills`/`useProductionSkills`): scans `data/skills/art_skills/<artStyle>/driector_skills`, `story_skills/<style>/driector_skills`, `production_skills/*.md`; parses YAML frontmatter; exposes `activate_skill`/`read_skill_file` tools (`src/utils/agent/skillsTools.ts`, path-traversal protected).

## Support infrastructure

### Model resolution & vendor execution
- Agent key → `vendorId:modelName` via `o_agentDeploy` (+`agentUseMode`). See above.
- `src/utils/ai.ts` exposes `Ai.Text/Image/Video/Audio`. `Text` wraps AI SDK `streamText` (+ reasoning middleware, devtools, `stopWhen`). Image/Video/Audio run generation, auto-convert http→base64, `save(path)` to OSS, optional `o_tasks` record.
- Vendor templates `data/vendor/<id>.ts` are transpiled (sucrase) and executed in vm2 (`src/utils/vm.ts`), injected with provider factories + axios + sharp helpers.

### Memory (`src/utils/agent/memory.ts`, table `memories`)
Per-agent + `isolationKey` (`projectId:agentType[:episodesId]`). Stores messages & rolling summaries with ONNX embeddings (`data/models/all-MiniLM-L6-v2`); retrieval = short-term + summaries + vector cosine RAG; auto-summarization + a `deepRetrieve` AI tool.

### Novel cleaning (`u.cleanNovel`, `src/utils/cleanNovel.ts`)
Independent of the socket agents: given novel chapters, concurrently (5) extracts **events** via `universalAi`, writing `o_event`/`o_eventChapter`. Progress via event emitter. Used by `routes/novel/addNovel` and `routes/novel/event/generateEvents`.

### Fire-and-forget generation + polling (REST-driven)
Image/video generation started from REST endpoints does NOT stream: insert row with `state: "生成中"` → `u.Ai.Image/Video(model).run(...)` without await → respond. Polling endpoints (`.whereNot("state","生成中")`) pick up results. `fixDB` marks stale in-flight rows as failed on boot.

## End-to-end flow

```
o_novel (chapters)
  │  u.cleanNovel → o_event, o_eventChapter        [REST]
  ▼
scriptAgent (socket chat) → o_script               [XML <scriptItem>]
  ▼
productionAgent (socket chat) → o_storyboard, o_assets   [XML + tools]
  │  storyboard images generated (queue)
  ▼
workbench (REST) → o_videoTrack, o_video          [video prompt templates: data/modelPrompt/video/*.md]
```

## Key state values (Chinese literals used in code)

- Generation states: `生成中` (in progress) / `成功` / `失败` — also `进行中` for `o_tasks`.
- Prompt/asset extraction: `extractState`.
- Search code for these literals when debugging stuck tasks.
