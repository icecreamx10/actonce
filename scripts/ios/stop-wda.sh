#!/usr/bin/env bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

PID_PATH="${ACTONCE_ROOT}/.cache/ios-runtime/wda.pid"
if [[ -f "${PID_PATH}" ]]; then
  WDA_PID="$(<"${PID_PATH}")"
  if [[ "${WDA_PID}" =~ ^[0-9]+$ ]] && kill -0 "${WDA_PID}" 2>/dev/null; then
    kill -INT "${WDA_PID}"
    for _ in 1 2 3 4 5; do
      if ! kill -0 "${WDA_PID}" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    if kill -0 "${WDA_PID}" 2>/dev/null; then
      kill -TERM "${WDA_PID}"
    fi
  fi
  rm -f "${PID_PATH}"
fi

ACTONCE_IOS_UDID="$("${SCRIPT_DIR}/resolve-device.sh")"
xcrun simctl terminate \
  "${ACTONCE_IOS_UDID}" \
  com.facebook.WebDriverAgentRunner.xctrunner 2>/dev/null || true

echo "WebDriverAgent stopped for ${ACTONCE_IOS_UDID}"
