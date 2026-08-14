#!/usr/bin/env bash
set -euo pipefail

# Installs the image conversion tools and prints GRAPHICS_WORKBENCH_TEST_*
# lines to stdout for the workflow to inject via $GITHUB_ENV. Human-readable
# progress goes to stderr so stdout stays machine-parseable.

echo "Installing librsvg via Homebrew..." >&2
brew install librsvg

rsvg_convert_path="$(command -v rsvg-convert)"
chrome_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [[ ! -x "${chrome_path}" ]]; then
	echo "Google Chrome executable was not found: ${chrome_path}" >&2
	exit 1
fi

printf 'GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH=%s\n' "${rsvg_convert_path}"
printf 'GRAPHICS_WORKBENCH_TEST_CHROME_PATH=%s\n' "${chrome_path}"

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

	printf 'GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH=%s\n' "${drawio_path}"
fi
