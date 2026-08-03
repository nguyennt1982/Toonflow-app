# Business Knowledge Base

Hand-authored + generated documentation of Toonflow's domain logic. **Read `03` first** for the pipeline, then drill into details.

| Doc | Contents | Source |
|---|---|---|
| [`01-data-model.md`](./01-data-model.md) | All 26 DB tables (purpose, columns, PKs, indexes) | **Generated** — `yarn docs:data-model` (from `data/db2.sqlite`) |
| [`02-routes-map.md`](./02-routes-map.md) | All 169 REST endpoints grouped by module | **Generated** — `yarn docs:routes` (from code index) |
| [`03-agent-orchestration.md`](./03-agent-orchestration.md) | Agent workflows (scriptAgent, productionAgent), model resolution, memory, skills, end-to-end flow | Hand-written |

## Regenerate

```bash
yarn index:generate   # rebuild .opencode/index (required by 02)
yarn docs:routes      # → 02-routes-map.md
yarn docs:data-model  # → 01-data-model.md (needs data/db2.sqlite)
```

## Keep fresh

If you modify `src/routes/**`, `src/agents/**`, `data/skills/**`, or DB schema, regenerate the docs above so the business knowledge stays in sync with the code.
