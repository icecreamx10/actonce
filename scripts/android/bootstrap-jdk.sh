#!/usr/bin/env bash

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"

if java -version >/dev/null 2>&1; then
  echo "Java already available: $(command -v java)"
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Automatic JDK bootstrap currently supports macOS Apple Silicon only." >&2
  echo "Install JDK 21 and set JAVA_HOME, then run this script again." >&2
  exit 1
fi

JDK_URL="https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12%2B8/OpenJDK21U-jdk_aarch64_mac_hotspot_21.0.12_8.tar.gz"
JDK_SHA256="021d629349ebc12a409faa517b837ec80ceee8f58a5ac85c788ecad07ca6881c"
JDK_ROOT="${ACTONCE_ROOT}/.cache/jdk"

if [[ -x "${JDK_ROOT}/Contents/Home/bin/java" ]]; then
  echo "Repository-local JDK already installed at ${JDK_ROOT}"
  exit 0
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TEMP_DIR}"' EXIT
ARCHIVE="${TEMP_DIR}/jdk.tar.gz"

echo "Downloading Temurin JDK 21.0.12+8..."
curl --fail --location --retry 3 --output "${ARCHIVE}" "${JDK_URL}"
echo "${JDK_SHA256}  ${ARCHIVE}" | shasum -a 256 --check

mkdir -p "${ACTONCE_ROOT}/.cache"
tar -xzf "${ARCHIVE}" -C "${TEMP_DIR}"
mv "${TEMP_DIR}/jdk-21.0.12+8/Contents" "${TEMP_DIR}/Contents"
mkdir -p "${JDK_ROOT}"
mv "${TEMP_DIR}/Contents" "${JDK_ROOT}/Contents"

"${JDK_ROOT}/Contents/Home/bin/java" -version
