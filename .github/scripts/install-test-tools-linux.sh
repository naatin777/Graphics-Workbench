#!/usr/bin/env bash
set -euo pipefail

# e2e tools used by conversion tests on Linux.
apt_prefix=()
if command -v sudo >/dev/null 2>&1; then
	apt_prefix=(sudo)
fi

"${apt_prefix[@]}" apt-get update
"${apt_prefix[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y \
	librsvg2-bin \
	xvfb \
	fonts-liberation \
	fonts-dejavu-core
rsvg_convert_path="$(command -v rsvg-convert)"
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

settings_dir="vscode/test/support/vscode-settings"
mkdir -p "$settings_dir"
cat > "$settings_dir/settings.json" <<EOF
{
    "graphics-workbench.execPath.rsvgConvert": "${rsvg_convert_path}",
    "graphics-workbench.execPath.chrome": "${chrome_path}"
}
EOF

# Draw.io CLI is only needed by the packaged Playwright Draw.io -> PDF smoke,
# not by the Extension Host suite (whose Draw.io oracle tests skip without it).
if [ "${INSTALL_DRAWIO:-}" = "1" ]; then
	drawio_version="31.1.5"
	drawio_url="https://github.com/jgraph/drawio-desktop/releases/download/v${drawio_version}/drawio-amd64-${drawio_version}.deb"
	drawio_deb="$(mktemp --suffix=.deb)"
	trap 'rm -f "${drawio_deb}"' EXIT

	curl -L --fail --retry 3 -o "${drawio_deb}" "${drawio_url}"
	"${apt_prefix[@]}" apt-get install -y "${drawio_deb}"

	drawio_path="$(command -v drawio || true)"
	if [ -z "${drawio_path}" ]; then
		for candidate in /opt/drawio/drawio /usr/bin/drawio; do
			if [ -x "${candidate}" ]; then
				drawio_path="${candidate}"
				break
			fi
		done
	fi
	if [ -z "${drawio_path}" ] || [ ! -x "${drawio_path}" ]; then
		echo "Could not find the drawio executable after installing the .deb." >&2
		exit 1
	fi

	node -e "const fs = require('node:fs'); const p = '${settings_dir}/settings.json'; const s = JSON.parse(fs.readFileSync(p, 'utf8')); s['graphics-workbench.execPath.drawio'] = process.argv[1]; fs.writeFileSync(p, JSON.stringify(s, null, 4) + '\n');" "${drawio_path}"

	echo "Draw.io: ${drawio_path}"
	xvfb-run -a "${drawio_path}" --version 2>&1 | head -1 || true
fi

cat "$settings_dir/settings.json"
