#!/bin/sh
set -e
# Stage only app runtime files so the IPK excludes repo-only content (.git, docs, .superpowers, this script).
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
rsync -a \
  --exclude '.git' --exclude '.gitignore' --exclude '.DS_Store' \
  --exclude '.superpowers' --exclude 'docs' --exclude 'dist' --exclude 'package.sh' \
  ./ "$STAGE"/
ares-package "$STAGE" -o dist/
