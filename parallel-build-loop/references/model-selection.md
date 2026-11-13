# Model and effort selection

Pick the model per **feature**, not per phase. One phase can use all three models.

## The default table

| Feature type | Model | Effort | Why |
|---|---|---|---|
| Pure functions with a clear spec: formatters, mappers, merges, date math, small stores, gates that are pure functions | Haiku | low–medium | Fast and cheap; the spec does the thinking. |
| Code with moving parts: caches with fallbacks, async fan-out, prompt building, model calls with retries, parsers, cancellation | Sonnet | medium–high | Needs judgement about edge cases and failure paths. |
| Code where a mistake hurts users: validation of untrusted input, permission and scope handling, money, guards against wrong output, multi-turn state machines, the wiring that makes a feature live | Opus | high | A subtle bug here passes tests and costs the most. |
| Verifier for a normal phase | Sonnet | high | Reads the plan item by item and runs commands. |
| Verifier for a critical phase, after a hard fix, or after the orchestrator wrote a fix | Opus | high | Must find what the builder missed, with its own probes. |
| Fixer | the original builder | same as the build | It keeps the context. |
| Fresh fixer for a hard or repeated gap | Opus | high | A second failure means the problem is deeper than it looks. |
| Milestone review against every requirement | Opus | high | Cross-phase reasoning. |

## Move a feature up one level when

- it touches scope, permissions, money or untrusted input, even if it looks simple;
- it is a guard whose only job is to stop wrong output reaching a user;
- an earlier phase's verifier found gaps of the same kind;
- the builder must choose between readings of an ambiguous rule.

## Move a feature down one level when

- the plan gives exact signatures, cases and test names, and the code is a direct translation;
- the feature is test scaffolding or fixtures with no logic.

## Examples from a real build

| Feature | Picked | Result |
|---|---|---|
| Date resolution (closed token list, rollover hour) | Haiku, low | Done first try; one schema-shape gap fixed in the fix round. |
| Meta-card cache with stale fallback | Haiku, medium | Done; verifier found "empty card is cached", fixed by the same agent. |
| Validator for untrusted queries (whitelist, JSON Pointer paths, suggestions) | Opus, high | Passed after one fix round that was outside its files. |
| Planner (model call, one retry, normalisation) | Sonnet, high | One real gap (date filter stacking), fixed by the same agent. |
| Block emitters against a frozen schema | Haiku, medium | Two later gaps (bar of a time series, multi-measure KPI). |
| Insight number guard | Sonnet, high | Needed four rounds; should have been Opus from the start (see hard-cases.md §1). |
| Conversation turn flow (ask, proceed, refine, classify) | Opus, high | Done first try; it also found a real bug in an earlier phase. |

## When the user names models

If the user says which model to use ("use Haiku mostly", "use Opus for this"), follow it. You can still move a single security-critical feature up, but say so in one line.
