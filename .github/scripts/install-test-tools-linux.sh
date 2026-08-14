#!/usr/bin/env bash
set -euo pipefail

# Installs the conversion tools and prints GRAPHICS_WORKBENCH_TEST_* lines to
# stdout for the workflow to inject via $GITHUB_ENV. Human-readable progress
# goes to stderr so stdout stays machine-parseable.

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

printf 'GRAPHICS_WORKBENCH_TEST_RSVG_CONVERT_PATH=%s\n' "${rsvg_convert_path}"
printf 'GRAPHICS_WORKBENCH_TEST_CHROME_PATH=%s\n' "${chrome_path}"

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

	printf 'GRAPHICS_WORKBENCH_TEST_DRAWIO_PATH=%s\n' "${drawio_path}"
fi
