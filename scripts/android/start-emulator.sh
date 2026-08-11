#!/usr/bin/env bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

HEADED=false
FOREGROUND=false
for argument in "$@"; do
  case "${argument}" in
    --headed)
      HEADED=true
      ;;
    --foreground)
      FOREGROUND=true
      ;;
    *)
      echo "Unknown argument: ${argument}" >&2
      exit 2
      ;;
  esac
done

if [[ ! -x "${ANDROID_SDK_ROOT}/emulator/emulator" ]]; then
  "${SCRIPT_DIR}/bootstrap-sdk.sh"
  source "${SCRIPT_DIR}/env.sh"
fi

if adb -s "${ACTONCE_ANDROID_SERIAL}" get-state 2>/dev/null | grep -q "device"; then
  echo "Emulator already running: ${ACTONCE_ANDROID_SERIAL}"
  exit 0
fi

mkdir -p "${ACTONCE_ROOT}/.cache/android-runtime"
LOG_PATH="${ACTONCE_ROOT}/.cache/android-runtime/emulator.log"
PID_PATH="${ACTONCE_ROOT}/.cache/android-runtime/emulator.pid"

EMULATOR_ARGS=(
  -avd "${ACTONCE_AVD_NAME}"
  -port "${ACTONCE_EMULATOR_PORT}"
  -no-snapshot
  -no-cache
  -no-boot-anim
  -no-audio
  -gpu swiftshader_indirect
  -camera-back none
  -camera-front none
  -partition-size "${ACTONCE_PARTITION_SIZE_MB}"
)

if [[ "${HEADED}" == "false" ]]; then
  EMULATOR_ARGS+=(-no-window)
fi

echo "Starting ${ACTONCE_AVD_NAME} as ${ACTONCE_ANDROID_SERIAL}..."
nohup emulator "${EMULATOR_ARGS[@]}" </dev/null >"${LOG_PATH}" 2>&1 &
EMULATOR_PID=$!
if [[ "${FOREGROUND}" == "false" ]]; then
  disown "${EMULATOR_PID}" 2>/dev/null || true
fi
echo "${EMULATOR_PID}" >"${PID_PATH}"

BOOT_DEADLINE=$((SECONDS + 240))
while (( SECONDS < BOOT_DEADLINE )); do
  if ! kill -0 "${EMULATOR_PID}" 2>/dev/null; then
    echo "Emulator exited before boot. Log follows:" >&2
    tail -80 "${LOG_PATH}" >&2
    exit 1
  fi

  if [[ "$(adb -s "${ACTONCE_ANDROID_SERIAL}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
    break
  fi

  sleep 2
done

if [[ "$(adb -s "${ACTONCE_ANDROID_SERIAL}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]]; then
  echo "Timed out waiting for ${ACTONCE_ANDROID_SERIAL}. See ${LOG_PATH}" >&2
  exit 1
fi

adb -s "${ACTONCE_ANDROID_SERIAL}" shell settings put global window_animation_scale 0
adb -s "${ACTONCE_ANDROID_SERIAL}" shell settings put global transition_animation_scale 0
adb -s "${ACTONCE_ANDROID_SERIAL}" shell settings put global animator_duration_scale 0
adb -s "${ACTONCE_ANDROID_SERIAL}" shell svc power stayon true
adb -s "${ACTONCE_ANDROID_SERIAL}" shell input keyevent 82

echo "Android emulator ready: ${ACTONCE_ANDROID_SERIAL}"
echo "Log: ${LOG_PATH}"

if [[ "${FOREGROUND}" == "true" ]]; then
  echo "Keeping emulator in the foreground; press Ctrl-C or run npm run android:stop to stop it."
  wait "${EMULATOR_PID}"
fi
