# Phase file template

One file per phase, named `phase-<NN>-<short-slug>.md` with a zero-padded number so they sort. Copy the template, fill every row, delete nothing.

---

## Template

```markdown
# Phase <N> — <short name>

| | |
|---|---|
| Milestone | <M1 / M2 / …> |
| Wave | <n> (<runs alone | parallel with P<x>, P<y>>) |
| Depends on | <P<x>, P<y> | nothing> |
| Unlocks | <P<x>, P<y> | —> |
| Owns (exclusive write) | `<path>/**`, `<path>/<file>`, … |
| Reads (no writes) | `<path>`, <links to docs this phase reads> |
| Plan sources | <links to the PRD sections and base docs this phase implements> |

## Goal

<One paragraph. What is true after this phase that was not true before, in product terms.
Name the deliberate constraint if there is one — "this phase writes the whole schema at once,
so parallel phases downstream never race on migration history." A subagent that knows why a
constraint exists will not quietly work around it.>

## Tasks

- [ ] **<N>.1 <imperative, one line>** — <what it covers, any rule it must obey>. *Done when:* <observable check>.
- [ ] **<N>.2 …**

## Verification contract

<The command(s) a verifier runs first, in a fenced block. Then numbered items.>

```
<command>
```

1. <Command-level item: what must exit 0 / what output must appear.>
2. <Grep item: what must or must not appear in the code.>
3. <State item: what the database / built artifact / filesystem must show.>
4. …

## Out of scope

<What this phase must NOT do, and which phase owns it instead. Include anything a
reasonable subagent would otherwise drift into.>
```

---

## How to fill each part

### Header table

| Row | Rule |
|---|---|
| Milestone | The product milestone this phase contributes to. A milestone is several phases. |
| Wave | The number from the README's wave table, plus who it runs beside. The subagent does not schedule itself, but knowing it has a neighbour makes the ownership rule feel real. |
| Depends on / Unlocks | Both directions. "Unlocks" is what tells the orchestrator how to order batches. |
| **Owns (exclusive write)** | Copied from the path-ownership map. Globs where a whole tree is owned, exact files where a directory is shared between phases. If you cannot write this list precisely, the phase is cut wrong. |
| Reads (no writes) | Anything outside the owned paths the phase legitimately needs. Making it explicit is what lets the verifier flag an unexpected write. |
| Plan sources | Links, not summaries. The subagent reads them; do not make it guess which PRD section applies. |

### Goal

One paragraph, product-level. It exists so the builder can tell a task it misread from a task it understood. If the goal could describe three different phases, it is too vague.

### Tasks

Six to twelve. Each one is a thing a subagent does and then checks.

The **"done when"** is the whole point of the line. It must name something observable after the fact — a test that passes, a command that fails the way it should, a row that is or is not there. It is not a restatement of the task.

| Weak "done when" | Why it fails | Strong version |
|---|---|---|
| *Done when:* the loader is implemented | Restates the task; nothing to check | *Done when:* running it twice leaves the same row count, and the count matches the source file |
| *Done when:* validation works | "Works" is unverifiable | *Done when:* a config missing `<field>` fails at startup with a message naming that field |
| *Done when:* the boundary is respected | No evidence | *Done when:* the import contract fails if you add a deliberate violation |

Prefer a "done when" that describes a **failure** the code now produces correctly. Anyone can make a happy path pass; the failure path is where stubs show up.

### Verification contract

This is the section that decides whether the whole method works, because it is the only thing standing between "the builder says it is done" and "it is done".

Write every item so a **read-only subagent that did not write the code can execute it and produce evidence**. Three kinds, and a good contract has all three:

| Kind | Shape | Example |
|---|---|---|
| Command | A command plus the exit code or output that counts as a pass | `<lint> && <typecheck> && <test command>` all exit 0 |
| Grep | Something that must or must not appear in the source | Grep the service for numeric thresholds — there must be none; all come from `<config file>` |
| State | What the data store, built artifact, or filesystem must show | Every row created by this path carries `<flag>`; show the query and its output |

Rules for contract items:

- **Name the evidence.** "Show the count", "paste the output", "confirm the test exists and name the file". A contract item that can be answered with "yes" will be.
- **Cover the failure paths.** If the PRD lists nine failure cases, the contract says all nine must be reachable and shows what each returns. Stubs hide in the paths nobody asks about.
- **Check for the negative.** The strongest items are the ones that fail when someone takes a shortcut: no raw secret in any column, no hardcoded threshold, no float used for money, no registration file edited.
- **No interpretation.** If an item needs the verifier to decide what "reasonable" means, rewrite it or drop it.

### Out of scope

Short list. Two purposes: it stops a builder from wandering into the next phase's paths, and it gives the verifier grounds to not fail the phase for something it was never meant to do. Name the owning phase for each item.

---

## Worked example (generic)

```markdown
# Phase 4 — Notification delivery

| | |
|---|---|
| Milestone | M1 |
| Wave | 3 (parallel with P5) |
| Depends on | P1, P2 |
| Unlocks | P7 |
| Owns (exclusive write) | `src/<app>/notifications/**`, `src/<app>/api/routers/notifications.py`, `src/<app>/jobs/handlers/send_notification.py`, `tests/integration/notifications/**` |
| Reads (no writes) | `config/notification-rules.json`, `src/<app>/db/**` |
| Plan sources | [PRD 07 — notifications](../../prd/07-notifications.md), [data-design.md](../data-design.md) |

## Goal

A queued event turns into exactly one delivered notification per recipient per channel, or into a
recorded, typed failure that a human can act on. Delivery is idempotent because the queue is
at-least-once — a retried event must not double-send.

## Tasks

- [ ] **4.1 Channel adapters** behind the protocol from Phase 0, one per channel in the PRD. *Done when:* each adapter passes the shared adapter contract suite unchanged.
- [ ] **4.2 Rule resolution** from `config/notification-rules.json`, never hardcoded. *Done when:* changing the JSON changes which channel is chosen, with no code change.
- [ ] **4.3 Idempotent send** keyed by event + recipient + channel. *Done when:* replaying the same event twice produces one delivery row.
- [ ] **4.4 Typed failures** for every failure case in PRD 07. *Done when:* each returns a typed error and a next action; none leaks provider text to the user.
- [ ] **4.5 Bounded retry** with backoff and a dead-letter state. *Done when:* a permanently failing send lands in the dead-letter state instead of retrying forever.
- [ ] **4.6 Quiet-hours suppression** per the PRD rule. *Done when:* a suppressed notification is recorded as suppressed, not silently dropped.

## Verification contract

```
<test runner> tests/integration/notifications -v
```

1. Exits 0.
2. Replay one event twice → exactly one delivery row. Show the query and the count.
3. Every failure case in PRD 07 is reachable — trigger each and paste the response. No provider error text appears in any of them.
4. Grep `src/<app>/notifications/` for channel names and thresholds — there must be none outside the config loader.
5. A permanently failing send reaches the dead-letter state within the retry ceiling. Show both the attempt count and the final state.
6. A quiet-hours suppression writes a row with the suppression reason. Show it.
7. Each channel adapter is exercised by the shared adapter contract suite, not only by its own tests — name the file.

## Out of scope

Notification preferences UI (P7), digest batching (P9), and any new database table — the schema is
complete as of P1. If a column is genuinely missing, stop and report it.
```
