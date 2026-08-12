#!/usr/bin/env bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

ACTONCE_IOS_UDID="$("${SCRIPT_DIR}/resolve-device.sh")"
export ACTONCE_IOS_UDID

STATE="$(
  xcrun simctl list devices -j |
    jq -r --arg udid "${ACTONCE_IOS_UDID}" \
      '.devices[][] | select(.udid == $udid) | .state'
)"

if [[ "${STATE}" != "Booted" ]]; then
  echo "Booting ${ACTONCE_IOS_DEVICE_NAME} (${ACTONCE_IOS_UDID})..."
  xcrun simctl boot "${ACTONCE_IOS_UDID}"
fi

open -a Simulator --args -CurrentDeviceUDID "${ACTONCE_IOS_UDID}"
xcrun simctl bootstatus "${ACTONCE_IOS_UDID}" -b

echo "iOS Simulator ready: ${ACTONCE_IOS_DEVICE_NAME} (${ACTONCE_IOS_UDID})"
