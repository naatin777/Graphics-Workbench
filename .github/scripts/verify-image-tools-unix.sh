#!/usr/bin/env bash
set -euo pipefail

echo "Verifying image conversion tools..."

settings_path="vscode/test/support/vscode-settings/settings.json"

read_setting() {
	local key="$1"
	node -e "const fs = require('node:fs'); const settings = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const value = settings[process.argv[2]]; if (!value) process.exit(1); process.stdout.write(value);" "${settings_path}" "${key}"
}

rsvg_convert_path="$(read_setting "graphics-workbench.execPath.rsvgConvert")"
chrome_path="$(read_setting "graphics-workbench.execPath.chrome")"
test -x "${rsvg_convert_path}"
test -x "${chrome_path}"

if [ "${INSTALL_DRAWIO:-}" = "1" ]; then
	drawio_path="$(read_setting "graphics-workbench.execPath.drawio")"
	test -x "${drawio_path}"
	echo "Draw.io from settings.json: ${drawio_path}"
	"${drawio_path}" --version 2>&1 | head -1 || true
fi

echo "rsvg-convert: ${rsvg_convert_path}"
"${rsvg_convert_path}" --version

echo "Chrome from settings.json: ${chrome_path}"
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
