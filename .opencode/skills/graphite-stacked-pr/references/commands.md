# Graphite CLI command reference

Verified against `gt --version` 1.8.6 (Graphite CLI). Short aliases are noted but the skill uses canonical command names. Flags shown below are the ones that exist in this CLI version; anything unlisted was not confirmed and should not be assumed.

Use the current command help as the source of truth before relying on an option:

```bash
gt <command> --help
```

## Inspect

| Purpose                        | Command                     | Side effects | Approval | Notes                                                                                   |
| ------------------------------ | --------------------------- | ------------ | -------- | --------------------------------------------------------------------------------------- |
| Show current branch            | `git branch --show-current` | none         | no       | —                                                                                       |
| Show working tree state        | `git status --short`        | none         | no       | —                                                                                       |
| Show all worktrees             | `git worktree list`         | none         | no       | —                                                                                       |
| Show CLI version               | `gt --version`              | none         | no       | —                                                                                       |
| Stack graph (tracked branches) | `gt log short`              | none         | no       | `gt log` shows more info per branch; with multiple worktrees it shows the worktree path |
| Commit ancestry graph          | `gt log long`               | none         | no       | Ignores options; all branches                                                           |
| Branch info                    | `gt info`                   | none         | no       | —                                                                                       |
| Diff vs parent                 | `gt info --diff`            | none         | no       | `--stat` for diffstat, `--patch` for per-commit                                         |
| PR body                        | `gt info --body`            | none         | no       | —                                                                                       |
| Parent of current branch       | `gt parent`                 | none         | no       | —                                                                                       |
| Children of current branch     | `gt children`               | none         | no       | —                                                                                       |
| Read-only submit preview       | `gt submit --dry-run`       | none         | no       | Reports PRs that would be submitted; no push                                            |

## Initialize and track

| Purpose                     | Command               | Side effects                            | Approval              | Notes                                                                                 |
| --------------------------- | --------------------- | --------------------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| Initialize Graphite in repo | `gt init`             | writes Graphite metadata                | yes (confirms trunk)  | Set the trunk explicitly; do not guess                                                |
| Track a branch              | `gt track [branch]`   | local metadata                          | yes if parent unclear | `--parent <branch>` sets the parent; `--force` picks the most recent tracked ancestor |
| Stop tracking a branch      | `gt untrack [branch]` | local metadata; children also untracked | yes                   | —                                                                                     |

## Create and edit

| Purpose                                              | Command                     | Side effects                              | Approval                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | --------------------------- | ----------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage files (git add passthrough)                    | `gt add <paths>`            | index                                     | no                             | Also used to stage resolved conflict files                                                                                                                                                                                                                                                                                                                                                                     |
| Create branch + commit staged changes                | `gt create [name]`          | new branch, commit                        | no (user-requested work)       | `-m <msg>`, `-a` (stage all incl. untracked), `-u` (stage tracked updates), `-p` (hunk pick), `-o/--onto <branch>`, `-i` (insert between current and child). **Call exactly once per branch, after staging, with the name and `-m` together** — `gt create <name>` on an empty worktree creates an empty placeholder branch, and `gt create -m <msg>` without a name auto-generates a `YYYY-MM-DD-<slug>` name |
| Amend current branch (auto-restacks descendants)     | `gt modify`                 | rewrites current commit; restacks upstack | confirm before history rewrite | `-a` stage all, `-u` tracked updates, `-p` hunk pick, `-e` edit message                                                                                                                                                                                                                                                                                                                                        |
| Create a new commit instead of amending              | `gt modify -c`              | new commit; restacks upstack              | confirm                        | —                                                                                                                                                                                                                                                                                                                                                                                                              |
| Modify a downstack branch                            | `gt modify --into <branch>` | rewrites that branch; restacks            | confirm                        | Stops if target is checked out in another worktree                                                                                                                                                                                                                                                                                                                                                             |
| Amend staged hunks into the owning downstack commits | `gt absorb`                 | amends commits; restacks upstack          | yes (prompts)                  | `--dry-run` to preview, `--force` to skip confirmation                                                                                                                                                                                                                                                                                                                                                         |
| Squash all commits on current branch                 | `gt squash`                 | rewrites branch; restacks upstack         | yes                            | —                                                                                                                                                                                                                                                                                                                                                                                                              |

## Navigate

| Purpose                  | Command                | Side effects | Approval | Notes                             |
| ------------------------ | ---------------------- | ------------ | -------- | --------------------------------- |
| Checkout branch          | `gt checkout [branch]` | working tree | no       | Interactive selector if no branch |
| Checkout parent          | `gt down [steps]`      | working tree | no       | —                                 |
| Checkout child           | `gt up [steps]`        | working tree | no       | —                                 |
| Checkout bottom of stack | `gt bottom`            | working tree | no       | —                                 |
| Checkout top of stack    | `gt top`               | working tree | no       | —                                 |
| Show trunk               | `gt trunk`             | none         | no       | —                                 |

## Synchronize and restack

| Purpose                                           | Command           | Side effects                                                | Approval                                          | Notes                                                           |
| ------------------------------------------------- | ----------------- | ----------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| Sync with remote, delete merged branches, restack | `gt sync`         | fetch, rebase, branch cleanup, possibly force-updates trunk | confirm before running (history rewrite + remote) | `--no-restack` to skip restack, `-f/--force`, `-d/--delete-all` |
| Fetch and merge a specific branch/PR from remote  | `gt get [branch]` | rebase/merge                                                | confirm                                           | May update trunk even if checked out in another worktree        |
| Ensure each branch's parent is in history         | `gt restack`      | rebase                                                      | confirm                                           | `--branch <name>`, `--only`, `--downstack`, `--upstack`         |
| Continue halted command after conflict            | `gt continue`     | completes rebase                                            | confirm                                           | `-a` stages all changes before continuing                       |
| Abort halted command                              | `gt abort`        | reverts rebase                                              | confirm                                           | Use when resolution is unclear                                  |

## Submit

| Purpose                           | Command                                                    | Side effects                  | Approval                 | Notes                                                       |
| --------------------------------- | ---------------------------------------------------------- | ----------------------------- | ------------------------ | ----------------------------------------------------------- |
| Submit current branch + downstack | `gt submit --no-edit`                                      | force-push, create/update PRs | yes (remote side effect) | `-s/--stack` to include descendants; `--no-stack` to narrow |
| Submit as drafts                  | `gt submit --draft --no-edit`                              | create draft PRs              | yes                      | Non-interactive mode creates drafts automatically           |
| Publish drafts                    | `gt submit --publish --no-edit`                            | publish PRs                   | yes                      | —                                                           |
| Edit PR metadata                  | `gt submit --edit` / `--edit-title` / `--edit-description` | PR fields                     | yes                      | —                                                           |
| Reviewers                         | `gt submit --reviewers` / `--team-reviewers`               | PR fields                     | yes                      | —                                                           |
| Force re-push unchanged branches  | `gt submit --always`                                       | force-push                    | yes                      | Fixes inconsistent Graphite stack view                      |
| Preview without remote change     | `gt submit --dry-run`                                      | none                          | no                       | —                                                           |

## Merge

| Purpose                                          | Command              | Side effects                                                                 | Approval | Notes                                                                                      |
| ------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| Merge PRs from trunk up to the current branch    | `gt merge`           | merges PRs, may delete branches on remote                                    | yes      | Native Graphite merge; do not use `gh pr merge` or the GitHub Merge button for stacked PRs |
| Report PRs that would be merged, without merging | `gt merge --dry-run` | none                                                                         | no       | Mandatory before any merge                                                                 |
| Merge with confirmation                          | `gt merge --confirm` | merges PRs after prompting; also prompts if local and remote branches differ | yes      | `-c` alias                                                                                 |
| Reconcile after merge (delete merged, restack)   | `gt sync`            | fetch, rebase, branch cleanup, possibly force-updates trunk                  | yes      | Always run after merging; see Synchronize and restack below                                |

Positioning: `gt top` merges the whole stack; checking out the last branch you want merged merges trunk up to and including that branch.

## Restructure

| Purpose                                    | Command      | Side effects                         | Approval | Notes                                                                       |
| ------------------------------------------ | ------------ | ------------------------------------ | -------- | --------------------------------------------------------------------------- |
| Move current branch onto another branch    | `gt move`    | rebase; restacks descendants         | yes      | `--onto <branch>`, `--source <branch>`, `--only` (leave descendants behind) |
| Reorder branches between trunk and current | `gt reorder` | rebase                               | yes      | Opens an editor; `--stack` includes upstack through top                     |
| Split current branch                       | `gt split`   | new branches                         | yes      | `--by-commit`, `--by-hunk`, `--by-file <pathspec>`                          |
| Fold current branch into its parent        | `gt fold`    | removes branch; restacks descendants | yes      | `--keep` keeps the branch name, `--stack` folds whole stack                 |
| Delete current branch, keep working tree   | `gt pop`     | deletes branch                       | yes      | —                                                                           |

## Recovery

| Purpose                                                | Command                                                                            | Side effects          | Approval             | Notes                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------- | -------------------- | ----------------------------------------------------------------- |
| Undo the most recent Graphite mutation                 | `gt undo`                                                                          | rewrites history back | yes                  | Per-worktree history; `--force` skips confirmation                |
| Diagnose inconsistent state                            | `git log --graph --oneline --decorate --all` + `gt log long` + `git worktree list` | none                  | no                   | Collect before mutating                                           |
| Re-align a branch that diverged from Graphite tracking | `gt track <branch> --parent <branch>`                                              | local metadata        | yes (confirm parent) | gt warns when a git command outside gt changed a branch's history |

## Worktree caveats

Verified against CLI 1.8.4+ and the official docs:

- Graphite does not modify branches checked out in another worktree; it exits with an informative error instead of crossing worktrees.
- If a stack spans worktrees, run `gt sync` / `gt restack` / `gt get` from each relevant worktree.
- Exception: `gt sync` and `gt get` may update local trunk even if it is checked out in another worktree.
- `gt undo` history is per-worktree.
- `gt modify --into <branch>` stops if the target branch is checked out in another worktree.
- Use `gt create --onto <branch>` to create a branch on top of a branch checked out elsewhere.
- `gt log` shows the worktree path for branches checked out in other worktrees.
