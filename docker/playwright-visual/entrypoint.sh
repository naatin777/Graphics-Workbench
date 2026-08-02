#!/usr/bin/env bash
set -euo pipefail

: "${PLAYWRIGHT_VISUAL_SNAPSHOTS:=true}"
: "${PLAYWRIGHT_UPDATE_SNAPSHOTS:=false}"
export PLAYWRIGHT_VISUAL_SNAPSHOTS PLAYWRIGHT_UPDATE_SNAPSHOTS

npm run package:vsix -- --out graphics-workbench-linux.vsix
cp graphics-workbench-linux.vsix graphics-workbench.vsix

playwright_args=()
if [[ "${PLAYWRIGHT_UPDATE_SNAPSHOTS}" == 'true' ]]; then
  playwright_args+=(--update-snapshots)
fi

# Running xvfb-run as PID 1 can miss Xvfb's SIGUSR1 readiness notification on
# some ARM Docker hosts. Start the display explicitly and wait for its socket.
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
npm run test:playwright:vsix -- "${playwright_args[@]}"
