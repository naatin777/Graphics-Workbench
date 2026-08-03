# Reproducible Linux visual runner

This image is the reproducible environment for the Linux wide+narrow Playwright visual projects. It pins the Playwright base image and npm version, installs the repository lockfile, and verifies the conversion-tool paths during the image build. The base image is multi-architecture, so the same Dockerfile can run on x86 Linux and ARM Linux.

GitHub Actions does not use this image for the normal PR matrix. The Actions Linux runner executes the canonical pixel comparison natively; macOS and Windows continue to run their packaged conversion smoke tests. The image is for local reproduction and explicit snapshot regeneration, where a stable Linux renderer is useful.

## Prerequisites

The host needs a running Docker Engine and `docker buildx`. The repository does not require Homebrew: Docker Desktop includes Buildx on macOS and Windows, and current Docker Engine packages include it on Linux. Verify the active installation before building:

```text
docker version
docker buildx version
```

If `docker buildx version` is unavailable:

- macOS / Windows: update or reinstall Docker Desktop.
- Debian / Ubuntu: install Docker Engine from Docker's official repository, including the `docker-buildx-plugin` package.
- Other Linux distributions: use the Buildx package supplied by the distribution or Docker's official installation instructions.

The commands below use only the Docker CLI and work from Bash, PowerShell, or Command Prompt when written as single lines. `--platform linux/amd64` and `--platform linux/arm64` select the image architecture independently of the host OS and CPU.

## Build

```text
docker buildx build --platform linux/amd64 --load --tag graphics-workbench-playwright-visual:amd64 --file docker/playwright-visual/Dockerfile .
docker buildx build --platform linux/arm64 --load --tag graphics-workbench-playwright-visual:arm64 --file docker/playwright-visual/Dockerfile .
```

Use the tag matching the platform you built. On an ARM host, the amd64 command uses Docker's emulation support; on an x86 host, the arm64 command requires an ARM emulator.

## Run the visual comparison

```text
docker run --rm --shm-size=2g --env PLAYWRIGHT_VISUAL_SNAPSHOTS=true graphics-workbench-playwright-visual:arm64
```

Replace the tag with `:amd64` when appropriate. The container packages the current source into a VSIX, installs that VSIX into the pinned VS Code Electron test environment, and runs both Linux viewport projects. Pixel comparison is enabled for wide and narrow; the packaged conversion smoke remains wide-only by project configuration.

Keep `--shm-size=2g`; the Electron/PDF.js renderer can exceed Docker's default 64 MiB shared-memory mount.

## Regenerate snapshots without hiding the result

```text
docker create --name graphics-workbench-playwright-visual-update --shm-size=2g --env PLAYWRIGHT_VISUAL_SNAPSHOTS=true --env PLAYWRIGHT_UPDATE_SNAPSHOTS=true graphics-workbench-playwright-visual:arm64
docker start --attach graphics-workbench-playwright-visual-update
node -e "require('node:fs').mkdirSync('test/playwright/electron/__snapshots__',{recursive:true})"
docker cp graphics-workbench-playwright-visual-update:/workspace/test/playwright/electron/__snapshots__/. test/playwright/electron/__snapshots__/
docker rm graphics-workbench-playwright-visual-update
```

Review both the copied `*-vscode-electron-linux.png` (wide) and `*-vscode-electron-narrow-linux.png` (narrow) files, then run the normal Linux PR comparison before committing them. Do not copy macOS or Windows snapshots into the Linux baseline.
