#!/usr/bin/env bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

if [[ -n "${ACTONCE_IOS_UDID:-}" ]]; then
  if ! xcrun simctl list devices -j | jq -e --arg udid "${ACTONCE_IOS_UDID}" \
    '[.devices[][] | select(.udid == $udid)] | length == 1' >/dev/null; then
    echo "iOS Simulator ${ACTONCE_IOS_UDID} does not exist" >&2
    exit 1
  fi
  printf '%s\n' "${ACTONCE_IOS_UDID}"
  exit 0
fi

EXISTING_UDID="$(
  xcrun simctl list devices -j |
    jq -r --arg name "${ACTONCE_IOS_DEVICE_NAME}" \
      '[.devices[][] | select(.name == $name and .isAvailable == true)][0].udid // empty'
)"

if [[ -n "${EXISTING_UDID}" ]]; then
  printf '%s\n' "${EXISTING_UDID}"
  exit 0
fi

xcrun simctl create \
  "${ACTONCE_IOS_DEVICE_NAME}" \
  "${ACTONCE_IOS_DEVICE_TYPE}" \
  "${ACTONCE_IOS_RUNTIME}"

