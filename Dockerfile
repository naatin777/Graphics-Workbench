# syntax=docker/dockerfile:1

# Local test container mirroring the GitHub Actions setup:
#   - mcr.microsoft.com/playwright base (Chromium, xvfb, fonts-liberation)
#   - pinned Node.js/npm to satisfy devEngines (Node.js 24.15.0 / npm 12.0.1)
#   - librsvg2-bin / fonts-noto-cjk / drawio for conversion tests
#
# Used by scripts/test-in-docker.sh. Run tests with:
#   npm run check:docker
#   npm run test:docker
#   npm run playwright:smoke:docker
#
# The repository is copied into the image after tools and dependencies. Source
# changes only invalidate the final layer; the container never writes through a
# bind mount into the host repository.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

ARG DRAWIO_VERSION=31.1.5

WORKDIR /workspace

# Pin Node.js/npm to satisfy devEngines (Node.js 24.15.0 / npm 12.0.1).
RUN node --version | grep -Eq '^v24\\.'
RUN --mount=type=cache,target=/root/.npm \
  npm install --global npm@12.0.1

# System tools + fonts. xvfb / fonts-liberation already ship in the base image;
# librsvg2-bin (rsvg-convert) and fonts-dejavu-core / fonts-noto-cjk (Japanese
# PDF rendering) do not.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    librsvg2-bin \
    fonts-dejavu-core \
    fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

# execPath.chrome falls back to `google-chrome` on Linux when the setting is
# empty. Expose the base image's Chromium under that name. The wrapper adds
# --no-sandbox because the container runs as root (puppeteer/Chromium refuse to
# run as root without it). The test harness resolves `google-chrome` via `which`
# to an absolute path.
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

# Linux node_modules (sharp / mupdf native builds). npm configuration belongs to
# the dependency layer so a policy change invalidates npm ci as expected.
COPY package.json package-lock.json .npmrc ./
COPY core/package.json ./core/package.json
COPY vscode/extension/package.json ./vscode/extension/package.json
COPY vscode/webview/package.json ./vscode/webview/package.json
RUN --mount=type=cache,target=/root/.npm \
  npm ci

COPY docker/test/entrypoint.sh /usr/local/bin/graphics-workbench-test
RUN chmod +x /usr/local/bin/graphics-workbench-test

# Keep this last. Source changes must not invalidate tool installation or npm
# ci, and host-generated artifacts are excluded by .dockerignore.
COPY . .

ENTRYPOINT ["/usr/local/bin/graphics-workbench-test"]
