#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

VERSION="2.2.0"
BUILD="25"
PACKAGE="com.saucelabs.mydemoapp.android"
ACTIVITY="${PACKAGE}/.view.activities.SplashActivity"
APK_NAME="mda-${VERSION}-${BUILD}.apk"
APK_URL="https://github.com/saucelabs/my-demo-app-android/releases/download/${VERSION}/${APK_NAME}"
APK_SHA256="318ef64bdcaff18e576d962ab1f557e0a2683b9b5210a6bb6b25cb0caeef62b4"
APK_DIR="${ACTONCE_ROOT}/.cache/apks"
APK_PATH="${APK_DIR}/${APK_NAME}"
ACTION="${1:-prepare}"

ensure_device() {
  adb -s "${ACTONCE_ANDROID_SERIAL}" get-state >/dev/null
}

prepare() {
  mkdir -p "${APK_DIR}"
  if [[ ! -f "${APK_PATH}" ]]; then
    curl --fail --location --retry 3 --output "${APK_PATH}" "${APK_URL}"
  fi
  echo "${APK_SHA256}  ${APK_PATH}" | shasum -a 256 --check
}

install_app() {
  ensure_device
  prepare
  adb -s "${ACTONCE_ANDROID_SERIAL}" install -r "${APK_PATH}" >/dev/null
}

launch_app() {
  ensure_device
  adb -s "${ACTONCE_ANDROID_SERIAL}" shell am start -W -n "${ACTIVITY}" >/dev/null
}

reset_app() {
  ensure_device
  adb -s "${ACTONCE_ANDROID_SERIAL}" shell pm path "${PACKAGE}" >/dev/null || install_app
  adb -s "${ACTONCE_ANDROID_SERIAL}" shell pm clear "${PACKAGE}" >/dev/null
  launch_app
  local deadline=$((SECONDS + 30))
  while (( SECONDS < deadline )); do
    adb -s "${ACTONCE_ANDROID_SERIAL}" shell uiautomator dump /sdcard/actonce-window.xml >/dev/null 2>&1 || true
    if adb -s "${ACTONCE_ANDROID_SERIAL}" shell cat /sdcard/actonce-window.xml 2>/dev/null | grep -q 'text="Products"'; then
      echo "My Demo App Android ${VERSION} reset on ${ACTONCE_ANDROID_SERIAL}"
      return
    fi
    sleep 0.2
  done
  echo "Timed out waiting for the My Demo App catalog" >&2
  exit 1
}

case "${ACTION}" in
  prepare) prepare ;;
  install) install_app ;;
  reset) reset_app ;;
  launch) launch_app ;;
  *) echo "Usage: $0 {prepare|install|reset|launch}" >&2; exit 2 ;;
esac
