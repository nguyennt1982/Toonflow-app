# src/utils — shared helpers (the `u` object)

`src/utils.ts` is the aggregator barrel: everything routes/agents import as `u from "@/utils"`. Members: `db, oss, getConfig, uuid, error, cleanNovel, vm, getPath, Ai, task, getPrompts, getArtPrompt, replaceUrl, writeVersion, vendor`.

## Core utilities

| Module | Purpose |
|---|---|
| `db.ts` | Single knex instance (`client: "better-sqlite3"`, file `getPath("db2.sqlite")`). Boot runs `initDB()` + `fixDB()`. In dev regenerates `src/types/database.d.ts` via `@rmp135/sql-ts` (hash-guarded). Exports callable `dbClient`: `u.db("o_assets")` → typed query builder; `u.db.raw(...)` for raw SQL. |
| `getPath.ts` | Resolves data root: Electron → `app.getPath("userData")/data`, else `<cwd>/data`. Joins subpaths with path-escape enforcement. Also exports `isEletron()` (note the typo — it's intentional). |
| `oss.ts` | Local file "object storage" under `data/oss`, served at `/oss`. `getFileUrl`, `getFile`, `getImageBase64`, `deleteFile/Directory`, `writeFile` (base64/Data-URL), `fileExists`, `getSmallImageUrl`. |
| `image.ts` | sharp helpers: `resizeImage`, `ensureThumbnail(original, thumb, size)` — `{type:"dimensions", width, height}` or `{type:"percentage", value}`. |
| `error.ts` | `normalizeError(e)` → `{name,message,code,status,stack,cause,meta}` (axios-aware). Used as `u.error(e)` in catch blocks. |
| `writeVersion.ts` | Read/write `data/version.txt`; uses `__APP_VERSION__` esbuild define, falls back to package.json. |
| `replaceUrl.ts` | Normalize `/oss`/`/smallImage` URLs to safe relative paths (path-traversal blocked). |
| `getConfig.ts` | Legacy `t_config` table model config (baseURL/apiKey/manufacturer). |
| `getPrompts.ts` | Hard-coded "event extraction" system prompt. |
| `getArtPrompt.ts` | Reads art-style skill `.md` from `data/skills/<source>/<styleName>/` (recursive; merges `prefix.md`). |
| `cleanNovel.ts` | `CleanNovel` class: concurrent (5) chapter→event extraction via `u.Ai.Text("universalAi")`, strips `<think>` blocks; progress via `.emitter`. |
| `stripThink.ts` | `stripThink(text)` + `createThinkStreamFilter()` — removes `<think>…</think>` in non-stream and streaming modes. |
| `taskRecord.ts` | Inserts `o_tasks` row ("进行中"); returns `done(1|-1, reason)`. |

## AI layer

`ai.ts` — the heart of LLM/vendor dispatch:
- `Ai.Text(<agentKey>, think, thinkLevel).stream(...)` → AI SDK `streamText` (with `extractReasoningMiddleware` `reasoning_content`, optional devtools middleware, `stopWhen: stepCountIs(tools*50)`).
- `Ai.Image/Video/Audio` → run generation (auto-convert http result to base64), optional `withTaskRecord` → `o_tasks`, then `save(path)` via `u.oss.writeFile`.
- `resolveModelName`/`getModelConfig`: agent key → `o_agentDeploy` (`vendorId:modelName`), simple/advanced mode via `o_setting.agentUseMode`. `AiType` union lists every agent key.

`vendor.ts` — vendor source management: `writeCode(id, ts)`, `getCode(id)`, `getModelList(id)` (DB + vendor code models), `getVendor(id)`.

`vm.ts` — vm2 sandbox for untrusted vendor code; injects AI-provider factories (`createOpenAI`, `createDeepSeek`, `createGoogleGenerativeAI`, ...), axios, sharp helpers (`zipImage`, `zipImageResolution`, `urlToBase64`, `mergeImages`), `pollTask`, `fetch`, jsonwebtoken, crypto.

## agent/ — agent infrastructure

| Module | Purpose |
|---|---|
| `embedding.ts` | ONNX sentence embeddings via `@huggingface/transformers` + onnxruntime-web; model from `data/models` (e.g. `all-MiniLM-L6-v2/onnx/model_fp16.onnx`). Exports `initEmbedding`, `getEmbedding`, `cosineSimilarity`, `disposeEmbedding`. |
| `memory.ts` | `Memory` class per `agentType`+`isolationKey`: messages/summaries in `memories` table with embeddings; rolling summaries + auto-summarization; `get()` (short-term + summaries + vector RAG), `deepRetrieve()`, and a `deepRetrieve` AI tool. |
| `skillsTools.ts` | Skill system: `parseFrontmatter`, `useSkill` (loads `data/skills` main files + workspace/attached md), `buildSkillPrompt`, `createSkillTools` (tools `activate_skill`, `read_skill_file`, path-traversal protected), `scanSkills`. |

## Gotchas

- `db.ts` dev-mode regenerates `src/types/database.d.ts` — don't hand-edit that file.
- `u.error` is a normalizer, not an HTTP responder; routes still send `res.status(...)`.
- Vendor code executed in `vm.ts` is untrusted user data — never assume it's safe.
