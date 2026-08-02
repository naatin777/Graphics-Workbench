#!/usr/bin/env bash
set -euo pipefail

# e2e tools used by conversion tests on Linux.
apt_prefix=()
if command -v sudo >/dev/null 2>&1; then
	apt_prefix=(sudo)
fi

"${apt_prefix[@]}" apt-get update
"${apt_prefix[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y \
	ghostscript \
	poppler-utils \
	librsvg2-bin \
	qpdf \
	xvfb \
	fonts-liberation \
	fonts-dejavu-core

gs_path="$(command -v gs)"
pdftocairo_path="$(command -v pdftocairo)"
rsvg_convert_path="$(command -v rsvg-convert)"
qpdf_path="$(command -v qpdf)"
chrome_path="$(command -v google-chrome || true)"
if [ -z "${chrome_path}" ]; then
	for candidate in /ms-playwright/chromium-*/chrome-linux*/chrome; do
		if [ -x "${candidate}" ]; then
			chrome_path="${candidate}"
			break
		fi
	done
fi
if [ -z "${chrome_path}" ]; then
	echo "Could not find a Chrome executable for packaged Playwright tests." >&2
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
