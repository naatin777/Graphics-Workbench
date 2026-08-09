---
name: resolving-merge-conflicts
description: Resolve an in-progress Git merge, rebase, or cherry-pick conflict while preserving both change intents and unrelated worktree changes. Use when the user asks to inspect or resolve active conflicts. Do not assume that resolving conflicts authorizes aborting, committing, or publishing the result.
---

# Resolving merge conflicts

Resolve only the active conflict and preserve user authority over how the Git operation finishes.

## Procedure

1. Inspect `git status`, the active Git operation, recent history, and the exact unmerged paths.
2. Identify unrelated staged, unstaged, and untracked changes before editing. Do not overwrite, discard, or stage them as part of the conflict resolution.
3. Read the conflicting commits and nearby code to recover the intent of each side. Consult a PR or issue only when local history is insufficient and access is available.
4. Resolve each hunk with the smallest behavior-preserving result. Preserve both intents when compatible; when they conflict, follow the stated goal and report the trade-off. Do not introduce unrelated behavior.
5. Stage only the resolved conflict paths when staging is necessary to continue the requested Git operation.
6. Run the focused checks that can detect an incorrect resolution. Use `graphics-workbench-verify` for repository-specific verification.
7. Continue the merge, rebase, or cherry-pick only when the user's request includes completing that operation. Do not create a new commit, amend history, push, or publish solely because the conflicts are resolved.

If continuing would require a material product decision or the intended outcome cannot be recovered, stop and ask for direction. If the user explicitly asks to abort, inspect the operation and consequences before doing so; do not impose a blanket `--abort` prohibition.

Never bypass Git hooks. If continuing creates a commit, follow `never-disable-git-hooks` and fix hook failures instead of suppressing them.

## Report

- conflicts resolved and how competing intent was preserved;
- paths staged or deliberately left untouched;
- checks run and remaining uncertainty;
- whether the Git operation is resolved, continued, awaiting a decision, or still conflicted.
