# src/agents — LLM agent orchestrators

Two AI "supervisor" agents built on the Vercel AI SDK (`streamText`, `tool`, `jsonSchema`). Pattern: a **decision agent** dispatches, **sub-agents** (spawned via tools) execute, a **supervision agent** reviews. Prompts live in `data/skills/*.md`. Both are streamed to the client over Socket.io (see `src/socket/`); they are never invoked by REST routes.

Models are resolved per agent key via `src/utils/ai.ts` (`resolveModelName`: `o_agentDeploy` + `o_setting.agentUseMode` — simple `0` reuses the main agent's model, advanced `1` allows per-sub-agent) and loaded through vendor templates run in the vm2 sandbox.

## scriptAgent/ — novel → scripts

- `index.ts` — `runDecisionAI(ctx)` entry (system prompt `data/skills/script_agent_decision.md`). Sub-agent tools (prompts in `data/skills/script_execution_*.md`):
  - `run_sub_agent_storySkeleton` → `<storySkeleton>`
  - `run_sub_agent_adaptationStrategy` → `<adaptationStrategy>`
  - `run_sub_agent_script` → `<scriptItem>` list (reads existing `o_script`)
  - `run_supervision_agent` — reviewer
- `tools.ts` — data-read tools: `get_novel_events` (`o_novel`/`o_event`), `get_planData` (`o_agentWorkData`), `get_novel_text` (`o_novel.chapterData`), `get_script_content` (`o_script`).
- Shared helpers here and in productionAgent: `consumeFullStream` (pipes AI SDK `fullStream` chunks → socket), `buildMemPrompt` (from `src/utils/agent/memory.ts`), `removeAllXmlTags`.

## productionAgent/ — scripts → storyboard + assets

- `index.ts` — `runDecisionAI(ctx)` entry (system prompt `data/skills/production_agent_decision.md`; injects project image/video model info + multi-ref mode). Sub-agent tools (prompts `data/skills/production_execution_*.md`):
  - `run_sub_agent_derive_assets`
  - `run_sub_agent_generate_assets`
  - `run_sub_agent_director_plan` → `<scriptPlan>`
  - `run_sub_agent_storyboard_gen`
  - `run_sub_agent_storyboard_panel` → `<storyboardItem>`
  - `run_sub_agent_storyboard_table` → `<storyboardTable>`
  - `run_sub_agent_supervision` — supervisor
- `createArtSkills` / `useProductionSkills` — scan `data/skills/art_skills/<artStyle>/driector_skills`, `story_skills/<style>/driector_skills`, `production_skills/*.md`; parse frontmatter; build skill prompt + `activate_skill` tool.
- `tools.ts` — action tools that persist to DB **and** emit socket ack requests (`get_flowData`, `add_deriveAsset`, `del_deriveAsset`, `generate_deriveAsset`, `generate_storyboard` (serialized queue, 800ms spacing), `add_flowData_storyboard`). Zod schemas: `assetItemSchema`, `deriveAssetSchema`, `storyboardSchema`, `flowDataSchema`.

## Key context types

`AgentContext` (`{ projectId, scriptId, isolationKey, socket, ... }`) is built in the socket route handlers (`src/socket/routes/*.ts`).
