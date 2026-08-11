#!/usr/bin/env bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

for variable_name in \
  MIDSCENE_MODEL_BASE_URL \
  MIDSCENE_MODEL_API_KEY \
  MIDSCENE_MODEL_NAME \
  MIDSCENE_MODEL_FAMILY; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "${variable_name} is required for the Midscene smoke test." >&2
    exit 1
  fi
done

"${SCRIPT_DIR}/start-emulator.sh"
cd "${ACTONCE_ROOT}"
npm run benchmark:android:midscene
