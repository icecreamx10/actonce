#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

MARKOR_VERSION="2.16.1"
MARKOR_APK_NAME="net.gsantner.markor-v163-2.16.1-flavorDefault-release.apk"
MARKOR_URL="https://github.com/gsantner/markor/releases/download/v${MARKOR_VERSION}/${MARKOR_APK_NAME}"
MARKOR_SHA256="e88cdcced7aa3dca25e6b9c7a9bdcfad3e3988ee545be951f42bf9441b5e46bf"
APK_DIR="${ACTONCE_ROOT}/.cache/apks"
APK_PATH="${APK_DIR}/${MARKOR_APK_NAME}"

if ! adb -s "${ACTONCE_ANDROID_SERIAL}" get-state 2>/dev/null | grep -q "device"; then
  echo "Android emulator is not running. Run npm run android:start first." >&2
  exit 1
fi

mkdir -p "${APK_DIR}"
if [[ ! -f "${APK_PATH}" ]]; then
  echo "Downloading Markor ${MARKOR_VERSION} from its official GitHub release..."
  curl --fail --location --retry 3 --output "${APK_PATH}" "${MARKOR_URL}"
fi

echo "${MARKOR_SHA256}  ${APK_PATH}" | shasum -a 256 --check
adb -s "${ACTONCE_ANDROID_SERIAL}" install -r "${APK_PATH}"
adb -s "${ACTONCE_ANDROID_SERIAL}" shell pm clear net.gsantner.markor >/dev/null

echo "Markor ${MARKOR_VERSION} installed and reset on ${ACTONCE_ANDROID_SERIAL}"
