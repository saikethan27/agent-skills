# agent-skills

Reusable agent skills and the build method they belong to.

| | What it is |
|---|---|
| [flow.md](flow.md) | The eight-stage build method — PRD → gap review → base docs → phase plan → setup gate → first two phases in chat → subagent waves → milestone gate. |
| [prd-to-phases/](prd-to-phases/SKILL.md) | Stage 4: turns a reviewed PRD into `implementation-plan/phases/` — an orchestrator README plus one file per phase, with exclusive path ownership, runnable verification contracts, and a setup gate checklist. |
| [code-to-human-docs/](code-to-human-docs/SKILL.md) | The reverse direction: reads a finished codebase and writes `docs/human-docs/` — an architecture overview plus a page per subsystem, then validates every path, tree entry and link against the real repo. |
