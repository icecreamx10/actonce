#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

FIXTURE_FILE="${ACTONCE_ROOT}/benchmark/ios/my-demo-app/fixture.json"
FIXTURE_NAME="$(jq -r '.name' "${FIXTURE_FILE}")"
FIXTURE_VERSION="$(jq -r '.version' "${FIXTURE_FILE}")"
FIXTURE_URL="$(jq -r '.artifactUrl' "${FIXTURE_FILE}")"
FIXTURE_SHA256="$(jq -r '.sha256' "${FIXTURE_FILE}")"
FIXTURE_APP_PATH="$(jq -r '.archiveAppPath' "${FIXTURE_FILE}")"
FIXTURE_BUNDLE_ID="$(jq -r '.bundleId' "${FIXTURE_FILE}")"
CACHE_DIR="${ACTONCE_ROOT}/.cache/ios-fixtures/saucelabs-my-demo-app/${FIXTURE_VERSION}"
ARCHIVE_PATH="${CACHE_DIR}/SauceLabs-Demo-App.Simulator.zip"
EXTRACTED_DIR="${CACHE_DIR}/extracted"
APP_PATH="${EXTRACTED_DIR}/${FIXTURE_APP_PATH}"

usage() {
  echo "Usage: $0 <prepare|install|reset|launch|print-path>" >&2
}

archive_is_valid() {
  [[ -f "${ARCHIVE_PATH}" ]] &&
    [[ "$(shasum -a 256 "${ARCHIVE_PATH}" | awk '{print $1}')" == "${FIXTURE_SHA256}" ]]
}

app_is_valid() {
  [[ -d "${APP_PATH}" ]] &&
    [[ "$(plutil -extract CFBundleIdentifier raw "${APP_PATH}/Info.plist" 2>/dev/null || true)" == "${FIXTURE_BUNDLE_ID}" ]] &&
    [[ "$(plutil -extract CFBundleShortVersionString raw "${APP_PATH}/Info.plist" 2>/dev/null || true)" == "${FIXTURE_VERSION}" ]]
}

prepare_fixture() {
  mkdir -p "${CACHE_DIR}"

  if ! archive_is_valid; then
    local download_path="${ARCHIVE_PATH}.download.$$"
    echo "Downloading ${FIXTURE_NAME} ${FIXTURE_VERSION}..."
    curl -fL --retry 3 "${FIXTURE_URL}" -o "${download_path}"
    local downloaded_sha
    downloaded_sha="$(shasum -a 256 "${download_path}" | awk '{print $1}')"
    if [[ "${downloaded_sha}" != "${FIXTURE_SHA256}" ]]; then
      echo "Fixture checksum mismatch: expected ${FIXTURE_SHA256}, got ${downloaded_sha}" >&2
      mv "${download_path}" "${download_path}.invalid"
      exit 1
    fi
    mv "${download_path}" "${ARCHIVE_PATH}"
  fi

  if ! app_is_valid; then
    local extracted_path="${CACHE_DIR}/extracted.$$"
    mkdir -p "${extracted_path}"
    ditto -x -k "${ARCHIVE_PATH}" "${extracted_path}"
    local candidate_path="${extracted_path}/${FIXTURE_APP_PATH}"
    if [[ ! -d "${candidate_path}" ]]; then
      echo "Fixture archive does not contain ${FIXTURE_APP_PATH}" >&2
      mv "${extracted_path}" "${extracted_path}.invalid"
      exit 1
    fi
    if [[ -e "${EXTRACTED_DIR}" ]]; then
      mv "${EXTRACTED_DIR}" "${EXTRACTED_DIR}.invalid.$(date +%s)"
    fi
    mv "${extracted_path}" "${EXTRACTED_DIR}"
  fi

  echo "Fixture ready: ${APP_PATH}"
}

resolve_booted_device() {
  "${SCRIPT_DIR}/start-simulator.sh" >/dev/null
  "${SCRIPT_DIR}/resolve-device.sh"
}

install_fixture() {
  prepare_fixture
  local udid
  udid="$(resolve_booted_device)"
  xcrun simctl install "${udid}" "${APP_PATH}"
  echo "Installed ${FIXTURE_NAME} ${FIXTURE_VERSION} on ${udid}"
}

reset_fixture() {
  prepare_fixture
  local udid
  udid="$(resolve_booted_device)"
  xcrun simctl terminate "${udid}" "${FIXTURE_BUNDLE_ID}" >/dev/null 2>&1 || true
  xcrun simctl uninstall "${udid}" "${FIXTURE_BUNDLE_ID}" >/dev/null 2>&1 || true
  xcrun simctl install "${udid}" "${APP_PATH}"
  xcrun simctl launch --terminate-running-process "${udid}" "${FIXTURE_BUNDLE_ID}" >/dev/null
  echo "Reset and launched ${FIXTURE_NAME} ${FIXTURE_VERSION} on ${udid}"
}

launch_fixture() {
  local udid
  udid="$(resolve_booted_device)"
  xcrun simctl launch --terminate-running-process "${udid}" "${FIXTURE_BUNDLE_ID}"
}

case "${1:-}" in
  prepare)
    prepare_fixture
    ;;
  install)
    install_fixture
    ;;
  reset)
    reset_fixture
    ;;
  launch)
    launch_fixture
    ;;
  print-path)
    prepare_fixture >/dev/null
    printf '%s\n' "${APP_PATH}"
    ;;
  *)
    usage
    exit 2
    ;;
esac
