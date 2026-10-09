#!/bin/sh
# Builds the three browser bundles that router-e2e.js serves in place of https://esm.run/... (no network needed).
set -e
cd "$(dirname "$0")"
N="$(pwd)/../distribution/node_modules"
mkdir -p bundles .build
npm i --no-save --prefix .build esbuild >/dev/null
echo "export * from 'ethers';" > .build/b_eth.js
echo "export { poseidon2, poseidon4 } from 'poseidon-lite';" > .build/b_pos.js
printf "import * as s from '%s/snarkjs/build/browser.esm.js';\nexport const groth16 = s.groth16;\nexport const plonk = s.plonk;\n" "$N" > .build/b_snark.js
E=.build/node_modules/.bin/esbuild
$E .build/b_eth.js --bundle --format=esm --platform=browser --outfile=bundles/ethers.mjs --alias:ethers="$N/ethers" --log-level=warning
$E .build/b_pos.js --bundle --format=esm --platform=browser --outfile=bundles/poseidon.mjs --alias:poseidon-lite="$N/poseidon-lite" --log-level=warning
$E .build/b_snark.js --bundle --format=esm --platform=browser --outfile=bundles/snarkjs.mjs --log-level=warning
echo "bundles ready in $(pwd)/bundles"
