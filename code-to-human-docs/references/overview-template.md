# Overview page template — `docs/human-docs/README.md`

This is the page a new developer opens first. It has one job: get someone from
"I just cloned this" to "I know where to look" in one read.

Eight sections, in this order. Sections 5–8 are droppable on a small project
(see the scaling note at the bottom) — the first four never are.

Everything in `<angle brackets>` is yours to fill. Delete the guidance notes.

---

## Template

````markdown
# <Project> — architecture

<Two or three sentences. What this system is, who it serves, and what shape it
takes — "a Python service that ingests webhooks and fans them out to workers",
"a Next.js app with a Rust sidecar for indexing". Then point onward: "Each
subsystem below links to its own page; start with the reading order if this is
your first day.">

## System overview

<ASCII box diagram. Layers top to bottom in the direction execution flows:
entry points at the top, the core in the middle, storage and outbound
integrations at the bottom. See "Drawing the diagram" below.>

```
┌─────────────────────────────────────────────────┐
│  Entry points                                   │
│  <HTTP API>      <CLI>      <Scheduler>         │
└───────────────────────┬─────────────────────────┘
                        │
              ┌─────────▼─────────┐
              │   <Core>          │
              │  <component A>    │
              │  <component B>    │
              │  <component C>    │
              └────┬─────────┬────┘
                   │         │
       ┌───────────▼──┐   ┌──▼──────────────┐
       │ <Persistence>│   │ <External deps> │
       └──────────────┘   └─────────────────┘
```

## Directory structure

<Annotated tree. Only the directories a reader needs on day one — prune
generated output, lockfiles, and anything with no decision in it. Every leaf
gets a margin comment saying what lives there, not what it is named.>

```
<repo>/
├── <src>/
│   ├── <api>/            <one line: what this owns>
│   ├── <core>/           <…>
│   └── <workers>/        <…>
├── <tests>/              <…>
└── <config file>         <…>
```

## Data flow

<One H3 per entry point. An arrow chain naming the real functions and files an
execution actually passes through — this is the section readers come back to.
Name the file for each hop so the chain is followable with a grep.>

### <Incoming HTTP request>

```
<client> → <src/api/routes.py:handler>
         → <src/core/validate.py:validate_payload>
         → <src/core/service.py:execute>
         → <src/db/repo.py:persist>
         → <response>
```

### <Scheduled job>

```
<scheduler> → <…> → <…>
```

## Recommended reading order

<A numbered path through the codebase for someone new. Each item is a file or
a page plus a one-line reason. Order by dependency, not importance: the thing
with no imports first. Six to ten items — more than that is not an order, it is
the file list again.>

1. [`<config file>`](<link>) — <what starts here, and what it proves about the rest>
2. [`<entry point>`](<link>) — <…>
3. …

## Major subsystems

<One H3 per subsystem, each a short paragraph and a link to its own page. The
paragraph answers "would I need to open this?" — not "what functions does it
export". One subsystem here = one page under this folder.>

### <API layer>

<What it is responsible for and what it deliberately is not. Where its boundary
with the next subsystem sits.>

→ [<API layer>](<api.md>)

### <Worker>

<…>

→ [<Worker>](<worker.md>)

## Design principles

<The rules the codebase actually follows, each with how it shows up in the code.
Derive these from what you read, never from what a README claims. If you cannot
point at the code that enforces a principle, it is not a principle — it is a
wish, and it goes in the subsystem page's Gotchas instead.>

| Principle | What it means in practice |
|---|---|
| <Single writer per table> | <All writes go through `<path>`; no other module imports the db client.> |
| <Fail closed on config> | <`<path>` validates every key at boot and exits non-zero; a half-filled `.env` never reaches a request.> |

## File dependency chain

<ASCII stack showing what imports what, base at the bottom. This is the section
that tells a reader where a change is safe. Follow it with one paragraph naming
the rule the stack encodes — "nothing below the line may import anything above
it" — and what breaks if it is violated.>

```
        <src/cli.py>    <src/server.py>     ← entry points
                  \        /
               <src/core/service.py>        ← orchestration
                       │
               <src/core/model.py>          ← domain types
                       │
               <src/db/repo.py>             ← persistence
```

<One paragraph: the rule, and the symptom when someone breaks it.>
````

---

## Drawing the diagram

ASCII, not Mermaid. It survives a terminal, a diff, and a `grep`, and it is
readable in any editor a person happens to have open.

- **Direction is execution, not importance.** Top = what triggers the system.
  Bottom = what the system triggers.
- **Box what you can name.** A box labelled "Business logic" teaches nothing.
  A box labelled `core/service.py` can be opened.
- Keep to **three or four layers**. More than that and you are drawing the
  file tree, which the next section already does.
- Characters: `┌ ┐ └ ┘ ─ │ ├ ┤ ┬ ┴ ▼ ►`. Use one style for the whole document.
- Fence it plain (no language tag, or ```` ```text ````) so the validator reads
  trees inside it and nothing tries to syntax-highlight it.

## Writing the tree so the validator can check it

`validate.mjs` reconstructs each leaf path from the indentation and asserts the
file exists. It reads a tree only when:

- the fence is untagged or tagged `text`/`tree`/`plain`, and
- branches use `├──` / `└──` with **4-space nesting**, and
- a comment is separated from the name by **two or more spaces**, and
- the block contains **no box-drawing corners** (`┌ ┐ ┬ ► ▼`) — those mark it as
  a diagram, which is skipped, because box edges reuse the same `├──` and `└──`.

A bare first line (`myrepo/`, `src/`, or `.`) sets the base for everything
below it. Names containing spaces or parentheses — `(generated)`, `… 12 more` —
are skipped, so eliding is fine.

Keep the two apart: the system diagram in section 2 draws boxes, the tree in
section 3 draws a tree. A block that tries to be both gets checked as neither.

## Linking

Link **between doc pages** — `[Jobs](jobs.md)`. Reference **source files as
inline code** — `` `src/api/routes.py` `` — not as `../../` links into the
tree. Relative links out of the docs folder break as soon as the folder moves
or a docs site renders from a different root, and the validator checks a
backticked path just as strictly as it checks a link.

## Scaling — what to drop

| Repo size | Keep |
|---|---|
| Under ~30 source files, one concern | Sections 1–4 only, one page, no subsystem pages. Drop reading order, subsystems, dependency chain. |
| One deployable, several areas | All eight sections. One subsystem page per area. |
| Several deployables, or a monorepo | All eight, plus a subfolder per deployable (see SKILL.md Step 4). The overview's system diagram shows deployables; each subfolder gets its own smaller overview. |

Dropping a section is a decision, not a shortcut: a four-section page for a
four-file project is correct. A four-section page for a 400-file project means
you stopped reading early.
