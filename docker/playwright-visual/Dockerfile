# syntax=docker/dockerfile:1

ARG PLAYWRIGHT_VERSION=1.61.1
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG PLAYWRIGHT_VERSION
ENV CI=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /workspace

# Keep the package manager, browser, native conversion tools, and fonts inside
# the image. The Playwright base image is published for both amd64 and arm64.
RUN npm install --global npm@12.0.1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && bash .github/scripts/install-test-tools-linux.sh \
  && bash .github/scripts/verify-image-tools-unix.sh

COPY docker/playwright-visual/entrypoint.sh /usr/local/bin/graphics-workbench-playwright-visual
RUN chmod +x /usr/local/bin/graphics-workbench-playwright-visual

ENTRYPOINT ["/usr/local/bin/graphics-workbench-playwright-visual"]
