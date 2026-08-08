#!/usr/bin/env bash
set -euo pipefail

# Runs an npm test script inside the local Docker test container.
#
# The container mirrors the GitHub Actions setup: pinned npm, npm ci (Linux
# dependencies), and the conversion tools (rsvg-convert / mermaid-cli / drawio /
# Chromium). The repository is bind-mounted read-write, so host-built out/ and
# media/ assets are used as-is; node_modules stays in a named volume keyed by the
# package-lock.json hash, so an unchanged lockfile reuses the same Linux install
# and the host's macOS node_modules never leaks in.
#
# Usage:
#   npm run test:docker -- <npm-script> [more npm-scripts...]
#
# Examples:
#   npm run test:docker -- check
#   npm run test:docker -- test:coverage:run
#   npm run test:docker -- test:webview:coverage
#   npm run test:docker -- package:vsix test:playwright:smoke
#
# Note: run `npm run build` on the host first so out/ and media/ (including the
# Excalidraw bundle) exist before Extension Host / Playwright runs. The
# container reads the host-built out/ and media/ via the bind mount; it does not
# build inside (vite asset copies fail across the macOS bind mount).
#
# Playwright: only the packaged conversion smoke runs in the container. The full
# Electron Playwright suite (configure specs with PDF preview rendering) is
# verified locally on the host and before release, where the rendering
# environment matches the target OS.

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/test-in-docker.sh <npm-script> [more npm-scripts...]" >&2
  exit 2
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_name="graphics-workbench-test"

docker build -t "${image_name}" "${repository_root}"

# In a git worktree, .git is a file pointing at the real gitdir (and its common
# dir) outside the bind-mounted tree. Mount them so `git rev-parse --git-path
# hooks` resolves inside the container; otherwise knip's lefthook detection
# fails and check:all exits 1.
extra_mounts=()
if [[ -f "${repository_root}/.git" ]]; then
  worktree_gitdir="$(sed -n 's/^gitdir: //p' "${repository_root}/.git")"
  common_dir="$(cd "$(dirname "${worktree_gitdir}")/$(cat "${worktree_gitdir}/commondir")" && pwd)"
  extra_mounts+=(-v "${worktree_gitdir}:${worktree_gitdir}" -v "${common_dir}:${common_dir}")
fi

# node_modules volume keyed by the lockfile so a changed package-lock.json gets
# a fresh Linux install while unchanged lockfiles reuse the same volume.
node_modules_volume="$(
  bash "${repository_root}/scripts/docker-node-modules-volume-name.sh" "${repository_root}/package-lock.json"
)"

docker run --rm \
  -v "${repository_root}":/workspace \
  -v "${node_modules_volume}":/workspace/node_modules \
  "${extra_mounts[@]}" \
  -w /workspace \
  -e GRAPHICS_WORKBENCH_VSCODE_TEST_USER_DATA_DIR=/tmp/vscode-test-ci-data \
  "${image_name}" "$@"
