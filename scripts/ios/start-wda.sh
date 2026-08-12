#!/usr/bin/env bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

ACTONCE_IOS_UDID="$("${SCRIPT_DIR}/resolve-device.sh")"
export ACTONCE_IOS_UDID
WDA_PROJECT="${ACTONCE_ROOT}/node_modules/appium-webdriveragent/WebDriverAgent.xcodeproj"
RUNTIME_DIR="${ACTONCE_ROOT}/.cache/ios-runtime"
DERIVED_DATA_DIR="${ACTONCE_ROOT}/.cache/ios-wda-derived"
LOG_PATH="${RUNTIME_DIR}/wda.log"
PID_PATH="${RUNTIME_DIR}/wda.pid"

if [[ ! -d "${WDA_PROJECT}" ]]; then
  echo "WebDriverAgent is not installed. Run npm install first." >&2
  exit 1
fi

if curl --silent --fail --max-time 2 \
  "http://${ACTONCE_WDA_HOST}:${ACTONCE_WDA_PORT}/status" >/dev/null; then
  echo "WebDriverAgent already ready at http://${ACTONCE_WDA_HOST}:${ACTONCE_WDA_PORT}"
  exit 0
fi

if [[ "$(xcrun simctl list devices -j | jq -r --arg udid "${ACTONCE_IOS_UDID}" '.devices[][] | select(.udid == $udid) | .state')" != "Booted" ]]; then
  "${SCRIPT_DIR}/start-simulator.sh"
fi

mkdir -p "${RUNTIME_DIR}"
echo "Starting WebDriverAgent for ${ACTONCE_IOS_DEVICE_NAME} (${ACTONCE_IOS_UDID})..."
(
  cd "${ACTONCE_ROOT}"
  exec nohup env \
    USE_PORT="${ACTONCE_WDA_PORT}" \
    MJPEG_SERVER_PORT="${ACTONCE_WDA_MJPEG_PORT}" \
    xcodebuild \
      -project "${WDA_PROJECT}" \
      -scheme WebDriverAgentRunner \
      -destination "id=${ACTONCE_IOS_UDID}" \
      -derivedDataPath "${DERIVED_DATA_DIR}" \
      test
) </dev/null >"${LOG_PATH}" 2>&1 &
WDA_PID=$!
echo "${WDA_PID}" >"${PID_PATH}"

DEADLINE=$((SECONDS + 120))
WDA_READY=false
while (( SECONDS < DEADLINE )); do
  if curl --silent --fail --max-time 2 \
    "http://${ACTONCE_WDA_HOST}:${ACTONCE_WDA_PORT}/status" >/dev/null; then
    WDA_READY=true
    break
  fi

  if ! kill -0 "${WDA_PID}" 2>/dev/null; then
    echo "WebDriverAgent exited before becoming ready. Log follows:" >&2
    tail -100 "${LOG_PATH}" >&2
    exit 1
  fi

  sleep 2
done

if [[ "${WDA_READY}" != "true" ]]; then
  echo "Timed out waiting for WebDriverAgent. Log follows:" >&2
  tail -100 "${LOG_PATH}" >&2
  exit 1
fi

echo "WebDriverAgent ready at http://${ACTONCE_WDA_HOST}:${ACTONCE_WDA_PORT}"
echo "Log: ${LOG_PATH}"
echo "Keep this process running; press Ctrl-C or run npm run ios:wda:stop from another terminal."
wait "${WDA_PID}"
