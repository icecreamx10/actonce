#!/usr/bin/env bash

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <typescript-entrypoint>" >&2
  exit 2
fi

cd "${ACTONCE_ROOT}"
exec npx tsx "$1"
