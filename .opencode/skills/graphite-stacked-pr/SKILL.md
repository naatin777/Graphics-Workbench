---
name: graphite-stacked-pr
description: Use when working with the Graphite CLI (gt), stacked PRs, upstack/downstack branches, restacking, splitting large changes across multiple PRs, or repairing a Graphite stack. Use ONLY for Graphite-specific workflows (gt create/modify/submit/sync/restack/continue/abort/undo/track/split/move/reorder/fold/pop/absorb/log/info); do NOT use for plain git operations, single-commit work, or GitHub operations unrelated to stacked PRs.
compatibility: Graphite CLI 1.8.x (verified against 1.8.6)
metadata:
  version: '0.1.0'
---

# Graphite Stacked PR (gt)

Graphite (`gt`) manages PRs as a **stack**: each branch is a PR whose diff is relative to its parent branch. This skill governs the judgment and operations around creating, editing, restacking, submitting, and repairing stacks safely.

## Basic principles

- Treat Graphite as a stack model, not a git alias collection. The unit of work is the branch (a PR), and branches carry explicit parent/child dependencies.
- Keep each PR small, semantically coherent, and independently reviewable. A branch must be explainable without its upstack.
- Keep branch dependencies explicit: a branch's diff is "its parent plus its own changes", so ordering matters.
- Prefer short stacks and incremental landing over deep, long-lived stacks. Typical stack size is 2–5 branches; treat that as an operational guideline, not a Graphite limitation.
- Confirm Git, Graphite, and worktree state before mutating operations.
- Do not publish to remote, merge, or perform destructive structural changes without explicit user approval.

## Supporting references

- Read `references/stack-design.md` when deciding how to split a non-trivial change into a stack.
- Read `references/commands.md` when choosing a command, resolving conflicts, restructuring a stack, or recovering.
- Run `scripts/inspect.sh` when state is unclear or before a large change. It is read-only and safe.

## Mandatory initial checks

Before creating, editing, restacking, restructuring, or submitting a stack, run at minimum:

```bash
git status --short
git branch --show-current
git worktree list
gt --version
gt log short
```

Then identify:

1. The trunk branch (`gt trunk` or the initialized trunk in `gt log`).
2. The current branch.
3. The current branch's parent (`gt parent`).
4. The full relevant stack (`gt log short`).
5. Whether any related branch is checked out in another worktree (`gt log` shows worktree paths when multiple worktrees exist; `git worktree list`).
6. Staged, unstaged, and untracked changes (`git status --short`).
7. Whether the operation is local-only or affects remote PRs (`gt submit`, `gt sync`, `gt merge` touch remote; `gt create/modify/restack/track` are local history operations).
8. Whether Graphite is initialized (`gt log` succeeds). If `gt init` is required, confirm the intended trunk with the user — do not guess it.

## Operation permissions

### Allowed without approval

Read-only inspection and the ordinary local edits/branch creation that the user has already requested. Examples:

```bash
git status --short
git branch --show-current
git worktree list
gt --version
gt log short
gt log long
gt info
gt info --diff
gt parent
gt children
```

If the user has already asked you to implement something, normal local edits and local branch creation (`gt create` for an already-requested change) are permitted. Still inspect state first.

### Explicit approval required

Treat the following as remote side effects or destructive history changes; get explicit approval first:

- `gt submit` (creates/updates PRs, force-pushes to remote branches)
- Creating or updating PRs on GitHub
- Publishing a draft PR (`gt submit --publish`)
- Merging PRs or a stack
- `--force` options (e.g. `gt sync --force`, `gt undo --force`, `gt absorb --force`)
- Deleting remote branches
- Discarding uncommitted changes
- Structural changes with unclear intent: `gt move`, `gt reorder`, `gt fold`, `gt pop`, `gt split`, `gt untrack`
- Commands that may rewrite commit history — before running `gt sync`, `gt restack`, or `gt modify`, show the user the working-tree state and the affected scope and get confirmation.

## Single PR vs. Stack

Use a single PR when:

- The change is already atomic.
- It can be reviewed independently.
- It does not hide a prerequisite change.
- Splitting would not improve reviewability or safety.

Use a stack when:

- Multiple changes have a real dependency order.
- Splitting makes review easier.
- Test, rollout, and rollback become safer.
- A later change clearly builds on an earlier one.

Never split a stack just to make file counts even.

If a stack would exceed ~5 branches, reconsider whether:

- multiple independent features are mixed together,
- an early slice can be merged to trunk first,
- migration phases can be separated,
- too much transient context is being held for review,
- CI/restack cost is too high.

## Stack planning

Before editing, present the planned stack bottom-to-top. For each branch, state: branch name, purpose, dependency reason on its parent, files/subsystems touched, observable behavior change, tests/verification, and whether it can safely merge before its successors.

Typical ordering (bottom to top):

1. Behavior-preserving preparation/refactor.
2. New abstraction, schema, or compatibility layer.
3. Core behavior change.
4. Caller/integration migration.
5. Cleanup after migration.

Do not mix unrelated renames, formatting, or cleanup into the bottom of a feature stack.

## Stack creation

Do not pre-create empty branches. The preferred flow is:

1. On the current parent branch, make that PR's changes.
2. Verify them (run the relevant minimal tests).
3. Stage the target files (`gt add <paths>`).
4. Create the child branch with its changes: `gt create -m "<imperative message>"` (or `gt create -am "<message>"` when all changes should be staged).
5. Inspect the result: `gt info --diff` and `gt log short`.
6. Proceed to the next upstack change.

Each branch should keep a minimal, relevant test run green before moving on.

## Tracking existing git branches

When moving an existing branch under Graphite management, inspect the git history and parent relationship first, then use `gt track`. Do not infer the parent from the branch name alone.

To split an existing large branch into a stack, first analyze the diff and commit history and propose a semantic split. Structural changes such as `gt split` require approval before execution.

## Fixing within a stack

Put a fix on the branch that semantically owns the change. Example: for a stack `trunk <- A <- B <- C`, a bug in behavior introduced in A should be fixed in A, not patched at C to avoid a restack.

Preferred flow (v1.8.x supports `--into`):

```bash
gt checkout <branch>        # or gt modify --into <branch> from upstack
gt modify -a
```

If the fix must remain a separate commit, use `gt modify -c` to create a new commit instead of amending.

`gt modify` automatically restacks descendants. After fixing, verify:

```bash
gt log short
gt info --diff
```

Re-run the upstack integration tests affected by the downstack change.

## sync and restack

Before `gt sync`, check: uncommitted changes, relevant worktrees, the scope that trunk updates will rebase, which merged local branches may be cleaned up, and that remote communication occurs. After it, confirm with `gt log short` and `git status --short`.

Do not blindly repeat `gt restack`. Identify the lowest broken or misaligned branch first. When the CLI supports it, narrow the scope: `gt restack --only`, `gt restack --downstack`, `gt restack --upstack`, or `gt restack --branch <name>`.

## Conflict resolution

When a Graphite operation stops on a rebase conflict:

1. Identify which branch is being replayed.
2. Inspect the conflicts.
3. Resolve them without changing unrelated behavior.
4. Stage only the resolved files: `gt add <resolved-paths>`.
5. Continue: `gt continue`.
6. Re-check the whole stack (`gt log short`).
7. Re-run the relevant tests.

Do not use `gt continue -a` (stage everything) unless staging all changes is intentional. If the intended resolution is unclear, abort (`gt abort`) instead of guessing.

## submit

Submit is a remote side effect — always require prior approval. Before submitting, report: which branches/PRs will be created or updated, whether the submit targets only the current branch or the whole stack, draft vs. published, executed tests and results, unresolved risks, and the PR dependency order.

Use the scope and draft flags verified against the installed CLI:

```bash
gt submit --no-edit                    # current branch + downstack
gt submit --stack --no-edit            # + descendants
gt submit --draft --no-edit            # new PRs as drafts
gt submit --publish --no-edit          # publish drafts
gt submit --dry-run                    # report what would be submitted, no remote change
```

After submitting, report: PR/stack URLs, stack order bottom-to-top, draft/published status, which existing PRs were updated, and remaining review dependencies.

## merge and cleanup

Merge a stack with Graphite's native `gt merge` from the CLI. Do not use the GitHub Merge button or `gh pr merge` for stacked PRs: merging individual PRs that way deletes the base branch and can auto-close upstack PRs. `gt merge` merges the PRs for all branches from trunk up to the current branch via Graphite; `gt sync` then deletes merged branches and restacks the remaining stack onto the updated trunk.

### Positioning

- Whole stack: move to the top of the stack with `gt top`.
- Partial stack: move to the last branch you want merged. `gt merge` merges trunk up to and including the current branch only.

### Procedure

Run the checks in this order every time:

```bash
git status --short
git worktree list
gt --version
gt merge --help
gt log short

# whole stack: gt top; partial: checkout the last branch to merge

# confirm merge target
gt merge --dry-run

# run only when the reported PRs match intent
gt merge --confirm

# reconcile local state after merging
gt sync
gt log short
git status --short
```

### Safety rules

- Never merge without running `gt merge --dry-run` first.
- Never run `gt merge` unless `gt merge --help` confirms it is a native Graphite command.
- Stop immediately if `gt merge` would run `git merge` as a git passthrough.
- Never merge with uncommitted changes in the working tree.
- If a relevant branch is checked out in another worktree, confirm the impact before merging.
- Abort if the reported merge target includes unintended PRs.
- If `gt merge` fails or stops on a conflict, do not continue merging manually from GitHub; diagnose and resolve before retrying.
- Always run `gt sync` after merging to clean up merged branches and restack the remaining stack, then verify with `gt log short` and `git status --short`.
- Before an Agent runs `gt merge` or `gt sync` (remote updates or history changes), present the target and obtain explicit user approval.

Editing the same file across multiple stacked PRs is allowed; each PR just needs a coherent diff against its parent branch.

## Stack restructuring

Before any structural change, show the current and desired topology:

```text
Current:
trunk <- A <- B <- C

Desired:
trunk <- A <- C <- B
```

Then explain: which parent/child relationships change, which branches get rebased, which PR base branches change, which diffs may change, conflict likelihood, and worktree impact. Only use commands that exist in the installed CLI (`gt move`, `gt reorder`, `gt split`, `gt fold`, `gt pop`, `gt absorb`); confirm each against `gt <cmd> --help`.

## Recovery

If the CLI supports undoing the last Graphite mutation, use it (`gt undo`). Do not use undo as a substitute for understanding state.

If Graphite metadata and git ancestry look inconsistent, stop mutating operations and collect:

```bash
git status --short
git log --graph --oneline --decorate --all
git worktree list
gt log long
```

Then compare: git parent/child relationships, Graphite metadata relationships, which branch is checked out in which worktree, any in-progress rebase/Graphite operation, and remote tracking branches. Before deciding the intended topology, do not trial-and-error `gt track`, `gt move`, or `gt restack`. If a branch has diverged from Graphite's tracking (a warning gt emits after out-of-band git history edits), use `gt track <branch> --parent <branch>` to re-align it — but confirm the intended parent with the user first.

## worktree

Graphite supports multiple git worktrees. Behavior verified against CLI 1.8.x and the official docs:

- Before operations, check that no related branch is checked out in another worktree (`gt log` shows the worktree path; `git worktree list`).
- A branch can only be checked out in one worktree at a time. Graphite does not modify branches checked out in another worktree, and exits with an informative error rather than crossing into that worktree.
- If one stack spans worktrees, run `gt sync` / `gt restack` / `gt get` from each relevant worktree.
- Exception: `gt sync` and `gt get` may update local trunk even if it is checked out in another worktree.
- `gt undo` history is per-worktree.
- `gt modify --into <branch>` stops if the target branch is checked out in another worktree.
- Use `gt create --onto <branch>` to create a branch on top of a branch that is checked out elsewhere.
- Confirm both git worktree state and Graphite metadata before syncing, restacking, or undoing.

## Final report format

After completing Graphite work, report in this form:

```text
Stack:
  trunk
  └─ <branch-1>: <purpose>
     └─ <branch-2>: <purpose>

Actions:
- <commands or structural operations performed>

Verification:
- <tests/checks and results>

Remote effects:
- <none, drafts created, PRs updated, or merged>

Remaining risks:
- <conflicts, skipped worktrees, pending review, or none>
```
