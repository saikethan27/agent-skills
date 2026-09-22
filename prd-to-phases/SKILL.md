---
name: prd-to-phases
description: Convert a reviewed PRD and its base docs into an executable phase plan — an implementation-plan/phases/ folder holding an orchestrator README (dependency graph, waves, batches, builder/verifier/fixer prompts, status table), one file per phase with exclusive path ownership and a runnable verification contract, and a setup gate checklist. Use this whenever the user wants to break a PRD, spec, or requirements doc into phases; plan a build that parallel subagents will execute; set up a build → verify → fix loop; create an implementation plan, phase plan, roadmap of phases, or orchestrator plan; or asks anything like "how do I split this project into chunks I can hand to agents", "turn this spec into phases", "what order should we build this in", or "make a plan my subagents can run". Also use it when the user mentions wave planning, phase files, path ownership between agents, or says a PRD is finished and ready to build.
---

# PRD to phases

Turn a reviewed PRD plus its base docs into a folder of phase files that subagents can execute without colliding.

This is **Stage 4** of the build flow:

```
PRD → gap review → base docs → [PHASE PLAN] → setup gate → first 2 phases in chat → subagent waves → milestone gate
```

You write the plan. You build nothing, and you do not spawn builders — that happens after the human closes the setup gate you emit at the end.

## What you produce

```
implementation-plan/phases/
├── README.md              orchestrator prompt: vocabulary, graph, waves, rules, loop, subagent prompts, status table
├── SETUP-GATE.md          everything the human settles before the first subagent spawns
├── phase-00-<name>.md     one file per phase
├── phase-01-<name>.md
├── …
└── verification/          created empty; verifier subagents write their reports here
```

If the repo already has a planning folder with a different name (`docs/plan/`, `Implementation plan/`), put `phases/` inside it rather than inventing a second tree.

## Inputs — check these before writing anything

| Input | Why it is needed | If it is missing |
|---|---|---|
| PRD, already gap-reviewed | features, rules, failure cases, acceptance scenarios | Stop. A phase plan written over an unreviewed PRD copies its gaps into every phase file. |
| Stack decision | language, framework, data store, deploy targets | Ask. Verification contracts are runnable commands; you cannot write them without knowing the toolchain. |
| Data design | every table or collection | Skip only if the project genuinely has no persistence. |
| **Folder structure with a path-ownership map** | the `Owns (exclusive write)` list in every phase file comes straight from it | Build it first. This is the one input that makes parallelism safe. |
| Milestone list | which phases close which product milestone | Derive it from the PRD, then confirm with the human. |

## Step 1 — Inventory

Read the PRD end to end and write down, in scratch:

- Every capability the product must have, one line each.
- Every external system it touches (data store, object storage, identity provider, third-party APIs, queues, binaries).
- Every acceptance scenario — these become milestone gates, not phases.
- Every "not doing right now" / deferred item — these become explicit out-of-scope notes and, where they gate real data, warnings in the phase files that touch them.

## Step 2 — Derive the path-ownership map

From the folder-structure doc, build a table: **path → the one phase that may write it**. Every path in the tree gets exactly one owner, or is marked read-only-for-everyone.

Three categories, and each is handled differently:

| Category | Example shape | Rule |
|---|---|---|
| Owned tree | `src/<area>/**`, `web/src/features/<feature>/**` | Exactly one phase writes it. |
| Read-only | planning data, fixtures another phase produced | Any phase may read; none may write. |
| Shared, append-only | one error-code enum, config profiles | Keep this list to two or three files. Append, never reorder or rewrite. Name them explicitly in the README. |

If a path has two plausible owners, you have cut the phases wrong. Re-cut until every path has one.

## Step 3 — Cut the phases

**Sizing rule:** one phase = what one subagent can own end to end without touching another phase's files. Too big and the subagent runs out of context mid-phase; too small and you pay orchestration overhead for nothing. In practice a phase is a vertical slice with 6–12 tasks, each with an observable "done when".

### Structural rules that must be built into the plan

These are not style preferences — they are what stops parallel phases colliding later, and they can only be arranged now.

1. **Phase 0 is always the skeleton.** Repo tree, config loading and validation, error types, logging, adapter protocols, test harness, CI. It ships **auto-discovery**: routers, job handlers, and UI routes registered by convention — dropping a module into a directory exposes it. Every later phase adds a module instead of editing a shared registration file, so nothing ever has to write `main.py` twice at once. Phase 0's contract must include a test proving auto-discovery works.
2. **Phase 1 writes the entire schema in one migration** (when the project has persistence). Not "the tables I need" — all of them, from the data-design doc. Parallel phases on a linear migration history race and produce two heads. State plainly in the README: no phase after Phase 1 writes a migration without human approval. A genuinely missing column is an escalation, not a subagent's call.
3. **The first two phases are built in the main chat, by the human-facing agent — not handed to subagents.** Every other phase inherits them, so a mistake here multiplies by the number of phases that follow. Say this in the README and in both phase files.
4. **Shared files are few and append-only.** If the plan needs a fourth shared file, that is a signal to move whatever it holds into Phase 0.

### Cutting heuristics

- Split by **ownership boundary first, feature second**. Two features that write the same module belong in one phase, however unrelated they look.
- A phase that spans a library and the UI that renders it is fine — it is still one owner.
- Pure-library phases (no data store, no network) are the cheapest to run in parallel; schedule them against a data-heavy phase in the same batch.
- Anything gated on a deferred decision (compliance review, vendor approval) gets its own phase with the gate written into the file, so it can be dropped without unpicking another phase.

### Confirm before writing files

Show the human the phase list, the one-line goal for each, and the dependency graph. Get a yes. Writing sixteen files against the wrong cut is the expensive mistake here, and the cut is cheap to change while it is still a list.

## Step 4 — Collision check

Before the graph, prove the cut is safe. Build a matrix of phase × owned paths and check:

- No path appears under two phases.
- No two phases that could land in the same batch share a parent directory where one writes a file the other globs.
- Every phase's `Reads` list refers to something an earlier phase already produced, or to static planning data.

A failure here is a planning bug that surfaces later as two subagents overwriting each other. Fix it now.

## Step 5 — Graph, waves and batches

1. Draw the dependency graph as mermaid (`graph TD`), one node per phase.
2. **Waves** = the set of phases whose dependencies are all met. Waves run strictly in order.
3. **Batches** = how a wave is actually executed, because a wave is not a set you launch all at once.

> **Concurrency limit: two subagents at a time. Three only when all three phases are small and own completely separate trees. Never more than three.**
>
> The limit is the human's reading bandwidth, not the machine. Every extra subagent is another verification report to hold in context, another diff to merge, and another chance that two of them drifted the same way without anyone noticing.

Order batches inside a wave **by what they unblock** — the phase feeding the longest downstream chain goes first, so the critical path shortens. Put the reason in the table ("P3 + P5 first: P6 needs both"). An orchestrator that knows why the order is what it is can adapt when a phase slips; one that only has an order cannot.

Never start a wave until every phase in the previous wave reads `pass`.

## Step 6 — Write the phase files

Follow `references/phase-file-template.md`. Every phase file has: header table, Goal, Tasks with "done when", Verification contract, Out of scope.

The verification contract is the part that decides whether this method works. Write every item so a **read-only subagent can execute it without interpretation** and produce evidence: a command with an expected exit code, a grep that must or must not match, or a state check against the database or built artifact. "The feature works correctly" is not a contract item. "`<test command>` exits 0 and the fixture's output matches `expected.json` byte for byte" is.

## Step 7 — Write the orchestrator README

Follow `references/orchestrator-readme-template.md`. The three subagent prompts go in **verbatim** from `references/subagent-prompts.md`, with the project's own paths substituted — the README is handed to an orchestrator that will not have this skill loaded, so it must be self-contained.

**Vocabulary matters and the template fixes it:** milestone (product-level), phase (unit of work), orchestrator (the coordinating session, which spawns subagents and never builds a phase itself). Everything spawned is a **subagent** — builders, verifiers, fixers. Never write bare "agent" for a spawned worker; the ambiguity between "the orchestrator" and "the thing it spawned" is exactly where instructions get misread.

### The loop the README must encode

```
build ── CI ── verify ──pass──────────────────────────► phase done
                  │
                gaps ── fix once (amend) ── verify ──pass──► phase done
                                               │
                                             gaps ──► STOP, escalate to human
```

| Invariant | Why it is not negotiable |
|---|---|
| The verifier is **never** the subagent that wrote the code | A builder reads its own plan as satisfied, because its context holds what it meant to do. A fresh subagent reading only the tree does not have that bias. |
| The verifier is **read-only** and judges the code — not commit messages, not the builder's report | Those are claims about the code. A task that exists but is stubbed, hardcoded, or silently skipped is a **gap**, not a pass. |
| **Two verification turns per phase, exactly one fix round between them** | A gap that survives one focused fix is almost never a coding mistake. It is a plan asking for something the code cannot give, or a contract item ambiguous enough that two subagents read it two ways. More rounds burn context on the same disagreement. |
| The verifier writes a report to `phases/verification/phase-<NN>.md` in a fixed format | STATUS (`pass`/`gaps`), CHECKED (one line per contract item with evidence), GAPS (numbered: what the plan requires, what is actually there, the exact path, the smallest change that closes it). Fixed format is what makes the fix round a task list instead of an interpretation exercise. |
| Prefer sending gaps back to the **original builder** | It keeps its context — cheapest, and least likely to misread the plan. Spawn a fresh fixer only if that subagent is gone. |

## Step 8 — Emit the setup gate

Walk the phase files you just wrote and derive `SETUP-GATE.md` from them — not from a generic checklist. Follow `references/setup-gate-template.md`.

Nothing is handed to a subagent until the human closes that gate. **Missing credentials are the single biggest cause of a phase that looks done and is not** — a subagent that hits a missing key stops, guesses, or fakes it, and the third one is the expensive case because it passes verification.

The gate covers external dependencies by category (data store, object storage, crypto secrets, identity provider, third-party API keys with sandbox accounts, push/queue infra, system binaries, CI secrets) **and** non-credential decisions a subagent would otherwise stall on: which variant to build first, which fixtures, what sample data. That last category is the one people forget; a subagent blocked on "which of these three do I implement?" stalls exactly as hard as one blocked on a missing key.

## Commit policy — state this in every plan you write

**Exactly two commits per phase in the final history: one build commit, one verification commit.** Not one commit per task.

- The **fix round does not add a third commit.** It is amended or squashed into the build commit before the verification commit is made. Say this explicitly in the README and in the fixer prompt, or subagents will produce a history that contradicts the policy.
- Commit messages are descriptive, never a bare label. Templates are in `references/subagent-prompts.md` — build commits list tasks completed, files created vs edited, and the contract commands run with their results; verification commits carry the status, the number of contract items checked, and a pointer to the report file.

Two commits per phase is what makes the history readable at the scale this method operates at: one line per phase for what was built, one for whether it held up. Per-task commits bury that under noise, and they tempt a builder into committing a task that the contract later fails.

> Older plan folders produced before this policy say "one commit per task". **This policy supersedes it.** If you are editing an existing `phases/` folder, update its README rule and its builder and fixer prompts together — a half-updated README is worse than either policy, because two subagents will read it two ways.

## Quality bar before you hand the folder over

- [ ] Every phase file's `Owns` list is disjoint from every other phase in its wave.
- [ ] Every task has a "done when" that names an observable result, not an intention.
- [ ] Every contract item can be executed by someone who did not write the code.
- [ ] Phase 0 has an auto-discovery test in its contract; Phase 1 writes the whole schema.
- [ ] The README says the first two phases are built in the main chat.
- [ ] The README's three prompts are complete and copy-pasteable, with real paths.
- [ ] The commit policy appears in the rules section, the builder prompt, and the fixer prompt, and all three agree.
- [ ] `SETUP-GATE.md` lists something for every external system the phase files mention.
- [ ] No phase after Phase 1 writes a migration; no phase edits a registration file.

## Reference files

| File | Read it when |
|---|---|
| `references/phase-file-template.md` | Writing each phase file — template, worked example, and how to write a contract item that a verifier can execute. |
| `references/orchestrator-readme-template.md` | Writing `README.md` — full template including the rules, the loop, and the "when things go sideways" section. |
| `references/subagent-prompts.md` | The literal builder, verifier and fixer prompts, the commit message templates, and the verification report format. |
| `references/setup-gate-template.md` | Writing `SETUP-GATE.md`. |
