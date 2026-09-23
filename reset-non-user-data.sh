#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--yes" ]]; then
  echo "This removes non-user transactional data and keeps User/PublicAccount records."
  echo "Run again with: ./reset-non-user-data.sh --yes"
  exit 1
fi

cd "$(dirname "$0")"

echo "Starting non-user data reset..."
if [[ -f "dist/scripts/reset-non-user-data.js" ]]; then
  node dist/scripts/reset-non-user-data.js
else
  npm run reset:non-user-data
fi
echo "Non-user data reset finished."
