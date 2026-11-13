# Git safety for the orchestrator

Agents never commit. You make every commit, so every git mistake is yours. These rules come from mistakes made in a real build.

## Rules

1. **Stage only the phase's owned paths.** Use `git commit --only -- <paths>`. A plain `git commit` also commits whatever the user staged before (for example, a staged file deletion).
2. **Check `HEAD` before every amend.** After a verification commit, `HEAD` is no longer the build commit. An amend then merges the fix into the wrong commit.
3. **Never commit, unstage, stash or discard the user's own changes.** Note them at the start (`git status`) and compare after every commit.
4. **Never push** unless the user asks.
5. Two commits per phase: `<N> <what was built>` and `<N>.verify <result>`. A fix for an earlier phase gets its own commit: `<N>.fix <what>`.

## Commit a build with owned paths only

```bash
P="src/feature_a.py src/feature_b.py tests/feature_a tests/feature_b"
git add $P
git commit --only -m "<N> <what this phase built>

Tasks: ...
Created: ...
Contract: <command> -> <result>" -- $P
git show --stat --format= HEAD     # only owned paths?
git status --short                  # the user's staged changes still there?
```

## Amend a fix when HEAD is the build commit

```bash
test "$(git log -1 --format=%s)" = "<exact build subject>" || { echo "HEAD is not the build commit"; exit 1; }
git add $P
git commit --amend --only -m "<message with a 'Gaps closed:' line>" -- $P
```

## Fold a fix into an older build commit

Use this when a verification commit (or another commit) sits on top of the build commit.

```bash
set -e
# 1. Check the expected hashes first. Stop if they differ.
test "$(git log -1 --format=%h)" = "<top commit>"
test "$(git log -2 --format=%h | tail -1)" = "<build commit>"

# 2. Go back to the commit before the build, keep the files, unstage everything.
git reset -q --soft <commit before build>
git reset -q

# 3. Re-commit the build with only its owned paths.
git add -A $BUILD_PATHS
git commit -q --only -m "<updated build message>" -- $BUILD_PATHS

# 4. Re-commit the later commit with its original message.
git add $LATER_PATHS
git commit -q --only -C <old top commit hash> -- $LATER_PATHS

# 5. Restore what the user had staged (step 2 unstaged it).
git rm -q --cached <file the user had staged for deletion>   # example

git log --oneline -3
git status --short
```

Step 2's `git reset -q` unstages **everything**, including the user's staged changes. Step 5 must restore them exactly. Compare `git status` with what you noted at the start.

## If you make a mistake

1. Stop and check `git log --oneline -5`, `git show --stat HEAD` and `git status`.
2. Repair with `git reset --soft` and re-commit. Never use `--hard`; it deletes work.
3. Tell the user what happened and how you repaired it.
