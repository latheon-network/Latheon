# Demo end-to-end test (reference)

`e2e.js` starts three local chains (chainId 11155111, 421614, 46630) on ganache, deploys the full V5 stack on each in the
same order (so contract addresses coincide across chains, as they do on the real testnets), injects a mock wallet into the
demo page and runs 18 checks in a real Chromium: registry loading, faucet, deposit, withdrawal, the same pool address on two
chains, a 6-decimals token, a note from another network, double spend, disclosure, the no-wallet "I'm an auditor" tab (a valid proof is accepted, a proof made for another one-time code is rejected), the legacy V4 pool, malformed and
old-format notes, and the absence of JavaScript errors.

Updated for the tabbed layout of the redesigned demo (Deposit / Withdraw / Disclose tabs and the "I saved the note" confirmation); all 18 checks pass against it.

It is a **reference script, not turnkey**: paths are hard-coded for the environment it was written in, and it needs
Playwright with Chromium plus local browser bundles of `ethers`, `snarkjs` and `poseidon-lite` (built with esbuild; the CommonJS
`poseidon-lite` needs explicit named exports). Adapt the paths before reuse.

It does not replace a test with a real wallet and live RPC endpoints.
