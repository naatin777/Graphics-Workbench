---
name: never-disable-git-hooks
description: >-
  Never bypass Git hooks. Use when working with git commit, git push, or any
  operation that runs pre-commit / pre-push / commitlint. Do NOT use
  --no-verify or -n. Fix the hook failure instead.
---

# Never disable Git hooks

`git commit --no-verify` and `git push --no-verify` (or `-n`) silently skip
the repository's pre-commit, pre-push, and commitlint hooks. This project
relies on those hooks to enforce format, lint, typecheck, build, and
Playwright smoke gates before anything reaches CI.

## Rule

- Never pass `--no-verify` or `-n` to `git commit`, `git push`, or any other
  command that would bypass hooks.
- When a hook fails, treat the failure as a real problem: read the hook
  output, fix the underlying issue, and re-run the commit/push without flags.
- Do not work around a hook failure with `--no-verify`, staging partial
  changes to dodge a check, or temporarily editing hook config.

## Why

Bypassing hooks pushes unverified changes to the remote, where CI then fails
(and branch protection may still block the merge). The cost of a hook run is
seconds; the cost of a red CI is a full retry loop.

## If a hook is genuinely broken

- Pre-commit `format` auto-fixes staged files (`stage_fixed: true`), so a
  format failure usually means the fixed files were not re-staged. Stage them
  and retry.
- Pre-push runs `npm run check:all` and `npm run build`. A failure here means
  the code does not pass the repo gates. Fix the violation, then retry.
- If a hook fails for an unrelated pre-existing reason, report it to the user
  instead of bypassing it.
