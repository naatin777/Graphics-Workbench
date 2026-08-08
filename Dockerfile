# syntax=docker/dockerfile:1

# Local test container mirroring the GitHub Actions setup:
#   - mcr.microsoft.com/playwright base (Chromium, xvfb, fonts)
#   - pinned npm to satisfy devEngines (npm 12.0.1)
#   - .github/scripts/install-test-tools-linux.sh for rsvg / mermaid / chrome
#   - drawio installed per-architecture
#
# Used by scripts/test-in-docker.sh. Run tests with:
#   npm run test:docker -- <npm-script>
FROM mcr.microsoft.com/playwright:v1.62.1-noble

ARG DRAWIO_VERSION=31.1.5

WORKDIR /workspace

RUN npm install --global npm@12.0.1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# System tools + mermaid-cli + chrome detection (writes test/vscode-settings/settings.json).
RUN bash .github/scripts/install-test-tools-linux.sh \
  && apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

# execPath.chrome falls back to `google-chrome` on Linux when the setting is
# empty. The bind-mounted workspace keeps the tracked {} settings, so expose the
# base image's Chromium under that name. The wrapper adds --no-sandbox because
# the container runs as root (puppeteer/Chromium refuse to run as root without
# it). The test harness resolves `google-chrome` via `which` to an absolute path.
RUN chrome_path="$(find /ms-playwright -path '*/chrome-linux*/chrome' -type f | head -n 1)" \
  && printf '#!/usr/bin/env bash\nexec "%s" --no-sandbox --disable-dev-shm-usage "$@"\n' "${chrome_path}" > /usr/local/bin/google-chrome \
  && chmod +x /usr/local/bin/google-chrome

# Draw.io CLI for the packaged Draw.io -> PDF smoke. The .deb is architecture
# specific (amd64/arm64), unlike the amd64-only URL in install-test-tools-linux.sh.
RUN arch="$(dpkg --print-architecture)" \
  && case "${arch}" in \
       arm64) deb="drawio-arm64-${DRAWIO_VERSION}.deb" ;; \
       amd64) deb="drawio-amd64-${DRAWIO_VERSION}.deb" ;; \
       *) echo "unsupported architecture: ${arch}" >&2; exit 1 ;; \
     esac \
  && curl -L --fail --retry 3 -o /tmp/drawio.deb \
     "https://github.com/jgraph/drawio-desktop/releases/download/v${DRAWIO_VERSION}/${deb}" \
  && apt-get update \
  && apt-get install -y /tmp/drawio.deb \
  && rm /tmp/drawio.deb \
  && rm -rf /var/lib/apt/lists/* \
  && drawio_path="$(command -v drawio || echo /opt/drawio/drawio)" \
  && printf '#!/usr/bin/env bash\nexec "%s" --no-sandbox --disable-gpu --disable-dev-shm-usage "$@"\n' "${drawio_path}" > /usr/local/bin/drawio \
  && chmod +x /usr/local/bin/drawio

COPY docker/test/entrypoint.sh /usr/local/bin/graphics-workbench-test
RUN chmod +x /usr/local/bin/graphics-workbench-test

ENTRYPOINT ["/usr/local/bin/graphics-workbench-test"]
