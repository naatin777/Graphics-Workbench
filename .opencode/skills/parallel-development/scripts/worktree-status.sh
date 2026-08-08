#!/usr/bin/env bash
# Read-only status for the parallel-development workflow.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

echo "=== worktrees ==="
git worktree list

echo "=== current branch ==="
git branch --show-current

echo "=== working tree status ==="
git status --short

echo "=== Graphite log ==="
if command -v gt >/dev/null 2>&1; then
  gt log short
else
  echo "gt CLI not found"
fi
