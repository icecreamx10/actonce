#!/usr/bin/env bash

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CACHE="${ROOT}/.cache/android-world"
SOURCE="${CACHE}/source"
VENV="${CACHE}/venv"
ANDROID_WORLD_COMMIT="3e50888527ef9f29b9157ecd537e408008bb1c85"
AVD_ROOT="${ANDROID_AVD_HOME:-${HOME}/.android/avd}"
PATCH_DIR="${ROOT}/benchmark/android/android-world/patches"

python_is_supported() {
  [[ -x "$1" ]] && "$1" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' >/dev/null 2>&1
}

resolve_python() {
  local candidate
  if [[ -n "${ACTONCE_ANDROID_WORLD_PYTHON:-}" ]]; then
    if python_is_supported "${ACTONCE_ANDROID_WORLD_PYTHON}"; then
      printf '%s\n' "${ACTONCE_ANDROID_WORLD_PYTHON}"
      return
    fi
    echo "ACTONCE_ANDROID_WORLD_PYTHON must point to Python 3.10 or newer" >&2
    return 1
  fi

  for candidate in python3.12 python3.11 python3; do
    candidate="$(command -v "${candidate}" 2>/dev/null || true)"
    if [[ -n "${candidate}" ]] && python_is_supported "${candidate}"; then
      printf '%s\n' "${candidate}"
      return
    fi
  done

  for candidate in \
    "${PYENV_ROOT:-${HOME}/.pyenv}"/versions/*/bin/python3 \
    "${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"; do
    if python_is_supported "${candidate}"; then
      printf '%s\n' "${candidate}"
      return
    fi
  done

  echo "AndroidWorld requires Python 3.10 or newer; set ACTONCE_ANDROID_WORLD_PYTHON" >&2
  return 1
}

apply_patches() {
  local patch_path
  for patch_path in "${PATCH_DIR}"/*.patch; do
    [[ -e "${patch_path}" ]] || continue
    if git -C "${SOURCE}" apply --reverse --check "${patch_path}" >/dev/null 2>&1; then
      continue
    fi
    git -C "${SOURCE}" apply --check "${patch_path}"
    git -C "${SOURCE}" apply "${patch_path}"
  done
}

if [[ -d "${SOURCE}/.git" ]] \
  && [[ "$(git -C "${SOURCE}" rev-parse HEAD 2>/dev/null || true)" == "${ANDROID_WORLD_COMMIT}" ]]; then
  apply_patches
fi

environment_ready() {
  [[ -d "${SOURCE}/.git" ]] \
  && [[ "$(git -C "${SOURCE}" rev-parse HEAD 2>/dev/null || true)" == "${ANDROID_WORLD_COMMIT}" ]] \
  && [[ -x "${VENV}/bin/python" ]] \
  && "${VENV}/bin/python" -c 'import android_world' >/dev/null 2>&1 \
  && { [[ -f "${AVD_ROOT}/actonce_android_world_api33.ini" ]] || [[ -d "${AVD_ROOT}/actonce_android_world_api33.avd" ]]; }
}

if [[ "${1:-}" == "--check" ]]; then
  if environment_ready; then
    echo "AndroidWorld ${ANDROID_WORLD_COMMIT} environment check passed"
    exit 0
  fi
  echo "AndroidWorld environment is not ready; run npm run android-world:bootstrap from the coordinator" >&2
  exit 1
fi

if [[ $# -ne 0 ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi

if environment_ready; then
  echo "AndroidWorld ${ANDROID_WORLD_COMMIT} already ready in ${SOURCE}"
  exit 0
fi

ACTONCE_ANDROID_API=33 \
ACTONCE_AVD_NAME=actonce_android_world_api33 \
ACTONCE_DATA_PARTITION_SIZE=8589934592 \
ACTONCE_PARTITION_SIZE_MB=8192 \
  bash "${ROOT}/scripts/android/bootstrap-sdk.sh"

mkdir -p "${CACHE}"
if [[ ! -d "${SOURCE}/.git" ]]; then
  git clone https://github.com/google-research/android_world.git "${SOURCE}"
fi
git -C "${SOURCE}" fetch --depth 1 origin "${ANDROID_WORLD_COMMIT}"
git -C "${SOURCE}" checkout --detach "${ANDROID_WORLD_COMMIT}"
apply_patches

PYTHON_BIN="$(resolve_python)"
if [[ -x "${VENV}/bin/python" ]] && ! python_is_supported "${VENV}/bin/python"; then
  rm -rf "${VENV}"
fi
if [[ ! -x "${VENV}/bin/python" ]]; then
  "${PYTHON_BIN}" -m venv "${VENV}"
fi
echo "Using $("${VENV}/bin/python" --version) for AndroidWorld"
"${VENV}/bin/pip" install --disable-pip-version-check -q -r "${SOURCE}/requirements.txt"
"${VENV}/bin/pip" install --disable-pip-version-check -q -e "${SOURCE}"
echo "AndroidWorld ${ANDROID_WORLD_COMMIT} ready in ${SOURCE}"
