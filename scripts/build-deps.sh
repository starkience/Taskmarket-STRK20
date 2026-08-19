#!/usr/bin/env bash
# Builds the two StarkWare packages from source into vendor/tarballs/.
#
# They are published to GitHub Packages, which needs a token carrying
# `read:packages`. Building from source needs only a public clone, so this is
# the reproducible path and the one `npm ci` depends on.
#
# Both pins below are load-bearing:
#
#   SDK_TAG          The pool deployed at 0x040337b1... has class hash
#                    0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d.
#                    PRIVACY-0.14.3-RC.3 and RC.4 both compile (release profile,
#                    scarb 2.17.0) to exactly that hash — they differ by one
#                    blank line. RC.5 changes signature validation in
#                    utils.cairo and does NOT match. Do not move to RC.5 without
#                    re-checking against the deployed class.
#
#   BRIDGE_COMMIT    privacy-bridge pins the SDK to 0.14.3-rc.3 and peer-pins
#                    starknet to exactly 10.0.0-beta.6. Both are mirrored in our
#                    package.json.
#
# Usage: scripts/build-deps.sh

set -euo pipefail

SDK_TAG="PRIVACY-0.14.3-RC.3"
BRIDGE_COMMIT="0ba65f00fdee3af3419a7562c36b14fc2e92b8a7"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/vendor/tarballs"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$OUT"

echo "==> Building SDK from $SDK_TAG"
git clone -q --depth 1 --branch "$SDK_TAG" \
  https://github.com/starkware-libs/starknet-privacy.git "$WORK/sdk-src"
cd "$WORK/sdk-src/sdk"
# --ignore-scripts: the SDK's generated ABIs and Cairo hashes are committed, so
# no Scarb build is needed here.
npm ci --ignore-scripts >/dev/null
npm run build >/dev/null
SDK_TGZ="$(npm pack 2>/dev/null | tail -1)"
cp "$SDK_TGZ" "$OUT/"
echo "    $SDK_TGZ"

echo "==> Building bridge-core from $BRIDGE_COMMIT"
git clone -q https://github.com/starkware-libs/privacy-bridge.git "$WORK/bridge-src"
cd "$WORK/bridge-src"
git checkout -q "$BRIDGE_COMMIT"
# Resolve the SDK from the tarball just built rather than GitHub Packages.
node -e "
const fs = require('fs');
const j = JSON.parse(fs.readFileSync('package.json', 'utf8'));
j.pnpm = j.pnpm || {};
j.pnpm.overrides = j.pnpm.overrides || {};
j.pnpm.overrides['@starkware-libs/starknet-privacy-sdk'] = 'file:$OUT/$SDK_TGZ';
fs.writeFileSync('package.json', JSON.stringify(j, null, 2));
"
corepack pnpm install --ignore-scripts --no-frozen-lockfile >/dev/null
cd packages/bridge-core
corepack pnpm run build >/dev/null
BRIDGE_TGZ="$(npm pack 2>/dev/null | tail -1)"
cp "$BRIDGE_TGZ" "$OUT/"
echo "    $BRIDGE_TGZ"

echo
echo "Done. Now run:"
echo "  npm install"
