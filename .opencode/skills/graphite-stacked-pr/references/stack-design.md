# Designing a Graphite stack

How to split a non-trivial change into reviewable, safely mergeable stacked PRs. Read this before proposing a stack; the goal is reviewability and safety, not "making a stack".

## What makes a good branch

A good branch in a stack:

- Has one primary purpose.
- Has a clear, stated reason to depend on its parent.
- Can be explained without its upstack (no hidden prerequisite in a later PR).
- Has its own tests where feasible.
- Is in a coherent state relative to its parent (builds and tests pass as far as practical).
- Can be reviewed by diffing only its parent → itself.

## Bottom-to-top ordering

Put prerequisites downstack and consumers upstack.

```text
main
└─ extract-existing-abstraction
   └─ implement-new-behavior
      └─ migrate-callers
```

Schema migration example:

```text
main
└─ add-backward-compatible-schema
   └─ write-new-format
      └─ migrate-readers
         └─ remove-old-format
```

While old readers/writers still exist, do not move compatibility-code removal into the same merge phase as the migration that still depends on it.

## Large migrations

Do not put an entire large migration into one deep stack. Prefer phases that each reach trunk before the next starts:

1. Add the compatibility boundary.
2. Migrate one vertical user flow end-to-end.
3. Migrate additional flows in separate short stacks.
4. Switch the default implementation.
5. Remove the legacy implementation only after evidence it is unused.

Each phase should land on trunk before starting the next long phase whenever possible.

## Test placement

Put tests on the lowest branch where they are meaningful:

- Refactor branch: evidence that existing behavior is preserved.
- New-behavior branch: unit/integration tests for the new behavior.
- Migration branch: evidence that callers use the new path.
- Cleanup branch: evidence that there are no references to the old path.

Do not defer all tests to the top of the stack.

## Typical failure modes

### File-based mechanical splitting

Bad: split by file count so each PR looks "even", ignoring dependencies.
Better: split by logical change with real dependency order.

### Mixing unrelated cleanup into a prerequisite PR

Bad: reformatting or renaming files inside the bottom refactor PR.
Better: keep rename/format/behavior changes in separate PRs.

### Fixing a downstack bug at the top of the stack

Bad: a bug introduced in `A` is patched in `C` just to avoid restacking `A` and `B`.
Better: fix it in `A` (with `gt modify --into A` or by checking out `A`), then restack.

### Maintaining 10+ branch stacks for a long time

Bad: a deep stack that lives for weeks; restack and CI cost grows and review context is lost.
Better: land slices to trunk incrementally and keep stacks short (2–5 branches as a guideline).

### A lower PR alone does not build or test

Bad: the bottom branch references types/functions that only exist upstack.
Better: each branch is coherent against its parent; add the abstraction in the branch that introduces it.

### A PR has no meaning without its successors

Bad: a branch whose purpose is only explained by a later branch.
Better: each branch is independently explainable.

### Rename, format, and behavior change in the same PR

Bad: a PR that renames a function, reformats a file, and changes its behavior — impossible to review.
Better: one PR for the rename, one for format (or none), one for behavior.

## Judging single PR vs. stack

Use a stack only when there is real dependency order, review benefit, or rollout/rollback safety. Splitting purely to equalize file counts is not a reason. A single atomic PR that reviews cleanly is fine.
