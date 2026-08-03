# src/routes — REST API

Each `.ts` file here is **auto-registered** by `src/core.ts` as an Express router mounted at `/api/<path-from-src/routes>` (e.g. `src/routes/project/addProject.ts` → `POST /api/project/addProject`). Filename `[param]` becomes `:param`. **Never add routes by editing `src/router.ts`** — just create a new file.

Shared imports used by ~90% of handlers: `u from "@/utils"`, `z` (zod), `success/error from "@/lib/responseFormat"`, `validateFields from "@/middleware/middleware"`.

## Subdirectory map

| Dir | Purpose |
|---|---|
| `agents/` | Agent conversation memory management (`clearMemory`, `getMemory`). |
| `artStyle/` | Art-style presets: CRUD `o_artStyle`, style images to OSS, AI style-prompt extraction (`u.Ai.Text`). |
| `assets/` | Assets center: CRUD `o_assets` + `o_image` (leftJoin), audio assets, clip upload (base64 → `u.oss`), material lists, polling of generation state. |
| `assetsGenerate/` | Kick off AI generation of asset images (fire-and-forget `u.Ai.Image`, task in `o_tasks`) + prompt polishing + cancel. |
| `common/` | `getBigImage` — big image URL from a small thumbnail. |
| `cornerScape/` | Role→audio voice matching (AI picks audio per character, `o_assetsRole2Audio`). |
| `general/` | Dashboard: `generalStatistics`, single project get/update. |
| `login/` | `login` — JWT against `o_user` + `o_setting.tokenKey` (only whitelisted unauthenticated path). |
| `modelSelect/` | List/detail AI models from enabled vendors (`u.vendor.getModelList`). |
| `novel/` | Novel CRUD (`o_novel`); `novel/event/` = chapter events (`o_event`, `o_eventChapter`) + AI event generation via `new u.cleanNovel().start(...)` (emits progress via `.emitter`). |
| `other/` | Maintenance: delete all data, get version. |
| `production/` | Production: flow data (`o_agentWorkData`), storyboard CRUD (`o_storyboard`), `production/assets/` (storyboard-derived assets), `production/editImage/` (image-flow editor, `o_imageFlow` JSON nodes), `production/storyboard/` (panels, batch image gen + polling), `production/workbench/` (video tracks `o_video`/`o_videoTrack`, prompt gen, video gen + polling). |
| `project/` | Project CRUD (`o_project`), director manual, visual manual (reads skill `.md` from `data/skills`). |
| `script/` | Script CRUD (`o_script`, `o_scriptAssets`), export, AI asset extraction, polling. |
| `scriptAgent/` | Read/write agent plan in `o_agentWorkData` (storySkeleton / adaptationStrategy), script upsert. |
| `setting/` | Settings (see below). |
| `task/` | Task center: paginated `o_tasks` query with filters + categories/details. |
| `test/` | Dev stub. |

## setting/ subdirs

| Dir | Purpose |
|---|---|
| `about/` | Check app update / download installer. |
| `agentDeploy/` | Per-agent model deployment: `o_agentDeploy` keys (`scriptAgent`, `productionAgent`, `universalAi`, ...), simple/advanced mode. |
| `dbConfig/` | DB info via `sqlite_master`, clear table/data, export/import JSON. |
| `dev/` | Toggle AI dev-tool (`o_setting.switchAiDevTool`). |
| `fileManagement/` | `openFolder` — open a folder in the OS. |
| `loginConfig/` | User / password management (`o_user`). |
| `memoryConfig/` | Memory tuning: upsert key/values into `o_setting` (e.g. auto-summarization thresholds). |
| `modelMap/` | Bind image/video models to prompt files (`o_modelPrompt`), prompt CRUD. |
| `promptManage/` | `o_prompt` template CRUD. |
| `skillManagement/` | Skill `.md` files on disk + `o_skillList` CRUD. |
| `vendorConfig/` | Vendor CRUD (code compile via sucrase + `u.vm` sandbox + zod `vendorConfigSchema`), enable/disable, `modelTest/` (text/image/video tests against a vendor). |

## Conventions specific to routes

- New endpoints: file → zod `validateFields` → `u.db(...)` → `res.status(200).send(success(...))`. Errors: `res.status(4xx/5xx).send(error(...))`.
- Polling pattern: `.whereNot("state", "生成中")` (or `extractState`) to hide in-flight rows, then map `filePath` → URL via `u.replaceUrl` / `u.oss.getSmallImageUrl`.
- OSS uploads: base64 string → `u.oss.writeFile(path, buffer)`.
- Setting upserts: check key in `o_setting` then insert or update.
