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

## Router features: `router-e2e.js`

Covers the demo's network/token selectors and the two router modes (deposit of any amount, withdrawal by amount and master
key). It deploys the real V5 pools and `LatheonDistributionPool` on three local chains, injects a mock wallet and uses real
Groth16 proofs. 35 checks: pool list shown only in the fixed modes; exact and rounded deposits (160, 99 → 90, 12 USDG with
6 decimals, 999 = 23 notes, refusal above 32 notes); the master key format; amounts that cannot be paid (nearest sum shown,
no transaction); wrong key, unknown router, malformed key; spent notes; partial withdrawals; separate notes withdrawn
through the ordinary one-note flow; RU/ZH text; no JavaScript errors.

```
cd test/distribution && npm install && cd ../demo-e2e
sh build-bundles.sh
DEMO=/path/to/demo node router-e2e.js
```

It is a local test, not a replacement for a run with a real wallet. That was also done: see `STATUS.md`.

## RPC robustness: `rpc-robust.js`

Checks the block between `rpc-robust:begin` and `rpc-robust:end` in `demo/index.html` with a fake endpoint: transient
errors such as "could not coalesce error" are retried with backoff, a block range the endpoint refuses is split in half
until it fits, a contract error (`CALL_EXCEPTION`) is not retried, an endpoint that stays down ends with its original
error instead of looping, at most 4 requests are in flight, and every retry is written to the page log. 8 checks, no
network and no packages: `node rpc-robust.js`. It does not replace a run against live endpoints.

Note: `e2e.js` predates the network and token selectors. Against the current demo its single-pool deposit and withdrawal
still pass, but it stops at the pool selector (`#poolSelect`) and needs updating; `router-e2e.js` covers the selectors.
