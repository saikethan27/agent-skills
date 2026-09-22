# Subsystem page template — `docs/human-docs/<subsystem>.md`

One page per subsystem the project actually has. Name the file after the thing,
not the layer: `worker.md`, `agents.md`, `billing.md`, `ingest.md` — not
`services.md` or `utils.md`. If you cannot name what a page is about in one
noun, it is not a subsystem, and its content belongs in a page that is.

A subsystem page is for the developer who has been sent here to change
something. It answers: where does this start, what happens in order, where do I
add mine, and what will bite me.

---

## Template

````markdown
# <Subsystem>

<One sentence: what this owns. Then one sentence on what it deliberately does
not own, naming the subsystem that does. The boundary is the most useful thing
on the page and the first thing that rots.>

| | |
|---|---|
| Lives in | `<path>/**` |
| Entry points | `<path/file.ext:symbol>`, `<…>` |
| Talks to | <subsystem or external service>, <…> |
| Owned by | <team or CODEOWNERS entry, if the repo says; otherwise drop this row> |

## How it works

<The lifecycle, in order, as numbered steps. Each step names the file and the
function, so a reader can follow along with the code open. This is the body of
the page — if it is shorter than the sections around it, you summarized instead
of tracing.>

1. **<Step>** — `<path:symbol>` <what happens, and what state exists after it
   that did not before>.
2. **<Step>** — <…>
3. …

<If the subsystem has more than one distinct path — a hot path and a retry
path, a read path and a write path — give each its own numbered list under an
H3. Do not interleave them.>

## Key types and contracts

<Only the types a caller must understand to use this. Two to five of them. For
each: where it is defined, what it guarantees, and what it does not. Skip the
field-by-field listing — the code has that and it will be wrong here inside a
month.>

| Type | Defined in | What it guarantees |
|---|---|---|
| `<Name>` | `<path>` | <invariant a caller can rely on> |

## Adding a new <unit>

<The extension point, as a concrete recipe. This is the section people will
actually copy. Walk the steps of the last one that was added — find it in the
history and follow what that change touched.>

1. Create `<path>/<name>.<ext>` <following the shape of `<existing example>`>.
2. <Register it / it is auto-discovered — say which, and name the mechanism.>
3. <Test to add, and where.>
4. <Verify: the exact command, and what a correct result looks like.>

<If registration is by convention rather than a list, say so explicitly and
name the scanner — that is the single most useful sentence on the page.>

## Failure modes

<What breaks, how it surfaces, and what the system does about it. Retries,
timeouts, dead letters, partial writes. Derived from the error handling you
read, not from what would be sensible.>

| When | What happens | Where it surfaces |
|---|---|---|
| <downstream timeout> | <retried N times with backoff, then …> | <log line, metric, table> |

## Gotchas

<The things that cost someone an afternoon. A gotcha is specific and
surprising: an ordering constraint that is not enforced, a name that means
something different here, a config value that is read once at boot, a test that
passes for the wrong reason. If this section is generic, you have not read
enough of the code yet.>

- **<Short label>** — <what looks true, what is actually true, and where.>

## Related

- [Overview](README.md)
- [<Adjacent subsystem>](<file.md>) — <why a reader would cross over>
````

---

## What does not go on these pages

- **Function-by-function reference.** The signature is in the code, it is
  correct there, and it is wrong here within a release. Document the contract,
  not the parameter list.
- **Restated code.** "The `process` function processes the item" is a line of
  text that has told a reader nothing. If a step reduces to the name of the
  function, delete it.
- **Anything you did not open.** See the rule in SKILL.md — an inferred step is
  worse than a missing one, because the reader cannot tell it is a guess.
- **Aspirations.** "Eventually this will move to a queue" belongs in an issue.
  If the code has a TODO you think matters, quote it with its path and say it
  is a TODO.

## Choosing how many pages

One page per subsystem **the code actually separates** — a directory with its
own entry point, its own types, and a boundary you can describe in a sentence.

Signals you cut too fine: two pages that keep linking to each other mid-step;
a page whose "How it works" is three lines. Merge them.

Signals you cut too coarse: a page with two unrelated lifecycles; an "Adding a
new X" section that has to ask "which kind of X?". Split it.

Typical shapes worth a page of their own, when the project has them: the HTTP
or RPC surface, the background worker or job runner, the data layer and its
migrations, authentication and session handling, an AI/agent loop and its tool
dispatch, the frontend's state and data fetching, the build and deploy path,
and each external integration that owns its own retry and credential story.
