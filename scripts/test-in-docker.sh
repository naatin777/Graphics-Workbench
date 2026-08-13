#!/usr/bin/env bash
set -euo pipefail

# Runs an npm test script inside the local Docker test container.
#
# The container mirrors the GitHub Actions setup: pinned npm, Linux
# node_modules, and the conversion tools (rsvg-convert / drawio /
# Chromium). Source is copied into the image. Nothing from the container is
# bind-mounted into the repository; requested artifacts are copied out after
# the scripts finish.
#
# Internal usage:
#   scripts/test-in-docker.sh <npm-script> [more npm-scripts...]
#
# Public profiles are defined in package.json:
#   npm run check:docker
#   npm run test:docker
#   npm run test:coverage:docker
#   npm run playwright:smoke:docker

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/test-in-docker.sh <npm-script> [more npm-scripts...]" >&2
  exit 2
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runner_temp_directory="$(mktemp -d "${TMPDIR:-/tmp}/graphics-workbench-docker-runner.XXXXXX")"
image_id_file="${runner_temp_directory}/image-id"
container_id=""

cleanup_runner() {
  if [[ -n "${container_id}" ]]; then
    docker rm --force "${container_id}" >/dev/null 2>&1 || true
  fi
  rm -rf -- "${runner_temp_directory}"
}
trap cleanup_runner EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker build --iidfile "${image_id_file}" "${repository_root}"
image_id="$(<"${image_id_file}")"
image_platform="$(docker image inspect "${image_id}" --format '{{.Os}}-{{.Architecture}}')"
if [[ ! "${image_platform}" =~ ^[a-z0-9][a-z0-9_.-]*$ ]]; then
  echo "error: unsupported Docker image platform: ${image_platform}" >&2
  exit 1
fi
vscode_cache_volume="graphics-workbench-vscode-test-cache-${image_platform}"
case "${image_platform}" in
  linux-amd64)
    visual_platform="linux-x64"
    ;;
  linux-arm64)
    visual_platform="linux-arm64"
    ;;
  *)
    echo "error: unsupported visual artifact platform: ${image_platform}" >&2
    exit 1
    ;;
esac

container_id="$(
  docker create \
    --init \
    --mount "type=volume,src=${vscode_cache_volume},dst=/workspace/.vscode-test" \
    -w /workspace \
    -e GRAPHICS_WORKBENCH_VSCODE_TEST_USER_DATA_DIR=/tmp/vscode-test-ci-data \
    "${image_id}" "$@"
)"

set +e
docker start --attach "${container_id}"
test_status=$?
set -e

export_coverage=0
export_playwright=0
export_visual_review=0
for script in "$@"; do
  case "${script}" in
    test:coverage | test:coverage:run)
      export_coverage=1
      ;;
    test:playwright:smoke | test:playwright:vsix | test:e2e)
      export_playwright=1
      ;;
    visual:capture)
      export_playwright=1
      export_visual_review=1
      ;;
  esac
done

export_failed=0

copy_directory_from_container() {
  local container_path="$1"
  local host_path="$2"
  local staging_path

  if ! staging_path="$(mktemp -d "${runner_temp_directory}/export.XXXXXX")"; then
    echo "error: could not create a temporary Docker artifact directory" >&2
    return 1
  fi
  if ! docker cp "${container_id}:${container_path}/." "${staging_path}" 2>/dev/null; then
    rm -rf -- "${staging_path}"
    echo "warning: Docker artifact directory was not produced: ${container_path}" >&2
    return 1
  fi
  if ! rm -rf -- "${host_path}" || ! mkdir -p "${host_path}" || ! cp -R "${staging_path}/." "${host_path}"; then
    rm -rf -- "${staging_path}"
    echo "error: could not replace Docker artifact directory: ${host_path}" >&2
    return 1
  fi
  rm -rf -- "${staging_path}"
}

if [[ "${export_coverage}" -eq 1 ]]; then
  copy_directory_from_container /workspace/coverage "${repository_root}/coverage" || export_failed=1
fi
if [[ "${export_playwright}" -eq 1 ]]; then
  copy_directory_from_container /workspace/test-results "${repository_root}/test-results" || true
  copy_directory_from_container /workspace/playwright-report "${repository_root}/playwright-report" || export_failed=1
fi
if [[ "${export_visual_review}" -eq 1 ]]; then
  copy_directory_from_container \
    "/workspace/artifacts/visual-review/${visual_platform}" \
    "${repository_root}/artifacts/visual-review/${visual_platform}" || export_failed=1
fi

if [[ "${test_status}" -ne 0 ]]; then
  exit "${test_status}"
fi
if [[ "${export_failed}" -ne 0 ]]; then
  exit 1
fi
