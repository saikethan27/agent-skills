# Subagent prompt templates

Fill the `<…>` parts. Keep the rules block in every prompt. Agents start cold, so they know only what the prompt says.

---

## 1. Feature builder

```
You are building feature group <X> of Phase <N> (<phase name>): tasks <list>.
Repo: <path> (<OS>; <how to run commands>).

Read, in order:
  <phase file>            (tasks <list> and the Verification contract items <list>)
  <contracts file> §<…>    (the decisions you build against; they override the spec)
  <folder-structure file>  (who owns what)
  <platform contract>      (outranks everything above)
  <spec sections>          (<rule ids>)
Read-only code you build on: <modules>, with their public API:
  <function signatures from earlier agents>

Write ONLY: <files and test folders>.
Another agent builds <files> in parallel. Do not touch them.

Required: <one paragraph per task: behaviour + the "Done when" test>.

Rules:
- If you need a change outside your paths, STOP and report. Do not make the edit.
- Do not edit shared or registration files, config, dependencies or fixtures.
- No secrets. Tests never need a real key; script model replies.
- No numeric literal for a threshold, limit, cap or timeout. Read settings.
- Scope comes from the request context only.
- The code never raises except cancellation; return typed outcomes.
- DO NOT git commit. The orchestrator commits.
- If a command hangs over 2 minutes, stop and report.

Run before finishing: <tests for your paths>; <lint>; <format check>; <type check>.

Report: each task done / not done; public API (the next agent imports it);
files created; command output; the test name for each contract item;
design choices a reviewer should check.
```

## 2. Verifier (turn 1)

```
You are verifying Phase <N> (<phase name>), verification turn 1 of 2.
You did not write this code. Assume nothing works.
Repo: <path>. The build commit is the one whose subject starts "<subject>" (use git log).
Files of other phases in the tree belong to parallel work: ignore them.

Read <phase file> and check the repository against EVERY task and its "Done when" line,
and against every item of the Verification contract. <contracts>, <folder structure>,
<platform contract> and <spec sections> define the rules. Confirm each requirement is
implemented in the code, not only that a test passes.

Probe specifically: <the risky behaviours, as a list>.

Judge these builder choices (gap or accepted, with evidence from the plan):
  <choice 1>, <choice 2>
Accepted, not gaps: <choices you already accepted>.

Rules:
- Judge the CODE, not commit messages or any report.
- Run every contract command and paste real output.
- A stubbed, hard-coded or skipped item is a GAP. A skipped test counts as not run.
- Check the negatives: paths outside the owned list (git show --stat), migrations,
  shared files edited, a key read, a hard-coded threshold, scope from the wrong place.
- Do not create databases or containers. Do not fix anything. Your only write is the report.
- If a command hangs over 2 minutes, stop and report.

Write <verification/phase-NN.md>:
  STATUS: pass | gaps
  CHECKED: one line per task and per contract item, with evidence
  GAPS: numbered — what the plan requires, what is there, exact path, smallest change.
        "none" if none.
Reply with STATUS and the gap count only.
```

## 3. Fix round: resume the builder

Send this to the **same agent** that built the file (resume it by its id or name).

```
Verifier gap <k> for Phase <N> (full text in <verification/phase-NN.md>):
<what is wrong, with the exact input and output>.

Fix in <file>: <the smallest change, or the two options and which to prefer>.
Add tests: <the failing case>; <the case that must still pass>.
Touch only <files>. No commit.
Run: <tests>; <lint>; <format check>; <type check>.
Report the gap closed, what you changed, and the output.
```

## 4. Fresh fixer (the builder cannot be resumed)

```
Phase <N> was verified and has gaps. You are the fixer for the one fix round.
Repo: <path>.

Read <verification/phase-NN.md> (the GAPS list is your task list), <phase file> (the plan),
and <spec sections>. The code is <files>, committed in the build commit; the tree is clean.

<For each gap: the exact problem, and the required design if the fix must change the approach.>

Rules: write only <files>. Fix only what the GAPS list names. Do not refactor anything else.
Keep every earlier behaviour. Do not weaken a test to make it pass; if an old test encodes
behaviour the fix removes, rewrite it and say so. No commit.
Run: <commands>. Report each gap closed, the changes, the tests that prove it, and the output.
```

## 5. Verifier (turn 2)

Same as turn 1, plus:

```
A previous verifier reported <n> gaps in <verification/phase-NN.md>. A fix round was
amended into the build commit. Check the repository again FROM SCRATCH against every task
and contract item; the fix may have broken something else. Confirm each earlier gap is
closed with your own probe, not only the new tests. Overwrite the report.
```

## 6. Targeted re-check (after a human-approved extra round)

```
You are the final verifier of Phase <N> after a human-approved extra fix round.
Part A: confirm the gap is closed with your own probes, and try new bypasses the fix
could have opened: <list>.
Part B: re-run the whole contract and confirm nothing regressed: <list of earlier fixes>.

Classification rule:
- GAP = an input a real user or model could plausibly produce that breaks a plan requirement.
- OBSERVATION = an exotic or adversarial form, or over-strict behaviour that is allowed.
Only gaps block. List observations with a one-line hardening each.
Reply with STATUS, the gap count and the observation count.
```

## 7. Milestone review

```
Review milestone <M> (phases <list>) against <README milestone gates> and every
"Done when" line of every phase. Write <verification/milestone-review.md>, one row per
finding: phase, task, type (missing | test failed | not matching requirement), evidence, file.
Include the items in <carry-over file>. Do not fix anything.
```
