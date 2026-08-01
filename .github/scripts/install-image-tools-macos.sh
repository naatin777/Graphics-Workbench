#!/usr/bin/env bash
set -euo pipefail

# e2e tools used by conversion tests on macOS.
brew install poppler librsvg ghostscript qpdf

gs_path="$(command -v gs)"
pdftocairo_path="$(command -v pdftocairo)"
rsvg_convert_path="$(command -v rsvg-convert)"
qpdf_path="$(command -v qpdf)"
chrome_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [[ ! -x "${chrome_path}" ]]; then
	echo "Google Chrome executable was not found: ${chrome_path}" >&2
	exit 1
fi

settings_dir="test/vscode-settings"
mkdir -p "$settings_dir"
cat > "$settings_dir/settings.json" <<EOF
{
    "graphics-workbench.execPath.ghostscript": "${gs_path}",
    "graphics-workbench.execPath.pdftocairo": "${pdftocairo_path}",
    "graphics-workbench.execPath.rsvgConvert": "${rsvg_convert_path}",
    "graphics-workbench.execPath.qpdf": "${qpdf_path}",
    "graphics-workbench.puppeteer.executablePath": "${chrome_path}"
}
EOF

cat "$settings_dir/settings.json"
