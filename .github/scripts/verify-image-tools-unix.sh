#!/usr/bin/env bash
set -euo pipefail

# Verifies the tools injected as GRAPHICS_WORKBENCH_TEST_* by the workflow.
# The environment variables are the single source of tool paths; this script
# never probes PATH or reads settings files.

echo "Verifying image conversion tools..."

: "${GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH:?GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH is required}"
: "${GRAPHICS_WORKBENCH_TEST_CHROME_PATH:?GRAPHICS_WORKBENCH_TEST_CHROME_PATH is required}"

rsvg_convert_path="${GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH}"
chrome_path="${GRAPHICS_WORKBENCH_TEST_CHROME_PATH}"
test -x "${rsvg_convert_path}"
test -x "${chrome_path}"

if [ "${INSTALL_DRAWIO:-}" = "1" ]; then
	: "${GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH:?GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH is required}"
	drawio_path="${GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH}"
	test -x "${drawio_path}"
	echo "Draw.io: ${drawio_path}"
	xvfb-run -a "${drawio_path}" --version 2>&1 | head -1 || true
fi

echo "rsvg-convert: ${rsvg_convert_path}"
"${rsvg_convert_path}" --version

echo "Chrome: ${chrome_path}"
"${chrome_path}" --version

work_dir="$(mktemp -d)"
trap 'rm -rf "${work_dir}"' EXIT

svg_path="${work_dir}/sample.svg"
pdf_path="${work_dir}/sample.pdf"

cat >"${svg_path}" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24" viewBox="0 0 32 24">
  <rect width="32" height="24" fill="#285078"/>
  <circle cx="16" cy="12" r="6" fill="#ffffff"/>
</svg>
SVG

"${rsvg_convert_path}" --format=pdf --output "${pdf_path}" "${svg_path}"
test -s "${pdf_path}"

echo "Image conversion tool smoke test passed."
