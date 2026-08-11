#!/usr/bin/env bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

if ! java -version >/dev/null 2>&1; then
  "${SCRIPT_DIR}/bootstrap-jdk.sh"
  source "${SCRIPT_DIR}/env.sh"
fi

if [[ ! -x "${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin/sdkmanager" ]]; then
  if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
    echo "Automatic Android SDK bootstrap currently supports macOS Apple Silicon only." >&2
    echo "Install Android command-line tools and set ANDROID_SDK_ROOT." >&2
    exit 1
  fi

  TOOLS_ARCHIVE="commandlinetools-mac_arm64-15859902_latest.zip"
  TOOLS_URL="https://dl.google.com/android/repository/${TOOLS_ARCHIVE}"
  TOOLS_SHA256="835b62a26162b229b441d1f6d4680383815a270809eb33522c0d480fa5002c4e"
  TEMP_DIR="$(mktemp -d)"
  trap 'rm -rf "${TEMP_DIR}"' EXIT

  echo "Downloading Android command-line tools..."
  curl --fail --location --retry 3 --output "${TEMP_DIR}/${TOOLS_ARCHIVE}" "${TOOLS_URL}"
  echo "${TOOLS_SHA256}  ${TEMP_DIR}/${TOOLS_ARCHIVE}" | shasum -a 256 --check
  unzip -q "${TEMP_DIR}/${TOOLS_ARCHIVE}" -d "${TEMP_DIR}/unpacked"

  mkdir -p "${ANDROID_SDK_ROOT}/cmdline-tools"
  mv "${TEMP_DIR}/unpacked/cmdline-tools" "${ANDROID_SDK_ROOT}/cmdline-tools/latest"
fi

yes | sdkmanager --licenses >/dev/null || true
sdkmanager \
  "platform-tools" \
  "emulator" \
  "${ACTONCE_SYSTEM_IMAGE}"

mkdir -p "${ANDROID_AVD_HOME}"
if ! avdmanager list avd | grep -Fq "Name: ${ACTONCE_AVD_NAME}"; then
  echo "Creating AVD ${ACTONCE_AVD_NAME} from ${ACTONCE_SYSTEM_IMAGE}..."
  echo "no" | avdmanager create avd \
    --force \
    --name "${ACTONCE_AVD_NAME}" \
    --package "${ACTONCE_SYSTEM_IMAGE}" \
    --device "pixel_6"
fi

AVD_CONFIG="${ANDROID_AVD_HOME}/${ACTONCE_AVD_NAME}.avd/config.ini"
if [[ ! -f "${AVD_CONFIG}" ]]; then
  echo "AVD configuration was not created at ${AVD_CONFIG}" >&2
  exit 1
fi
perl -pi -e \
  "s/^disk\.dataPartition\.size\s*=.*/disk.dataPartition.size = ${ACTONCE_DATA_PARTITION_SIZE}/" \
  "${AVD_CONFIG}"

echo "Android environment ready:"
echo "  SDK: ${ANDROID_SDK_ROOT}"
echo "  AVD: ${ACTONCE_AVD_NAME}"
echo "  image: ${ACTONCE_SYSTEM_IMAGE}"
echo "  userdata: ${ACTONCE_DATA_PARTITION_SIZE}"
