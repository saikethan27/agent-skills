---
name: code-to-human-docs
description: Read an existing codebase end to end and write the human-readable orientation docs a new developer needs — a docs/human-docs/ folder holding an architecture overview (system diagram, annotated directory tree, data-flow traces, reading order, design principles, dependency chain) plus one deep-dive page per subsystem the project actually has, then validate every path, tree entry and link against the real repo. Use this whenever the user wants to document a codebase, write developer or onboarding docs, produce an architecture document or developer guide, explain how a project works to a human, create a docs folder for an existing repo, or asks anything like "document this project", "write human readable docs", "make docs so someone new can understand this", "explain the architecture of this repo", "we have no docs, generate them", or "write a README that explains the whole system". Also use it when the user mentions human docs, human-readable documentation, architecture overview, subsystem docs, codebase walkthrough, or onboarding a new engineer onto a repo.
---

# Code to human docs

Read a finished codebase and write the docs a person needs on their first day
with it — not an API reference, which the code already is, but the orientation
layer the code cannot provide: where execution starts, what happens end to end,
where to add a new one of these, and why it is shaped this way.

You read code. You write markdown. **You change no source file.**

## Where this sits

The base docs in the build flow (`stack-decision.md`, `db-design.md`,
`folder-structure.md`) are written *before* the code, from intent. These are
written *after*, from what is on disk. When the two disagree, **the code wins
and you say so** — a line in the overview noting where the plan and the build
diverged is one of the most valuable things on the page.

## What you produce

```
docs/human-docs/
├── README.md              the overview — the page everyone opens first
├── <subsystem>.md         one per subsystem the project actually has
└── <area>/                only when the repo has several deployables
    ├── README.md
    └── <subsystem>.md
```

If the repo already has a `docs/` tree, put `human-docs/` inside it. If it has
a docs site with its own conventions (`docs/content/`, `website/docs/`), follow
those conventions instead of inventing a second tree — say what you did and why.

**Scale the output to the repo. Three tiers:**

| Repo | Pages |
|---|---|
| Small — one concern, roughly under 30 source files | `README.md` alone, sections 1–4 of the overview template |
| Standard — one deployable, several areas | `README.md` + one page per subsystem, flat |
| Large — several deployables or a monorepo | Top `README.md` covering how the deployables relate, then a subfolder per deployable, each with its own `README.md` + subsystem pages |

There is no fixed page list. An API service, a worker fleet, and an agent
runtime get different pages because they *are* different — derive the set from
what you read, never from a checklist.

## The rule everything else depends on

> **Never document a file you did not open.**

Docs written from filenames and imports read exactly like docs written from the
code, right up until someone relies on one. An inferred step is worse than a
missing one, because the reader cannot tell it is a guess.

That does not mean reading every file in a large repo. It means the reading is
**tiered, and the tier is honest**:

| Tier | What | How you read it |
|---|---|---|
| **Spine** | entry points, bootstrap/config, the core orchestrator, domain types, and every file a documented flow passes through | **In full, top to bottom.** No skimming. These are what the overview describes. |
| **Cited** | anything else you name in the docs | Open it and read the region you are citing. Cite it by path. |
| **Skipped** | generated code, lockfiles, vendored deps, snapshots, fixtures, build output | Not read, not documented. |

If a subsystem is too large to read to the depth the page claims, write the page
to the depth you actually reached and say so in one line: *"This page covers the
request path; the batch reconciler in `<path>` is not yet documented."* A stated
gap is usable. A confident sentence over unread code is not.

## Step 1 — Survey

Cheap, whole-repo, before any reading. These four run in any git repo:

```bash
git ls-files | sed -n 's/.*\.\([A-Za-z0-9]*\)$/\1/p' | sort | uniq -c | sort -rn | head -20
```

```bash
git ls-files | awk -F/ 'NF>1{print $1"/"} NF==1{print "(root)"}' | sort | uniq -c | sort -rn | head -20
```

```bash
git ls-files -- ':!docs' ':!*.md' | grep -Ei '(^|/)(main|index|app|cli|server|worker|__main__|entry|bootstrap)\.[a-z]+$|Dockerfile|docker-compose|Makefile|(package|pyproject|go\.mod|Cargo)\.(json|toml|mod)$'
```

```bash
git log --format= --name-only -n 300 | grep . | sort | uniq -c | sort -rn | head -20
```

Extensions tell you the languages. The top-level census tells you the rough
shape. The third finds the doors into the system. The fourth — churn — tells you
**what people actually change**, which is what they will actually need
documented; a file touched forty times in the last three hundred commits earns
a page section, whatever the folder names suggest.

Then read the manifest (`package.json`, `pyproject.toml`, `go.mod`, …) for the
declared scripts and dependencies, and the CI workflow for how it is really
built and run. CI is more honest than any README.

## Step 2 — Read the spine

Entry points first, then follow the calls inward. Read each spine file
completely before moving on — the thing you need is usually not where you
expect it, and a skimmed file is how a wrong step gets into a data-flow trace.

While reading, keep a scratch list of:

- **Every entry point** and what triggers it.
- **Every hop** in each flow: file, function, what state exists after it.
- **Every boundary** — where one area hands off to the next, and what crosses.
- **Every surprise.** The thing you had to read twice. The name that means
  something non-obvious. The ordering constraint nothing enforces. These become
  Gotchas, and they are the highest-value lines in the finished docs.
- **Every claim you could not verify.** These become stated gaps, not guesses.

## Step 3 — Trace the flows end to end

Pick each entry point and follow one real execution all the way through, naming
the file and function at every hop. Do not stop at an interface — open the
implementation and find which one actually runs.

This step is what separates these docs from a folder listing. A reader who has
the request path in front of them can find anything else themselves.

## Step 4 — Cut the pages

A subsystem earns a page when the code actually separates it: its own entry
point, its own types, a boundary you can state in one sentence.

- Cut too fine and you get pages that link to each other mid-sentence. Merge.
- Cut too coarse and you get a page with two unrelated lifecycles. Split.
- Name pages after the thing (`worker.md`, `agents.md`, `billing.md`), never
  after the layer (`services.md`, `utils.md`). If a page needs a layer name,
  it does not have a subject.

**Link between doc pages; reference source files as inline code.** `[Jobs](jobs.md)`
is a link; a source file is `` `src/api/routes.py` ``, not a `../../` link into
the tree. Relative links out of the docs folder break the moment the folder
moves or the site renders from a different root — and the validator checks a
backticked path just as strictly as a link.

Show the human the page list with a one-line scope for each before you write
them. The cut is cheap to change while it is still a list.

## Step 5 — Write the overview

Follow `references/overview-template.md`. Eight sections: system diagram,
directory tree, data flows, reading order, subsystems, design principles,
dependency chain — wrapped in an orientation paragraph.

Two of those sections carry most of the value and are the ones most often
faked:

- **Data flow** — the arrow chains from Step 3, with real file and function
  names at every hop. Not "request → service → database".
- **Design principles** — the rules the code actually follows, each with the
  code that enforces it. If you cannot point at the enforcement, it is not a
  principle; move it to a Gotcha, where "nothing stops you from breaking this"
  is exactly the useful thing to say.

## Step 6 — Write the subsystem pages

Follow `references/subsystem-template.md`. The section people come back to is
**"Adding a new \<unit\>"** — write it by finding the last one that was added
and following what that commit touched:

```bash
git log --oneline -n 30 -- <subsystem path>
```

Say explicitly whether registration is a list someone edits or a scanner that
discovers by convention, and name the scanner. That one sentence saves more
time than the rest of the page.

## Step 7 — Validate

`validate.mjs` checks the docs against the repo they describe. Run it from the
repo root:

```bash
node <path-to-skill>/code-to-human-docs/validate.mjs docs/human-docs .
```

Both arguments are optional (`docs/human-docs` and `.` are the defaults). Four
checks, plus a coverage warning:

| Check | Catches |
|---|---|
| `PATHS` | a backticked path in prose that does not exist |
| `TREES` | a directory-tree leaf that does not exist — reconstructed from the indentation |
| `LINKS` | a relative markdown link to a missing file |
| `ORPHANS` | a page nothing links to, so no reader can reach it |
| `COVERAGE` *(warning)* | a top-level source directory the docs never mention |

Exit 0 clean, 1 on failures, 2 if it could not run. Real output:

```
docs: docs/human-docs  pages: 4  path claims: 13  links: 5

FAIL — 5 problem(s):

  LINKS (1)
    docs/human-docs/README.md:26  broken link: ghost.md

  ORPHANS (1)
    docs/human-docs/stranded.md  page is not linked from README.md (reader can never reach it)

  PATHS (2)
    docs/human-docs/README.md:25  no such path: src/api/nope.py
    docs/human-docs/README.md:25  no such path: totally_made_up.py (no file with this name anywhere in the repo)

  TREES (1)
    docs/human-docs/README.md:12  tree lists file that does not exist: src/api/missing.py
```

Three things about how it resolves a claim, so you can write for it:

- **A token with a `/` is resolved from the repo root.** `src/api/routes.py`
  must exist at that path.
- **A bare filename is resolved by basename, anywhere in the repo.** Docs
  legitimately say "create `main.py` and `service.py` under `<dir>`" — that
  passes, while a typo like `mian.py` fails.
- **Box diagrams are skipped, directory trees are checked.** Both use `├──` and
  `└──`; only a box diagram has top corners, so a fenced block containing
  `┌ ┐ ┬ ► ▼` is left alone. A tree must not contain those characters.

Fix and re-run until it passes. **A coverage warning is a decision, not a
failure** — plenty of directories deserve no mention. Say in the overview which
ones you deliberately left out, so the next person does not re-derive it.

What the validator cannot check is whether a sentence is *true*. It proves the
paths are real; only the reading in Steps 2–3 makes the descriptions real.

## Gotchas

- **The best line on any page is usually a swallowed error.** Auto-discovery
  loops that `except Exception: pass` so one bad module cannot kill the app are
  common, and they turn an import error into a silently missing endpoint or an
  unclaimed job kind. No README ever mentions this. You find it by reading the
  loop, and it is worth more to a reader than the rest of the page.
- **Import order is sometimes load-bearing.** A `load_dotenv()` above the
  imports, a `# noqa: E402` — that is a constraint someone will "tidy" and
  break. Document it where you find it.
- **Churn beats structure for deciding what to document.** The fourth survey
  command finds the files people actually change. They are often not the ones
  the folder names would have led you to.
- **The same concept can have two definitions.** Two error-code-to-HTTP maps in
  two components, a header cased differently on each side. Diff them rather
  than assuming the second is the first.
- **Defaults derived from filenames are traps worth naming.** "This key
  defaults to the module name" means renaming the file renames the key, and
  in-flight data keyed on the old name is orphaned.
- **Write the diagram and the tree as separate blocks.** They use the same
  characters and the validator tells them apart by the box corners; a block
  trying to be both is checked as neither.

## Quality bar

Before handing the folder over:

- [ ] Every spine file named in a data-flow trace was read in full.
- [ ] Every flow chain names real files and real functions at every hop.
- [ ] Every design principle names the code that enforces it.
- [ ] Every subsystem page states what it does **not** own, and names who does.
- [ ] Every "Adding a new X" section was derived from a real commit that added one.
- [ ] Gotchas are specific and surprising. If they would fit any codebase, cut them.
- [ ] Anything unread is marked as unread, not smoothed over.
- [ ] Divergences between the plan docs and the code are stated, not silently resolved.
- [ ] `validate.mjs` exits 0.
- [ ] No source file was modified.

## Reference files

| File | Read it when |
|---|---|
| `references/overview-template.md` | Writing `docs/human-docs/README.md` — the eight sections, how to draw the ASCII diagram, the tree format the validator can parse, and what to drop on a small repo. |
| `references/subsystem-template.md` | Writing each subsystem page — the template, what never belongs on one, and how to decide how many pages to cut. |
| `validate.mjs` | Step 7, and again any time the docs are edited. |
