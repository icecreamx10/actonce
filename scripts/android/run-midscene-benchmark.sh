#!/usr/bin/env bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

cd "${ACTONCE_ROOT}"
exec npx tsx benchmark/android/midscene-settings-smoke.ts
