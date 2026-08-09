#!/usr/bin/env bash
set -euo pipefail

# Runs the requested npm scripts in one Xvfb session. Headless and windowed
# scripts share the same canonical Linux environment and execute in order.

if [ "$#" -eq 0 ]; then
  echo "usage: graphics-workbench-test <npm-script> [more npm-scripts...]" >&2
  exit 2
fi

display_number=99
xvfb_log="${TMPDIR:-/tmp}/graphics-workbench-xvfb.log"
Xvfb ":${display_number}" -screen 0 1280x1024x24 -nolisten tcp -ac >"${xvfb_log}" 2>&1 &
xvfb_pid=$!

cleanup_xvfb() {
  kill "${xvfb_pid}" 2>/dev/null || true
  wait "${xvfb_pid}" 2>/dev/null || true
}
trap cleanup_xvfb EXIT INT TERM

for ((attempt = 0; attempt < 100; attempt += 1)); do
  if [[ -S "/tmp/.X11-unix/X${display_number}" ]]; then
    break
  fi
  if ! kill -0 "${xvfb_pid}" 2>/dev/null; then
    cat "${xvfb_log}" >&2
    exit 1
  fi
  sleep 0.1
done

if [[ ! -S "/tmp/.X11-unix/X${display_number}" ]]; then
  cat "${xvfb_log}" >&2
  exit 1
fi

export DISPLAY=":${display_number}"

for script in "$@"; do
  npm run "${script}"
done
