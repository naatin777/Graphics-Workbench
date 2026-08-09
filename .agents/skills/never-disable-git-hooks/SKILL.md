---
name: never-disable-git-hooks
description: >-
  Never bypass Git hooks. Use when working with git commit, git push, or any
  operation that runs pre-commit / pre-push / commitlint. Do NOT use
  --no-verify. Fix hook failures instead of suppressing them.
---

# Never disable Git hooks

`git commit --no-verify`, `git commit -n`, and `git push --no-verify` skip
repository hooks. This project relies on those hooks to enforce format, lint,
typecheck, build, and conditional Playwright smoke gates before publication.

`git push -n` means `--dry-run`; it does not bypass hooks and is not prohibited
by this skill.

## Rule

- Never pass `--no-verify` to `git commit` or `git push`, and never pass `-n`
  to `git commit`.
- When a hook fails, treat the failure as a real problem: read the hook
  output, fix the underlying issue, and re-run the commit/push without flags.
- Selective staging is valid when it matches the intended commit. Do not
  stage, unstage, or edit hook configuration solely to evade a failing check.

## Why

Bypassing hooks can publish unverified changes and defeat the repository's
local quality gates. Hook runs may be substantial, especially pre-push, but
their cost is intentional and must not be avoided by weakening verification.

## If a hook is genuinely broken

- Pre-commit `format` auto-fixes staged files (`stage_fixed: true`), so a
  format failure usually means the fixed files were not re-staged. Stage them
  and retry.
- Pre-push runs Docker `check:all`, the host build, and a conditional packaged
  Playwright smoke check. Fix the violation, then retry.
- If a hook fails for an unrelated pre-existing reason, report it to the user
  instead of bypassing it.
