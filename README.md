# agent-skills

Reusable agent skills, plugins, and MCP packages.

| Package | What it is |
|---|---|
| [flow.md](flow.md) | The eight-stage build method — PRD → gap review → base docs → phase plan → setup gate → first two phases in chat → subagent waves → milestone gate. |
| [google-flow/](google-flow/SKILL.md) | **Google Flow Video & Studio Automation** — Unified package bundling the MCP server (`mcp/`), Antigravity/Claude plugin (`plugin/`), agent skill (`SKILL.md`), and automated 16:9 → 9:16 video batch runner. |
| [prd-to-phases/](prd-to-phases/SKILL.md) | Stage 4: turns a reviewed PRD into `implementation-plan/phases/` — an orchestrator README plus one file per phase, with exclusive path ownership, runnable verification contracts, and a setup gate checklist. |
| [parallel-build-loop/](parallel-build-loop/SKILL.md) | Stage 7: runs the phase plan with parallel subagents — splits each phase into features, picks the model and effort per feature by difficulty, verifies with a fresh agent, and sends gaps back to the agent that built the code. |
| [code-to-human-docs/](code-to-human-docs/SKILL.md) | The reverse direction: reads a finished codebase and writes `docs/human-docs/` — an architecture overview plus a page per subsystem, then validates every path, tree entry and link against the real repo. |
| [mcp/ui-token-gen/](mcp/ui-token-gen/SKILL.md) | OKLCH design tokens, CSS Color 4 gamut mapping, WCAG 2.1 + APCA contrast validation, fluid typography, and Three.js 3D scenes. |
