#!/usr/bin/env bash
set -euo pipefail

check() {
  command -v "$1" &>/dev/null || { echo "ERROR: $1 required. See: $2"; exit 1; }
}
check node "https://nodejs.org"
check pnpm "https://pnpm.io/installation"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGES_DIR="$(cd "${SCRIPT_DIR}/../zenbu/packages" && pwd)"
REGISTRY_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)/registry"

cat > "${SCRIPT_DIR}/tsconfig.local.json" <<EOF
{
  "compilerOptions": {
    "paths": {
      "@testbu/*": ["${PACKAGES_DIR}/*"],
      "#registry/*": ["${REGISTRY_DIR}/*"]
    }
  }
}
EOF
echo "  ✓ wrote tsconfig.local.json"

echo "Installing packages..."
pnpm install --dir "${SCRIPT_DIR}"
echo "  ✓ pnpm install done"
