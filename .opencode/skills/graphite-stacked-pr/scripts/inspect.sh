#!/usr/bin/env bash
set -euo pipefail

# Read-only Graphite stack inspector.
# Shows git + Graphite state before stack operations. Never mutates anything.

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "error: not inside a git worktree (git rev-parse failed)" >&2
  exit 1
fi

if ! command -v gt >/dev/null 2>&1; then
  echo "error: 'gt' (Graphite CLI) not found on PATH" >&2
  exit 1
fi

TOPLEVEL="$(git rev-parse --show-toplevel)"
echo "== git top-level =="
echo "${TOPLEVEL}"
echo

echo "== git branch =="
echo "$(git branch --show-current)"
echo

echo "== git status =="
git status --short
echo

echo "== git worktrees =="
git worktree list
echo

echo "== gt version =="
gt --version
echo

echo "== gt log short =="
gt log short || echo "(gt log short failed; is Graphite initialized?)"
echo

echo "== gt info =="
gt info || echo "(gt info failed; current branch state may not be trackable)"
