#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

if adb -s "${ACTONCE_ANDROID_SERIAL}" get-state 2>/dev/null | grep -q "device"; then
  adb -s "${ACTONCE_ANDROID_SERIAL}" emu kill
  echo "Stopped ${ACTONCE_ANDROID_SERIAL}"
else
  echo "${ACTONCE_ANDROID_SERIAL} is not running"
fi
