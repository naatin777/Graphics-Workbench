#!/usr/bin/env bash
set -euo pipefail

# Runs npm test scripts inside the container. Xvfb is only started when at least
# one of the requested scripts needs an X display (Extension Host / Electron
# Playwright); lightweight scripts (check / webview / scripts / package) run
# without a display server and skip the Xvfb startup / polling entirely.

if [ "$#" -eq 0 ]; then
  echo "usage: graphics-workbench-test <npm-script> [more npm-scripts...]" >&2
  exit 2
fi

# Returns 0 when the npm script launches VS Code Electron / Playwright Electron.
requires_display() {
  case "$1" in
    test | test:coverage | test:coverage:run | test:playwright:vsix | test:playwright:smoke | visual:capture)
      return 0
      ;;
  esac
  return 1
}

need_display=0
for script in "$@"; do
  if requires_display "${script}"; then
    need_display=1
    break
  fi
done

if [[ "${need_display}" -eq 1 ]]; then
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
fi

for script in "$@"; do
  npm run "${script}"
done
