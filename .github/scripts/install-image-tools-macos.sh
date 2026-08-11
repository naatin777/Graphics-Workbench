#!/usr/bin/env bash
set -euo pipefail

# e2e tools used by conversion tests on macOS.
brew install librsvg
npm install -g @mermaid-js/mermaid-cli

rsvg_convert_path="$(command -v rsvg-convert)"
mermaid_path="$(command -v mmdc || true)"
if [ -z "${mermaid_path}" ]; then
	echo "Could not find the mmdc executable. Install it with: npm install -g @mermaid-js/mermaid-cli" >&2
	exit 1
fi
chrome_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [[ ! -x "${chrome_path}" ]]; then
	echo "Google Chrome executable was not found: ${chrome_path}" >&2
	exit 1
fi

settings_dir="vscode/test/support/vscode-settings"
mkdir -p "$settings_dir"
cat > "$settings_dir/settings.json" <<EOF
{
    "graphics-workbench.execPath.rsvgConvert": "${rsvg_convert_path}",
    "graphics-workbench.execPath.mermaid": "${mermaid_path}",
    "graphics-workbench.execPath.chrome": "${chrome_path}"
}
EOF

# Draw.io CLI is only needed by the packaged Playwright Draw.io -> PDF smoke,
# not by the Extension Host suite (whose Draw.io oracle tests skip without it).
if [ "${INSTALL_DRAWIO:-}" = "1" ]; then
	drawio_version="31.1.5"
	drawio_url="https://github.com/jgraph/drawio-desktop/releases/download/v${drawio_version}/draw.io-universal-${drawio_version}.dmg"
	drawio_dmg="$(mktemp -t drawio-dmg)"
	mount_dir="$(mktemp -d -t drawio-mount)"
	trap 'rm -f "${drawio_dmg}"; hdiutil detach "${mount_dir}" >/dev/null 2>&1 || true; rm -rf "${mount_dir}"' EXIT

	curl -L --fail --retry 3 -o "${drawio_dmg}" "${drawio_url}"
	hdiutil attach "${drawio_dmg}" -nobrowse -mountpoint "${mount_dir}"

	drawio_app="/Applications/draw.io.app"
	rm -rf "${drawio_app}"
	cp -R "${mount_dir}/draw.io.app" "/Applications/"
	xattr -dr com.apple.quarantine "${drawio_app}/Contents/MacOS/draw.io" >/dev/null 2>&1 || true

	drawio_path="${drawio_app}/Contents/MacOS/draw.io"
	if [ ! -x "${drawio_path}" ]; then
		echo "Could not find the drawio executable inside the mounted app." >&2
		exit 1
	fi

	node -e "const fs = require('node:fs'); const p = '${settings_dir}/settings.json'; const s = JSON.parse(fs.readFileSync(p, 'utf8')); s['graphics-workbench.execPath.drawio'] = process.argv[1]; fs.writeFileSync(p, JSON.stringify(s, null, 4) + '\n');" "${drawio_path}"

	echo "Draw.io: ${drawio_path}"
fi

cat "$settings_dir/settings.json"
