# Hard cases

## 1. The endless fix loop

Some gaps can never be closed by patching. A guard against free text is the typical case. Each round blocks the forms the verifier found, and the next verifier finds new forms.

Real example: a guard had to stop invented numbers in a one-line summary.

| Round | Fix | Next verifier found |
|---|---|---|
| 1 | Titles of failed blocks no longer count as proof | "Rs. 9,999" cut the sentence at "Rs." |
| 2 | Abbreviation list for the sentence splitter | "Avg.", "Jan.", "etc." still cut it; scans were quadratic |
| 3 | Judge the whole text as one unit; length cap; linear scans | "Rs 5 lakh", "5k", "5x" passed when "5" was on screen |
| 4 | Scale words after a number | "5-lakh", "5 times", "five", "doubled" passed |
| 5 | Closed rule: no number words anywhere; a digit must stand alone | "a third", "threefold", "zero" passed |
| 6 | Add those words; normalise look-alike digits | pass, with observations only |

Signs you are in the loop:

- Every round finds new examples of the **same kind** of problem.
- Every fix adds items to a list.

What to do:

1. **Fix the class, not the example.**
   - Judge the whole input as one unit, never fragments.
   - Prefer an allow-list ("a number must stand alone; only these characters may follow it") over a block-list ("these suffixes are bad").
   - Bound the input size before any scan, and make every scan linear. Test with 32k and 200k character inputs.
   - Dropping too much is usually allowed for an optional feature. Letting a wrong output through is not.
2. **Tell the model the rule too.** If the guard drops a form, the prompt must forbid that form, or the feature drops almost everything in production.
3. **Classify findings** in the verifier prompt:
   - GAP = an input a real user or model could plausibly produce that breaks a plan requirement.
   - OBSERVATION = an exotic or adversarial form, or over-strict behaviour that is allowed.
   - Only gaps block. Observations go to a carry-over file for the milestone review.
4. **Use the strongest model** for the fix after the second failure.
5. **Ask the user** before each extra round, and say what will be different this time.

## 2. A bug in an earlier, passed phase

An agent building phase N finds a bug in phase N-2's code.

1. Do not let the current agent patch it. It owns other files.
2. Confirm the bug yourself: read the code and reproduce it.
3. Fix it in its own commit, `<N-2>.fix <what>`. Add a test that **fails before** the fix and **passes after** it (check both: stash the fix, run the test, restore).
4. Run the full unit suite.
5. Tell the current agent what changed. If its test fakes copied the bug (for example, a fake service that behaves unlike the real one), it must update the fakes to match the real system and add assertions that would have caught the bug.

Real example: the planner added a date filter to every query. The block renderer treated it as a chart column and needed an annotation that the real query engine never returns. So every KPI would have failed in production, while all unit tests passed, because the fake engine annotated the filter. The turn-flow agent found it; the fix was three lines plus a test.

## 3. Integration tests fail before your code runs

1. Run the suite **without** the new code first. That is the baseline.
2. Read the first real error, not the count. "Relation does not exist" means the test database has no schema.
3. Find how earlier runs set up the database (verification reports, CI files, test fixtures). Do the same. Example: start a throwaway Postgres in memory, then run the backend's migrations into it.
4. Use only throwaway databases and containers. Never the development data. Ask the user before you start a new container, unless they approved it before.
5. Remove the throwaway containers when the phase is done.
6. A test that fails in the full run and passes alone is order-dependent or flaky. Run the full suite again. Record it; do not hide it.

## 4. Rate limits, ended sessions and lost agents

A rate limit or a session end kills running agents. Their in-memory work is gone.

After a restart:

1. Read the status table.
2. Read `git log --oneline` and `git status`.
3. Check the dead agent's owned files for partial edits (`git diff --stat -- <paths>`).
4. Decide:
   - Build commit and no verification commit: the phase was interrupted between the two. Re-verify; do not rebuild.
   - Partial edits and no commit: read them. Usually start a fresh agent with the same prompt plus "the tree may hold partial work; finish or replace it".
   - Clean tree: start the step again.
5. An agent id from an old session cannot be resumed. Start a fresh fixer with the verifier's report.
6. If agents keep dying, the orchestrator may write a small, well-specified fix itself. A separate agent still verifies it.

## 5. A builder needs a change outside its paths

1. It stops and reports. It never makes the edit.
2. You decide:
   - A missing setting, dependency or test marker: a gap in the foundation phase. Ask the user before you add it.
   - A shared type is wrong: stop both phases that use it; fix it once; re-run their tests.
   - Prefer a local workaround inside the builder's own files when it is clean. Example: Windows lacked a timezone database; instead of a new dependency, the date module got a small fixed-offset fallback for the default zone.

## 6. The verifier and the builder disagree

The contract item is ambiguous. That is a plan defect. Rewrite the item in the phase file (and the contracts file if a shared decision moves), then re-verify. Do not judge between two agents' readings yourself.
