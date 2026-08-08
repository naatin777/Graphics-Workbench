# syntax=docker/dockerfile:1

# Local test container mirroring the GitHub Actions setup:
#   - mcr.microsoft.com/playwright base (Chromium, xvfb, fonts-liberation)
#   - pinned npm to satisfy devEngines (npm 12.0.1)
#   - librsvg2-bin / mermaid-cli / fonts-noto-cjk / drawio for conversion tests
#
# Used by scripts/test-in-docker.sh. Run tests with:
#   npm run test:docker -- <npm-script>
#
# The repository is bind-mounted at runtime, so no source code is COPY'd into
# the image. Layers are ordered stable-first: package.json / package-lock.json
# change far less often than src, so the expensive tool installs sit before the
# npm ci layer and only re-run when package files actually change.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

ARG DRAWIO_VERSION=31.1.5

WORKDIR /workspace

# Pin npm to satisfy devEngines.packageManager (npm 12.0.1).
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

# Mermaid CLI. Puppeteer must not download its own Chrome: the container runs
# the base image's Chromium through the google-chrome wrapper below.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN --mount=type=cache,target=/root/.npm \
  npm install --global @mermaid-js/mermaid-cli

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

# Linux node_modules (sharp / mupdf native builds). Only package files are
# COPY'd, so src / test changes never re-run npm ci. The resulting node_modules
# seeds the named volume used by scripts/test-in-docker.sh.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  npm ci

COPY docker/test/entrypoint.sh /usr/local/bin/graphics-workbench-test
RUN chmod +x /usr/local/bin/graphics-workbench-test

ENTRYPOINT ["/usr/local/bin/graphics-workbench-test"]
