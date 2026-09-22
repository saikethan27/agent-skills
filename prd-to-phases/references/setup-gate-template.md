# Setup gate template

Written to `implementation-plan/phases/SETUP-GATE.md` as the last output of the skill.

**Derive it from the phase files you just wrote, not from this list.** Walk each phase's `Plan sources`, `Reads`, and task list, and write down every external thing it touches and every decision it assumes has been made. The categories below are a completeness check, not the content.

Two things to get right:

- **Attribute every item to the phase that needs it**, and to the earliest phase that needs it. That is what lets the human do the minimum work before the first spawn instead of all of it.
- **Include the non-credential decisions.** A subagent blocked on "which of these three variants do I build first?" stalls exactly as hard as one blocked on a missing API key — and is more likely to guess, because guessing feels allowed.

Everything below the rule is the template.

---

# Setup gate — close this before spawning any subagent

Status: open. Owner: the human. Nothing here can be delegated to a subagent, because most of it is credentials and the rest is judgement.

**Nothing is handed to a subagent until every box below is checked.** Missing credentials are the single biggest cause of a phase that looks done and is not: a subagent that hits a missing key stops, guesses, or fakes it — and the faked case passes verification.

## External dependencies

| # | Category | Item | Needed by | Done |
|---|---|---|---|---|
| 1 | Data store | connection URL, credentials, a running instance | P<n> | [ ] |
| 2 | Object / file storage | endpoint, access keys, bucket | P<n> | [ ] |
| 3 | Crypto secrets | encryption master key, session signing secret | P<n> | [ ] |
| 4 | Identity provider | OAuth client ID + secret, redirect URIs | P<n> | [ ] |
| 5 | Third-party APIs | keys, **sandbox or test accounts — never production** | P<n> | [ ] |
| 6 | Push / queue infra | topic, subscription, push endpoint | P<n> | [ ] |
| 7 | System binaries | anything the runtime image needs that is not a package | P<n> | [ ] |
| 8 | CI secrets | repository secrets mirroring the local ones | P<n> | [ ] |

Delete rows the project does not have. Add rows it does — this table is derived from the phase files, so if a phase mentions a service that is not here, the table is incomplete.

## Decisions a subagent would otherwise stall on

| # | Decision | Needed by | Chosen | Done |
|---|---|---|---|---|
| 1 | Which variant / provider / region is built first | P<n> | | [ ] |
| 2 | Which fixtures exist before the phase starts, and who makes them | P<n> | | [ ] |
| 3 | What sample data looks like, and where it lives | P<n> | | [ ] |
| 4 | <any rule the PRD left open that a phase must implement> | P<n> | | [ ] |

Write the choice into the table **and** into the phase file that needs it. A decision recorded only here is a decision the subagent will not read.

## Config and data hygiene

- [ ] The deployment profile / config file is filled completely. A half-filled config fails at boot — that is the point, not a bug to work around.
- [ ] `.env.example` is committed with names only. `.env` is ignored and never committed.
- [ ] Test data is synthetic. Every fixture carries a note saying so. No real user data enters the system until any deferred privacy or compliance gates have closed — no matter how many phases read `pass`.
- [ ] Secret material is referenced, never stored: config and database hold a reference or a path, not a value.

## Close the gate

- [ ] The stack comes up clean locally from a fresh checkout.
- [ ] Config validation passes.
- [ ] The test suite runs (even if almost everything is still empty) and CI is green.

Only then does the first subagent exist.
