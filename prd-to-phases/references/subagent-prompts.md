# Subagent prompts, commit templates, report format

These go into the generated `README.md` **verbatim**, with `<placeholders>` replaced by the project's real paths and commands. The README is handed to an orchestrator session that will not have this skill loaded, so nothing here may stay as a pointer.

Terminology, used consistently in all three prompts: the **orchestrator** is the coordinating session; everything it spawns is a **subagent** (builder, verifier, fixer).

---

## 1. Builder prompt

```
You are building Phase <N> of <project name>.

Read, in this order:
  <plan-dir>/phases/phase-<NN>-<name>.md     your plan — every task in it is in scope
  <plan-dir>/folder-structure.md             where files go, naming, boundaries
  the PRD files linked in your phase file

Rules:
- Write only inside the paths under "Owns (exclusive write)" in your phase file.
  If you need a change outside them, STOP and report it — do not make the edit.
- Do not create database migrations. The schema already exists.
- Do not edit any registration file (app entrypoint, route table, handler registry).
  Registration is by convention; if something is not being discovered, report it.
- Every task's "done when" is a real check. Run it before you call the task done.
- Before finishing, run the commands in your phase file's "Verification contract"
  and record the results — you will need them in the commit message.

Commit: ONE commit for the whole phase, made when every task is done. Not one per task.

  Subject: P<N> <what this phase built, in plain words>
  Body:
    Tasks: <N>.1 … <N>.<k> — one line each, what was actually done
    Created: <paths>
    Edited:  <paths>
    Contract: <each command from the verification contract> → <result>

Report back: tasks completed, tasks not completed and why, files created vs edited,
the contract commands you ran with their output, and any change you needed outside
your owned paths.
```

## 2. Verifier prompt — read-only, a different subagent

```
You are verifying Phase <N>. You did not write this code. Assume nothing works.

Read <plan-dir>/phases/phase-<NN>-<name>.md and check the repository against its
"Verification contract" section, item by item.

Rules:
- Judge the CODE. Not the commit messages, not the builder's report, not the plan's intent.
- Run every command listed in the contract. Paste real output — never a summary you assume.
- A task that exists but is stubbed, hardcoded, or silently skipped is a GAP, not a pass.
- Check the negatives too: paths written outside the phase's "Owns" list, a migration that
  should not exist, a registration file that was edited.
- Do not fix anything. Do not write application code. Your only write is your report.

Write your report to <plan-dir>/phases/verification/phase-<NN>.md in this format:

  STATUS: pass | gaps

  CHECKED:
  <one line per contract item — the item, pass/fail, and evidence: file:line or command output>

  GAPS:
  <numbered. For each:
     what the plan requires
     what is actually there
     the exact file path
     the smallest change that would close it>
  <"none" if there are none.>

Then reply with STATUS and the gap count only.
```

## 3. Fixer prompt — only when STATUS is `gaps`

Send the gaps to the **original builder subagent** if it is still alive (it keeps its context, so it is both cheapest and least likely to misread the plan). Spawn a fresh fixer only if that subagent is gone.

```
Phase <N> was verified and has gaps. Close them.

Read <plan-dir>/phases/verification/phase-<NN>.md — the GAPS list is your task list.
Read <plan-dir>/phases/phase-<NN>-<name>.md for the original plan.

Same rules as the build: write only inside your phase's owned paths, no migrations,
no edits to registration files, no edits outside your paths.

Fix only what the GAPS list names. Do not refactor anything else — a fix round that
touches unrelated code makes the second verification unreadable.

Commit: do NOT add a new commit. Amend your changes into the phase's existing build
commit so the final history stays at two commits per phase. Update that commit's body
to include the gaps you closed.

Report back: each gap, what you changed, and the check you ran to confirm it is closed.
```

---

## 4. Commit policy and message templates

**Exactly two commits per phase in the final history.** A fix round produces no third commit.

```
build ──(gaps? amend into the build commit)── verify ── verification commit
```

### Build commit

Written by the builder when the phase is complete, amended by the fixer if there is a fix round.

```
P<N> <what was built — a sentence, not a label>

Tasks:
  <N>.1 <what was done>
  <N>.2 <what was done>
  …
Created: <path>, <path>
Edited:  <path>, <path>
Contract:
  <command> → <result>
  <command> → <result>
```

A bare `P4 notifications` tells a reader nothing three weeks later, and tells a verifier nothing at all. The body is where the phase's diff becomes reviewable without re-reading it.

### Verification commit

Written by the orchestrator after the verifier reports, once the report file exists.

```
P<N>.verify <pass | gaps closed after one fix round>

<k> contract items checked, <k> pass, <n> gaps <closed | escalated>.
Report: <plan-dir>/phases/verification/phase-<NN>.md
```

### Why two, not per task

Per-task commits bury the two facts anyone actually needs — what the phase built, and whether it held up — under a dozen lines of noise. They also tempt a builder into committing a task that the contract later fails, which leaves the history claiming something the code does not do. Two commits per phase keeps `git log --oneline` readable at the scale this method runs at: one line per phase of work, one line per phase of judgement.

> Older plan folders may say "one commit per task". This policy supersedes it. If you update a folder, update the rules section, the builder prompt and the fixer prompt together — a half-updated README gets read two different ways by two different subagents.

---

## 5. Choosing subagent types

| Role | Needs | Notes |
|---|---|---|
| Builder | write access | A general-purpose subagent. |
| Verifier | write access to **one** file | A general-purpose subagent instructed to write nothing but its report. A strictly read-only agent type cannot write the report file. |
| Fixer | write access | Prefer the original builder over a fresh spawn. |

Count every spawn against the concurrency limit. Two builders plus their two verifiers is four spawns, but only two run at once — verification happens after its builder reports, not alongside it.
