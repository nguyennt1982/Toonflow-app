# Toonflow (git-research)

AI short-drama / manhua production tool. Converts a **novel** into **scripts**, **storyboards**, and AI-generated **images/videos** via LLM agents. Electron desktop app + local Express backend.

Stack: TypeScript, Express 5, Socket.io, SQLite via knex + better-sqlite3, Vercel AI SDK (`ai`), vm2 sandbox, sharp.

## Commands

- `yarn dev` — run backend only (tsx, `src/app.ts`, listens on port 10588)
- `yarn dev:gui` — run full Electron app (`scripts/main.ts`)
- `yarn lint` — typecheck only (`tsc --noEmit`) — run this after edits
- `yarn build` — esbuild bundle: backend → `data/serve/app.js`, electron main → `build/main.js`
- `yarn vendor2json` — regenerate `data/vendor/vendor.json` from `data/vendor/*.ts`
- `yarn license` — regenerate `NOTICES.txt`

## Code index (searchable symbol map)

A precomputed index lives in `.opencode/index/` (do not commit to git unless you want to):
- `code-index.json` — structured: `symbols` (name → `{kind,file,line}`), `routes` (file → `/api/...`), `skills` (frontmatter + headings per md), `meta`.
- `code-index.txt` — flat greppable lines: `<file>:<line> <kind> <name>` + `route /api/...` lines.
- `index.meta.json` — freshness metadata (`newestSourceMtime`).

Covers `src/**/*.ts`, `scripts/**/*.ts`, `data/skills/**/*.md`, `data/vendor/**/*.ts`, `data/modelPrompt/**/*.md` (skips generated `src/router.ts`, `src/types/database.d.ts`).

**Agent protocol (every session):**
1. If `.opencode/index/` exists, run `yarn index:check` (fast). If it prints `STALE` or `NO_INDEX`, run `yarn index:generate` (~15s) once, before answering code questions.
2. For "where is X defined / used", grep `.opencode/index/code-index.txt` (or query `code-index.json`) instead of scanning the tree. Open the real file only when you need full context.

## Semantic search (embeddings)

`.opencode/index/embeddings.json` stores per-chunk embeddings (384-dim, local model `data/models/all-MiniLM-L6-v2`) for every indexed file, plus the chunk text for snippets. `yarn index:embed` regenerates it — **incremental**: only changed files get re-embedded (hash-based, per-file stores in `.opencode/index/embeddings/`, merged afterward), so small edits cost seconds; a full rebuild (new model/chunker) takes ~10 min.

**Agent protocol:**
1. For concept/fuzzy questions ("which code handles X", "how does Y work") where symbol grep misses, run `yarn index:search "natural language query" [--top N]` → ranked `file:line` snippets. Open the top hits for full context.
2. Prefer `yarn index:check`'s `EMBEDDINGS_STALE` warning + `code-index.txt` grep for exact-symbol questions (faster, precise).
3. After changing sources, regenerate both (`yarn index:generate && yarn index:embed`) to keep symbol map and embeddings in sync.

## Business knowledge base

`docs/business/` answers "how does this domain work" without re-reading all source:
- [`docs/business/03-agent-orchestration.md`](docs/business/03-agent-orchestration.md) — read this FIRST: agent workflows, model resolution, memory, skills, end-to-end flow.
- [`docs/business/01-data-model.md`](docs/business/01-data-model.md) — generated data model (all tables/columns). Regenerate with `yarn docs:data-model`.
- [`docs/business/02-routes-map.md`](docs/business/02-routes-map.md) — generated endpoint map. Regenerate with `yarn docs:routes`.
- [`docs/business/README.md`](docs/business/README.md) — index + regeneration commands.

If you change routes, agents, skills, or the DB schema, regenerate the docs (`yarn index:generate && yarn docs:routes && yarn docs:data-model`) so this knowledge stays in sync.

## Container backup / restore

This container is **ephemeral** (Hermes creates it; everything not pushed to git dies with it). The knowledge base is the expensive part (full embedding rebuild ≈ 10 min), so it's snapshotted to the fork's `kb-index` branch:

- `yarn kb:backup` — ensures embeddings are fresh, then force-pushes a snapshot of `.opencode/index/embeddings/` + `embeddings.manifest.json` + `embeddings.meta.json` to `origin/kb-index` (orphan branch, only those files). Derived files (`embeddings.json`, `code-index.*`) are NOT stored — they rebuild in seconds.
- `yarn kb:restore` — fetches `origin/kb-index`, restores the stores, then rebuilds derived indexes (`index:generate` + `index:embed` + `index:check`). Run in a fresh container before knowledge work (~30s).

**`origin` = the fork `nguyennt1982/Toonflow-app`, NOT upstream `HBAI-Ltd/Toonflow-app`. Never push to the upstream repo.**

### Recovery runbook (fresh container after teardown)

```bash
git clone https://github.com/nguyennt1982/Toonflow-app.git
cd Toonflow-app
yarn install          # gets tsx, @huggingface/transformers, onnxruntime-web, etc.
yarn kb:restore       # fetch kb-index → restore stores → rebuild derived indexes (~30s)
yarn index:check      # verify FRESH
yarn index:search "..."  # sanity-check a semantic query
```

Survives in git: all source, `scripts/`, `docs/business/`, `AGENTS.md`, npm scripts (master) + embedding stores (kb-index). Everything else dies with the container: `data/db2.sqlite`, `data/oss/`, `data/web/`, `node_modules`, uncommitted work, and **any embeddings embedded after the last `yarn kb:backup`** (run `yarn kb:backup` again if you re-embedded after a snapshot).

## Architecture

No DI, no service layer. Thin, imperative handlers around a shared `u` utility + SQLite. Three channels:

1. **REST** — `src/routes/**/*.ts` mounted at `/api/<path>` (auto-generated router).
2. **Socket.io** — realtime agent chat + tool ack bridge (`src/socket/`).
3. **Long-running AI gen** — fire-and-forget + polling (image/video tasks write a row with `state: "生成中"`, a polling endpoint reads it later).

### Request flow

`src/app.ts` (Express + Socket.io, port 10588) → JWT auth middleware (token from `o_setting.tokenKey`; `/api/login/login` whitelisted) → `src/router.ts` → route handler.

**`src/router.ts` is GENERATED.** `src/core.ts` globs `src/routes/**/*.ts`, maps file path → route path (`[id]` → `:id`), and writes `src/router.ts` guarded by an `@routes-hash`. **Never edit `src/router.ts`** — add/modify route files instead; in dev (`NODE_ENV=dev`) the router rebuilds on boot.

### Data root

All runtime data lives under `getPath()` (`src/utils/getPath.ts`): in dev `<cwd>/data`, in packaged Electron `userData/data`. Every file path is path-escape-checked (`is-path-inside`). Repo `data/` doubles as packaged seed resources.

### data/ directory map

| Path | Contents | Index? |
|---|---|---|
| `data/skills/**` | **Agent prompts (the AI "brain")**: `script_agent_decision.md`, `production_agent_decision.md`, execution/supervision prompts, `art_skills/<11 art styles>/` (prefix.md, art_prompt/, driector_skills/), `story_skills/<12 genres>/`, `production_skills/` | ✅ yes |
| `data/vendor/*.ts` | Executable LLM/vendor provider templates (openai, deepseek, minimax, klingai, vidu, volcengine, toonflow...) — transpiled + vm2-sandboxed at runtime | ✅ yes |
| `data/modelPrompt/video/*.md` | Video-generation prompt templates (seedance2, wan2.6, universal) | ✅ yes |
| `data/db2.sqlite` | Runtime DB (25 `o_*` tables + `memories`). **Gitignored — user data, never commit.** Source for schema docs | schema only |
| `data/models/` | ONNX embedding model (binary) | ❌ no |
| `data/web/` | Built/minified frontend bundle (gitignored) | ❌ no |
| `data/serve/` | Built backend bundle `app.js` (generated artifact; currently committed but should be gitignored) | ❌ no |
| `data/oss/` | Generated image/video files at runtime | ❌ no |
| `data/assets/`, `data/version.txt` | Sample video, app version | ❌ no |

## Where to find things

| Concern | Go to |
|---|---|
| Add / modify an API endpoint | `src/routes/<module>/<name>.ts` (auto-registered, see pattern below) |
| Agent logic (script / production) | `src/agents/scriptAgent/`, `src/agents/productionAgent/` |
| Agent realtime chat / socket events | `src/socket/` (namespaces `/api/socket/{scriptAgent,productionAgent}`) |
| LLM / image / video / audio calls | `src/utils/ai.ts` (`u.Ai.Text/Image/Video/Audio`) |
| Vendor (LLM provider) templates | `src/utils/vendor.ts`, `src/utils/vm.ts`, `data/vendor/<id>.ts` |
| DB schema + seed data | `src/lib/initDB.ts` |
| DB migrations / repairs (runs on boot) | `src/lib/fixDB.ts` |
| DB table types | `src/types/database.d.ts` (**generated**, don't edit) |
| Agent prompts / skills | `data/skills/**` (markdown), `src/utils/agent/skillsTools.ts` |
| Agent memory / embeddings RAG | `src/utils/agent/memory.ts`, `src/utils/agent/embedding.ts`, table `memories` |
| Video prompt templates | `data/modelPrompt/video/`, `src/routes/setting/modelMap/*` |
| Generated files store (images/videos) | `src/utils/oss.ts` (served at `/oss`, thumbnails via `?size=`) |
| Image helpers (sharp) | `src/utils/image.ts` |
| Response wrapper | `src/lib/responseFormat.ts` (`success`/`error` → `{code,data,message}`) |
| Request validation | `src/middleware/middleware.ts` (`validateFields`, zod) |
| Error normalization | `src/utils/error.ts` (`u.error`); `src/err.ts` = global crash logging (side-effect) |
| Electron main process | `scripts/main.ts` (builds to `build/main.js`) |

## Route file pattern (follow this)

```ts
import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();
export default router.post("/", validateFields({ /* zod shape */ }), async (req, res) => {
  const { ... } = req.body;
  await u.db("o_xxx").insert({ id: Date.now(), createTime: Date.now(), ... });
  res.status(200).send(success({ message: "中文提示" }));
});
```

## Conventions

- **Tables** are prefixed `o_` (e.g. `o_project`, `o_assets`); `memories` is the only unprefixed table. DB access via `u.db("<table>")` (knex callable) or `u.db.raw()`.
- **IDs/timestamps** set manually: `id: Date.now()`, `createTime: Date.now()`.
- **User-facing messages** are Chinese. Keep this for new code.
- **Validation**: always use `validateFields` (zod) on POST bodies.
- **AI fire-and-forget**: `u.Ai.Image/Video(model).run(...)` **without await** → insert task row → respond immediately; polling endpoints filter with `.whereNot("state", "生成中")`. Agent-driven work streams over socket instead (no polling).
- **Errors**: `try/catch` + `u.error(e)` + `res.status(4xx/5xx).send(error(err.message))`.
- **Do not edit generated files**: `src/router.ts`, `src/types/database.d.ts`.

## Domain concepts

- **Novel → Event**: `u.cleanNovel` (`src/utils/cleanNovel.ts`) extracts chapter events via `universalAi` (event emitter, concurrent=5).
- **scriptAgent**: novel → story skeleton → adaptation strategy → scripts (`<scriptItem>` XML). Plan persisted in `o_agentWorkData`.
- **productionAgent**: scripts → director plan → derive assets → storyboard table → panels → storyboard image generation. Tools write DB + emit socket ack requests.
- **Agent = decision + sub-agents + supervision**: each agent (`src/agents/*`) is a decision LLM that spawns sub-agents via AI SDK `tool()`; system prompts from `data/skills/`.
- **Model resolution**: agent key → `o_agentDeploy` (`vendorId:modelName`). `o_setting.agentUseMode` = `0` simple (sub-agents reuse main model) / `1` advanced (per-sub-agent).
- **Vendors**: `data/vendor/*.ts` templates are transpiled (sucrase) and executed in a vm2 sandbox (`src/utils/vm.ts`) that injects provider factories (OpenAI, DeepSeek, Google, MiniMax...), axios, sharp helpers, fetch, jwt.
- **Memory**: per-agent + isolationKey (project/episode) in `memories` table with ONNX embeddings (`data/models/all-MiniLM-L6-v2`) + cosine similarity + auto-summarization.
- **Workbench**: video tracks/timeline in `o_video`/`o_videoTrack`; image flows as JSON nodes in `o_imageFlow`.

## Business flow (end to end)

novel (`o_novel`) → clean/events (`o_event`, `o_eventChapter`) → scriptAgent (socket chat) → script (`o_script`) → productionAgent (socket chat) → storyboard (`o_storyboard`) + derive assets (`o_assets`, `o_scriptAssets`) → storyboard images → workbench video generation (`o_video`, `o_videoTrack`, `data/modelPrompt/video/`).

## Gotchas

- Route additions need the router rebuilt (happens automatically in dev boot via `src/core.ts`).
- `fixDB` runs on every boot and repairs stuck "生成中/进行中" states after crashes — don't rely on state rows surviving a kill.
- Vendor code is user-editable runtime data; always treat it as untrusted.
- `src/logger.ts` hijacks console/stdout (disabled currently — commented out in `src/app.ts`).
