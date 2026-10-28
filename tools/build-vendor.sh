#!/bin/sh
# Builds the browser libraries the demo and the bridge page load, from the exact npm versions pinned in
# test/distribution/package.json, into demo/vendor/ (served from our own site; no third-party script CDN).
# Rebuild after changing a version there:  (cd test/distribution && npm ci) && sh tools/build-vendor.sh
set -e
cd "$(dirname "$0")/.."
N="$(pwd)/test/distribution/node_modules"
V() { node -p "require('$N/$1/package.json').version"; }
ETH=$(V ethers); SNK=$(V snarkjs); POS=$(V poseidon-lite)
B=.vendor-build; mkdir -p $B demo/vendor
npm i --no-save --prefix $B esbuild@0.24.0 >/dev/null 2>&1
echo "export * from 'ethers';" > $B/eth.js
echo "export { poseidon2, poseidon4 } from 'poseidon-lite';" > $B/pos.js
printf "import * as s from '%s/snarkjs/build/browser.esm.js';\nexport const groth16 = s.groth16;\n" "$N" > $B/snk.js
E=$B/node_modules/.bin/esbuild
rm -f demo/vendor/*.mjs
$E $B/eth.js --bundle --minify --format=esm --platform=browser --outfile=demo/vendor/ethers-$ETH.mjs --alias:ethers="$N/ethers" --log-level=warning
$E $B/pos.js --bundle --minify --format=esm --platform=browser --outfile=demo/vendor/poseidon-lite-$POS.mjs --alias:poseidon-lite="$N/poseidon-lite" --log-level=warning
$E $B/snk.js --bundle --minify --format=esm --platform=browser --outfile=demo/vendor/snarkjs-$SNK.mjs --log-level=warning
(cd demo/vendor && sha256sum *.mjs > SHA256SUMS)
rm -rf $B
echo "demo/vendor: ethers $ETH, snarkjs $SNK, poseidon-lite $POS"; cat demo/vendor/SHA256SUMS
