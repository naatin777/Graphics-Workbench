# Reproducible Linux visual runner

This image is the reproducible environment for the Linux wide+narrow Playwright visual projects. It pins the Playwright base image and npm version, installs the repository lockfile, and verifies the conversion-tool paths during the image build. The base image is multi-architecture, so the same Dockerfile can run on x86 Linux and ARM Linux.

GitHub Actions does not use this image for the normal PR matrix. The Actions Linux runner executes the canonical pixel comparison natively; macOS and Windows continue to run their packaged conversion smoke tests. The image is for local reproduction and explicit snapshot regeneration, where a stable Linux renderer is useful.

## Build

```sh
docker buildx build --platform linux/amd64 --load \
  --tag graphics-workbench-playwright-visual:amd64 \
  --file docker/playwright-visual/Dockerfile .

docker buildx build --platform linux/arm64 --load \
  --tag graphics-workbench-playwright-visual:arm64 \
  --file docker/playwright-visual/Dockerfile .
```

Use the tag matching the platform you built. On an ARM host, the amd64 command uses Docker's emulation support; on an x86 host, the arm64 command requires an ARM emulator.

## Run the visual comparison

```sh
docker run --rm \
  --shm-size=2g \
  --env PLAYWRIGHT_VISUAL_SNAPSHOTS=true \
  graphics-workbench-playwright-visual:arm64
```

Replace the tag with `:amd64` when appropriate. The container packages the current source into a VSIX, installs that VSIX into the pinned VS Code Electron test environment, and runs both Linux viewport projects. Pixel comparison is enabled for wide and narrow; the packaged conversion smoke remains wide-only by project configuration.

Keep `--shm-size=2g`; the Electron/PDF.js renderer can exceed Docker's default 64 MiB shared-memory mount.

## Regenerate snapshots without hiding the result

```sh
container_name=graphics-workbench-playwright-visual-update
docker create --name "$container_name" \
  --shm-size=2g \
  --env PLAYWRIGHT_VISUAL_SNAPSHOTS=true \
  --env PLAYWRIGHT_UPDATE_SNAPSHOTS=true \
  graphics-workbench-playwright-visual:arm64
docker start --attach "$container_name"
mkdir -p test/playwright/electron/__snapshots__
docker cp "$container_name:/workspace/test/playwright/electron/__snapshots__/./" \
  test/playwright/electron/__snapshots__/
docker rm "$container_name"
```

Review both the copied `*-vscode-electron-linux.png` (wide) and `*-vscode-electron-narrow-linux.png` (narrow) files, then run the normal Linux PR comparison before committing them. Do not copy macOS or Windows snapshots into the Linux baseline.
