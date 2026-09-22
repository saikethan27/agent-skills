# Build flow — PRD to shipped code

A general-purpose method. Nothing here is specific to one project — drop this file into any repo and follow it top to bottom.

## The whole thing in one line

```
PRD  →  gap review  →  base docs  →  phase plan  →  SETUP GATE (human)  →  first 2 phases in chat  →  subagent waves  →  milestone gate
```

Everything left of the setup gate is you and one chat. Everything right of it can be handed to subagents.

---

## Stage 1 — Write the PRD

```
you + chat  →  prd/
```

- What the product does and why. No stack, no schema, no folder names.
- Split by area, one file each, rather than one long document.
- Done when: every feature has rules, failure cases and acceptance scenarios.

## Stage 2 — Find the gaps

```
/prd-reviewer  →  gap list  →  fix PRD  →  /prd-reviewer again
```

- Run it **twice**. The second pass catches what the first pass's fixes broke.
- Look for: security gaps, logic gaps, missing failure paths, contradictions between documents.
- Done when: a pass returns nothing that would change the build.

## Stage 3 — Base docs

```
PRD  →  stack-decision.md  →  db-design.md  →  folder-structure.md
```

In that order — each one needs the last.

| Doc | Holds | Skip if |
|---|---|---|
| `stack-decision.md` | language, framework, data store, deployment targets | — |
| `db-design.md` | every table or collection, derived from the PRD's entities | no persistence |
| `folder-structure.md` | the repo tree, and **which paths each phase will own** | — |

- Iterate **2–4 rounds** across all three. They contradict each other early; that is normal.
- The ownership map in `folder-structure.md` is what makes parallel work safe later. Do not skip it.
- Done when: a round produces no changes.

## Stage 4 — Turn the PRD into phases

```
/prd-to-phases  →  implementation-plan/phases/
                     ├── README.md          (orchestrator prompt: graph, waves, loop)
                     ├── phase-00-*.md
                     └── phase-NN-*.md
```

Size each phase so **one subagent can own it end to end without touching another phase's files.**

Each phase file comes out with:

- Goal, dependencies, what it unlocks
- **Owns (exclusive write)** — the only paths this phase may touch
- Tasks, each with a "done when"
- **Verification contract** — checks against the code, not against commit messages
- Validation criteria for the milestone it closes

The README that ships beside them carries the dependency graph, the batch order, and the exact prompts for builder / verifier / fixer subagents.

> Build the `prd-to-phases` skill once with `/skill-creator`, using a finished `phases/` folder as the worked example. After that it is one command per project.

## Stage 5 — SETUP GATE (human only, do not skip)

```
you  →  credentials + config + accounts  →  verify locally  →  only then spawn anything
```

**This stage decides whether the later phases run clean.** A subagent that hits a missing key stops, guesses, or fakes it — all three cost more than doing this now.

Walk the phase files, list every external thing they touch, and settle all of it before the first spawn:

| Category | Typical items | Usually needed by |
|---|---|---|
| Data store | connection URL, credentials, a running instance | phase 0–1 |
| Object / file storage | endpoint, access keys, bucket | phase 0 |
| Crypto | encryption master key, session signing secret | phase 0 and the auth phase |
| Identity provider | OAuth client ID + secret, redirect URIs | the auth phase |
| Third-party APIs | keys, **sandbox or test accounts, never production** | the phase that integrates each one |
| Push / queue infra | topic, subscription, push endpoint — only if not polling | the async phase |
| System binaries | anything the image needs that is not a package | the phase that uses it |
| CI | repository secrets mirroring the local ones | phase 0 |
| **Non-credential decisions** | which variant to build first, which fixtures, sample data | the phase that needs them |

That last row is the one people forget. A subagent blocked on *"which of these do I build first?"* stalls exactly as hard as one blocked on a missing key.

Also:

- Fill the deployment profile / config completely. A half-filled config should fail at boot — that is the point.
- Commit an `.env.example` with names only. Never commit `.env`.
- Use synthetic test data. No real user data until whatever privacy gates you deferred have closed.

Done when: the stack comes up clean locally and config validation passes — **before a single subagent exists.**

## Stage 6 — Build the foundations yourself

```
phase 0 (skeleton)  →  verify  →  phase 1 (data layer)  →  verify
```

Keep the first two phases in the main chat, not in subagents. Every other phase inherits them, so a mistake here multiplies by however many phases follow. You want to read this code yourself.

## Stage 7 — Hand the rest to subagents

```
batch of 2  →  build  →  verify  →  gaps? fix once  →  verify  →  pass  →  next batch
```

- **2 subagents at a time. 3 at the very most.** The limit is your reading bandwidth, not the machine.
- **2 verification turns per phase. 1 fix round between them.** Still failing → escalate to you.
- **The verifier is never the builder**, and it judges the code, not the builder's report.
- Never start a batch until the previous one reads `pass`.

## Stage 8 — Milestone gate

```
all phases pass  →  end-to-end scenarios green  →  milestone done
```

Phases passing is not the milestone. The acceptance scenarios from Stage 1 have to run green too.

---

## Who does what

| Stage | You | Main chat | Subagents |
|---|---|---|---|
| 1 PRD | ✅ | helps draft | — |
| 2 gap review | reads | runs the skill | — |
| 3 base docs | decides | drafts | — |
| 4 phase plan | reviews | runs the skill | — |
| 5 setup gate | ✅ **only you** | — | — |
| 6 first 2 phases | reviews | builds | — |
| 7 remaining phases | escalations | orchestrates | ✅ build + verify |
| 8 milestone | signs off | runs e2e | — |

## Four rules worth remembering

1. **Nothing reaches a subagent before the setup gate closes.** Missing credentials are the biggest cause of a phase that looks done and is not.
2. **Exclusive path ownership is what makes parallel safe** — not good intentions. Two phases running together must never be able to write the same file.
3. **The verifier is never the builder.** A builder reads its own plan as satisfied, because its context holds what it meant to do.
4. **Two rounds, then a human.** If a gap survives one focused fix, the plan is wrong, not the code.
