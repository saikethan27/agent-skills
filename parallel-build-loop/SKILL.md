---
name: parallel-build-loop
description: Run a phased build with parallel subagents and a build → verify → fix loop. Split each phase into features with their own files, pick the model (Haiku / Sonnet / Opus) and effort level per feature by difficulty and risk, run at most two agents at once, verify every phase with a fresh agent that did not write the code, and send gaps back to the builder agent that still holds the context. Use this whenever the user has a phase plan (for example from prd-to-phases) and asks to "build the phases", "use parallel agents", "run a build verify fix loop", "pick models by difficulty", "use Haiku/Sonnet/Opus per task", "resume the agent that built it", or "verify against the requirements". Also use it when resuming an interrupted multi-phase build.
---

# Parallel build → verify → fix loop

You are the **orchestrator**. You plan, spawn, check and commit. Subagents build and verify.

- You never verify your own code. If you write a fix yourself, a separate agent verifies it.
- The status table in the plan is the single source of truth. Update it on every state change.

## Before you start

You need all three. If one is missing, stop and tell the user.

1. A phase plan: one file per phase, with tasks, "Done when" lines, owned paths and a verification contract.
2. A status table (`not started → building → verifying → pass`).
3. A closed setup gate: credentials, services and decisions are in place.

Then check the machine: free memory, running containers, and `git status`. Note what the user has staged or changed. You must leave all of it exactly as it is.

## The loop for one phase

```
1. split the phase into features          (§1)
2. pick model + effort per feature        (§2, references/model-selection.md)
3. build features, max 2 agents at once   (§3)
4. orchestrator gate: lint, types, tests  (§4)
5. commit the build (owned paths only)
6. verify, turn 1 — fresh agent           (§5)
7. pass → commit verification → next phase
   gaps → fix: resume the builder         (§6)
        → amend build commit → verify, turn 2 (fresh agent)
8. gaps after turn 2 → stop, ask the human
```

All prompt templates are in [references/subagent-prompts.md](references/subagent-prompts.md).

### §1. Split the phase into features

Group the phase's tasks into features. Each feature:

- writes only its own files (two agents never write the same file), and
- can be tested alone.

Order the features by imports. A feature waits for the features it imports. Ask every builder to report its public API (functions and signatures) and pass that API to the next agent.

### §2. Pick the model and effort per feature

Pick by **difficulty and risk**, not by phase. When the plan is clear, most features are small: use the small model for them.

| Feature type | Model | Effort |
|---|---|---|
| Pure functions, mappers, formatters, simple stores | Haiku | low–medium |
| Caches, async flows, prompts, parsers, cancellation | Sonnet | medium–high |
| Security, scope, permissions, untrusted input, money, state machines, go-live wiring | Opus | high |

Verifiers use Sonnet (high) or Opus (high). Full rules and examples: [references/model-selection.md](references/model-selection.md).

### §3. Concurrency

- Run **two agents at once**. Three only when all three are small and own separate trees.
- Check free memory before each spawn. Low RAM makes commands hang.
- Run agents in the background, and work on the next thing while they run.
- Finish and verify a batch before you start the next batch.

### §4. Orchestrator gate before the verifier

A verifier turn is expensive. Do not spend one on a lint error. Before you spawn the verifier:

1. Run lint, format check, type check and import rules.
2. Run the phase's tests, then the full unit suite.
3. Check `git status`: the new files are only in the phase's owned paths.
4. Commit the build with **only the owned paths** (see [references/git-safety.md](references/git-safety.md)).

### §5. Verify with a fresh agent

The verifier never wrote the code, because a builder reads its own plan as done. Use the verifier prompt. It judges the code, runs every contract command, probes risky parts with its own inputs, and writes only its report.

Tell it which builder choices are already accepted, and which it must judge. Otherwise it reports the same accepted items every round.

### §6. Fix: resume the agent that built it

1. **Resume the original builder agent** with the gap list. It holds the context, so it fixes faster and misreads less.
2. A gap in a file from another feature goes to **that** feature's agent.
3. If the builder cannot be resumed (the session ended, or its transcript is gone), start a **fresh fixer** with the verifier's report, the phase file and the exact gap text.
4. The fixer fixes only the gaps and never commits. You amend the fix into the build commit.
5. A **new** verifier runs turn 2 and checks the whole phase again, because a fix can break something else.

### §7. Limits and escalation

- At most **two verification turns** and **one fix round** per phase.
- Gaps after turn 2: stop and ask the user. Give the exact input, the exact output and your recommended fix. Only the user approves an extra round.
- A gap that survives a focused fix is usually a plan problem or an ambiguous contract item.
- If each round finds new examples of the same kind of problem, you are in an endless loop. Read [references/hard-cases.md](references/hard-cases.md) §1.

### §8. Commit the verification

A second commit holds the verifier's report and the status-table update. Mark the phase `pass` only after that commit. The history is then two commits per phase: what was built, and whether it held up.

## Other situations

| Situation | Read |
|---|---|
| A fix must go into an older build commit; amending; the user's staged changes | [references/git-safety.md](references/git-safety.md) |
| An endless fix loop; a bug in an earlier phase; integration tests fail before your code runs; a flaky test | [references/hard-cases.md](references/hard-cases.md) |
| A rate limit or session end killed agents; resuming a build | [references/hard-cases.md](references/hard-cases.md) §4 |

## Talking to the user

- After each event, give a short status: what finished, what started, what is blocked. Use a table for phase state.
- Report failures with the exact output. A skipped test counts as not run, never as passed.
- Admit your own mistakes (a wrong amend, a lost staged change) and say how you repaired them.
- Ask the user only for real decisions: an extra fix round, a contract change, a new dependency, a setting, or a new container.

## Checklist per phase

- [ ] Phase split into features with owned files, in dependency order
- [ ] Model and effort picked per feature
- [ ] At most two agents at once; memory checked
- [ ] Orchestrator gate green
- [ ] Build committed with owned paths only; the user's staged changes untouched
- [ ] Fresh verifier, turn 1
- [ ] Gaps sent to the agent that built that file (resumed, not respawned)
- [ ] Fix amended into the build commit; `HEAD` checked first
- [ ] Fresh verifier, turn 2 (full phase, not only the gaps)
- [ ] Verification committed; status table says `pass`
- [ ] Observations written to the carry-over file for the milestone review
