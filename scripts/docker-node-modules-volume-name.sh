#!/usr/bin/env bash
set -euo pipefail

# Prints the Docker named volume used for the Linux node_modules install, keyed
# by a short hash of the given package-lock.json so an unchanged lockfile reuses
# the same volume while a changed lockfile gets a fresh one.
#
# Usage:
#   scripts/docker-node-modules-volume-name.sh <package-lock.json path>

lock_file="${1:?usage: docker-node-modules-volume-name.sh <package-lock.json path>}"
lock_hash="$(shasum -a 256 "${lock_file}" | awk '{print $1}' | cut -c1-16)"
printf 'graphics-workbench-node-modules-%s\n' "${lock_hash}"
