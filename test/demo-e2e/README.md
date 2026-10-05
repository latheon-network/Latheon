# Demo end-to-end test (reference)

`e2e.js` starts three local chains (chainId 11155111, 421614, 46630) on ganache, deploys the full V5 stack on each in the
same order (so contract addresses coincide across chains, as they do on the real testnets), injects a mock wallet into the
demo page and runs 16 checks in a real Chromium: registry loading, faucet, deposit, withdrawal, the same pool address on two
chains, a 6-decimals token, a note from another network, double spend, disclosure, the legacy V4 pool, malformed and
old-format notes, and the absence of JavaScript errors.

It is a **reference script, not turnkey**: paths are hard-coded for the environment it was written in, and it needs
Playwright with Chromium plus local browser bundles of `ethers`, `snarkjs` and `poseidon-lite` (built with esbuild; the CommonJS
`poseidon-lite` needs explicit named exports). Adapt the paths before reuse.

It does not replace a test with a real wallet and live RPC endpoints.
