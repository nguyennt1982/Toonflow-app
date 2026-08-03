---
name: toonflow-knowledge-index
description: "Use when the user asks ANYTHING about the Toonflow project (code, routes, sockets, agents, schema, storyboard, image/video gen) or its repo container: delegate the task to opencode run in /root/git-research, restore/maintain the knowledge base, and back it up before teardown."
version: 1.3.2
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [toonflow, knowledge-base, rag, embeddings, code-index, container-lifecycle]
    related_skills: [opencode, hermes-agent-skill-authoring]
---

# Toonflow Knowledge Index

## Overview

The Toonflow repo (checked out as `git-research`) carries a 4-layer agent knowledge base so an agent can answer code/domain questions without re-reading the whole tree:

1. `AGENTS.md` (root + `src/agents|routes|socket|utils/`) — layered protocols.
2. Symbol index — `.opencode/index/code-index.{json,txt}` + `index.meta.json`.
3. Business docs — `docs/business/01-data-model.md`, `02-routes-map.md`, `03-agent-orchestration.md`.
4. Semantic embeddings — `.opencode/index/embeddings.json` (384-dim, local ONNX model), built incrementally from per-file stores in `.opencode/index/embeddings/`.

The container is **ephemeral** (Hermes-created sandbox): anything not pushed to git dies with it. A full embedding rebuild takes ~10 min, so the per-file stores are snapshotted to the fork's `kb-index` branch and restored in seconds. `origin` = **`nguyennt1982/Toonflow-app`** (the fork); the upstream `HBAI-Ltd/Toonflow-app` is **never** pushed to.

## When to Use

- Hermes spawns a fresh Toonflow container, or the user asks for anything Toonflow-related (code, routes, schema, agent behavior, storyboard/image/video generation).
- The user modifies Toonflow source and the knowledge base needs re-syncing.
- A Toonflow container is about to be torn down and its knowledge base must survive.

## Mandatory Bootstrap (step 0, non-negotiable)

Before ANY Toonflow work, in this exact order — this is what makes the system automatic:

1. **Work from the repo directory.** `cd /root/git-research` (or clone there first if missing). The whole session MUST run with `/root/git-research` as its working directory.
2. **Read `AGENTS.md`** in that directory. It is the single source of truth for the retrieval/maintenance protocol. If you skip this, you WILL guess wrong (raw greps over the tree time out and miss files — e.g. `src/socket/` exists but a tree-wide grep can miss it).
3. **Verify the index is fresh:** run `yarn index:check`. If it prints `STALE` or `NO_INDEX`, run `yarn index:generate` (~15s) once.
4. Only then start answering or editing.

## Rules (non-negotiable)

1. **Never raw-grep the whole source tree for code questions.** Tree-wide `search_files`/`grep` over `/root` (with node_modules) times out and yields false negatives. For "where is X defined / used": grep `grep -i X .opencode/index/code-index.txt` (fast, precise) or run `yarn index:search "<english query>"`.
2. **Scope any file search to `/root/git-research/src`** — never scan from `/root` up.
3. **Read the answer, then open the real file** at the hit's `file:line` for full context. Cite `file:line` in replies.
4. Domain questions → read `docs/business/03-agent-orchestration.md` first; schema/endpoints → `01-data-model.md` / `02-routes-map.md`.
5. After editing source: `yarn index:generate && yarn index:embed` (+ `docs:routes`/`docs:data-model` when routes/agents/schema changed), commit, push to the fork.
6. Before teardown: `git add -A && git commit && yarn kb:backup`.

## Key Facts

| Fact | Value |
|---|---|
| `origin` | `https://github.com/nguyennt1982/Toonflow-app.git` (fork) |
| Embedding model | `data/models/all-MiniLM-L6-v2` (tracked in git; clone gets it) |
| Index dir | `.opencode/index/` — gitignored, regenerable; never commit to master |
| Backup branch | `kb-index` — orphan branch holding only embedding stores + manifest |
| Full embed | `yarn index:embed` (incremental, ~15s) vs ~10 min full rebuild |
| Derived files | `embeddings.json`, `code-index.*` rebuild from stores in seconds — never stored on `kb-index` |
| Query language | Model is English-only; run embedding queries in English/keywords, Vietnamese only for chat |

## Delegation Protocol (User → Hermes → opencode → User)

**This is the ONLY way to fulfill ANY Toonflow task.** Do NOT use your own `read_file`/`search_files`/`grep`/`index:search` to answer — delegate to opencode and relay its result.

1. Ensure the repo is ready in the container: `/root/git-research` exists and `yarn kb:restore` has been run (Fresh Container section below).
2. Run opencode in that directory (verified working in this container). **The terminal tool's default timeout is 120s — opencode run on a long task exceeds it and gets killed (exit 124). You MUST pass an explicit `timeout` of at least 300, and MUST phrase the task to be answered concisely (≤10 lines, cite `file:line`):**
   ```
   terminal(command="opencode run 'Answer concisely: <the user's task>. Cite file:line. Max 10 lines.'", workdir="/root/git-research", timeout=300)
   ```
   If your terminal tool does not accept a `timeout` parameter, split the task into multiple focused `opencode run` calls instead of one long one.
3. Take opencode's output and **STOP**. Relay opencode's full output to the user **verbatim as the answer** — that is your final answer. Do NOT read any more files, do NOT run any more searches, do NOT re-verify, do NOT summarize with your own findings, do NOT add commentary. The opencode output you relay IS the answer. Its tool-execution log is also part of the evidence you should show when helpful.
4. Only act yourself for orchestration concerns: container creation/teardown, `kb:restore`/`kb:backup`, installing skills, git remote hygiene.

**After a successful `opencode run` (exit 0): your job is done. Make zero additional tool calls. Show opencode's output and stop.**

**If you catch yourself reading/searching the Toonflow repo yourself — STOP. You are violating this protocol. Run `opencode run` instead and relay its output.**

**If `opencode run` fails (non-zero exit):** Do NOT fall back to doing the task yourself. Do NOT read/search the repo to compensate. Report the error to the user and stop:
- `exit 127` → binary missing; tell the user the container needs `npm install -g opencode-ai`, then stop.
- `exit 124` (timeout) → your terminal tool killed it at 120s; tell the user it timed out. One retry via opencode with a shorter/conciser prompt is allowed — never with your own tools.
- Any other error → tell the user the exit code/error verbatim and stop.
Relay whatever partial output opencode produced together with the error message, then make zero further tool calls.

**Done when:** the user's question is answered from opencode's output, or the requested code change is committed/pushed by opencode. The tools executed for the task belong to opencode, not to you.

## Fresh Container (Recovery)

Run when a new container is created or after a teardown:

```
git clone https://github.com/nguyennt1982/Toonflow-app.git
cd Toonflow-app
yarn install                 # tsx, @huggingface/transformers, onnxruntime-web, etc.
npm install -g opencode-ai   # put `opencode` on PATH (/usr/local/bin) — required for delegation
yarn kb:restore              # fetch kb-index → restore stores → rebuild derived indexes
yarn index:check             # must print FRESH
yarn index:search "socket auth middleware"   # sanity: returns ranked file:line hits
```

**Done when:** `index:check` prints `FRESH` and `index:search` returns plausible top hits.

## Ongoing Session (Maintenance)

1. If `.opencode/index/` exists, run `yarn index:check` (fast). If it prints `STALE` or `NO_INDEX`, run `yarn index:generate` (~15s) once before answering code questions.
2. After editing source (routes, agents, skills, schema):
   - `yarn index:generate` — reindex symbols.
   - `yarn index:embed` — re-embed only changed files (incremental).
   - If routes/agents/schema changed: `yarn docs:routes && yarn docs:data-model` to keep `docs/business/` in sync.
   - Commit + push to the fork (`origin`, master).
3. Never edit generated files: `src/router.ts`, `src/types/database.d.ts` — they regenerate from source.

**Done when:** `index:check` is `FRESH` and no stale docs/scripts remain uncommitted.

## Retrieval

| Question type | Command | Why |
|---|---|---|
| Exact symbol ("where is X defined/used") | `grep code-index.txt` or query `code-index.json` | fast, precise |
| Concept/fuzzy ("which code handles X") | `yarn index:search "natural language query" [--top N]` | semantic ranking |
| Domain ("how does the production agent work") | Read `docs/business/03-agent-orchestration.md` first | curated answer |
| DB schema / endpoints | `docs/business/01-data-model.md`, `02-routes-map.md` | generated, always regenerable |

Open the top `file:line` hits for full context before answering.

## Before Teardown

If the container has re-embedded after the last snapshot (or if any knowledge work is uncommitted):

```
git add -A && git commit -m "..."      # push all work to origin master
yarn kb:backup                          # ensure fresh embed + push stores to origin kb-index
```

**Done when:** `git status` clean, `yarn kb:backup` prints `pushed <sha> -> origin kb-index`, and `git ls-remote origin kb-index` shows the new sha.

## Common Pitfalls

1. **Pushing to upstream `HBAI-Ltd/Toonflow-app`.** It's someone else's repo. `origin` is the fork; double-check `git remote -v`.
2. **Committing `.opencode/index/` to master.** It's gitignored by design; the expensive part lives on `kb-index`, the rest regenerates in seconds.
3. **Expecting `kb-index` merged into master.** It's an orphan backup branch — fetch/restore only, never merge.
4. **Running a ~10 min full embed** when incremental suffices. `index:embed` re-embeds only changed files (hash-based); only a model/chunker/format change forces a full rebuild.
5. **Backing up after re-embedding without a new `kb:backup`.** The snapshot only reflects the last backup; always re-run `kb:backup` after embedding new content.
6. **Embedding queries in Vietnamese/Chinese.** The model is English-centric; translate queries to English/keywords first.
7. **Forgetting `yarn install` in a fresh container.** Scripts use `tsx` and `@huggingface/transformers`; clone alone is not enough.

## Verification Checklist

- [ ] `git remote -v` shows only the fork (`nguyennt1982/Toonflow-app`)
- [ ] `yarn index:check` prints `FRESH`
- [ ] `yarn index:search "<english query>"` returns ranked `file:line` hits
- [ ] After source edits: index + docs regenerated, committed, pushed
- [ ] Before teardown: `git status` clean and `yarn kb:backup` pushed
