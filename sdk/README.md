# @latheon/sdk

> **Scope:** the proof helpers in this SDK still target the old **V3** pool (a single `secret`) and do not support the `spendKey` / `viewKey` split or recipient-bound proofs of V5 and later. The current generation is **V7** on the Latheon test chain (circuit `withdraw_v5`, the pre-V7 flaw fixed); all older pools are frozen in our demo only: their contracts still accept deposits and stay forgeable, so check the `frozen` / `forgeable` flags in `deployments.json` and never deposit into such a pool. For a working V7 reference implementation (note format, Merkle path, proof inputs, withdraw call, router) see the demo, [`../demo/index.html`](../demo/index.html); pool addresses are in [`deployments.json`](./deployments.json). An SDK update is on the roadmap. Helpers for the distribution router (deposit planning, master key, note selection) are in [`distribution.js`](./distribution.js); the router addresses are in `deployments.json` under `routers`.

## Do not deposit into pre-V7 pools

Every Latheon pool before V7 (V3, V4, V5, V6, on every network, including all pools on Ethereum Sepolia, Arbitrum Sepolia and Robinhood Chain Testnet) uses a withdrawal circuit with a known flaw: a forged proof can withdraw from the pool without any deposit (`THREAT-MODEL.md` §8.0). Our demo no longer deposits into them, but **the contracts themselves have no pause and still accept deposits**, and anything deposited there can be taken by anyone with such a proof. In [`deployments.json`](./deployments.json) these pools carry `"frozen": true, "forgeable": true` (their routers `"frozen": true`); only the V7 entries (`version` `v7-native` / `v7`, Latheon test chain) have neither flag. An integration must read those flags and never deposit into a flagged pool or router; such entries stay listed only so notes already in them can be withdrawn.

**The high-level `deposit()` of this SDK deposits into the V3 pool on Ethereum Sepolia by default** (`SEPOLIA.pool`, a pre-V7 pool that `deployments.json` does not list for Ethereum Sepolia). Do not call it; see the table below.

## Compatibility

What the code in this folder actually supports today (checked against `src/` and `distribution.js`, not against older descriptions). Schemes are the withdrawal circuits: `withdraw` (V3: one `secret`, public inputs `root, nullifierHash`, 8 levels), `v2` (V4: `spendKey` / `viewKey`, same public inputs), `v3` (V5: plus `recipient`, 8 levels), `v4` (V6: plus `relayer`, `fee`, 20 levels), `v5` (V7: as `v4`, with the Merkle path selector constrained to a bit); `disclose` is the disclosure circuit for `spendKey` / `viewKey` notes (V4 and later). Generations V3–V6 are pre-V7: withdrawals of existing notes only.

| SDK function | Scheme | Contract generations | Supported now |
|---|---|---|---|
| `SEPOLIA` (`src/constants.js`) | `withdraw` | V3 (token, V3 pool, verifier and LTH faucet on Ethereum Sepolia) | No: points at the pre-V7 V3 pool, which is forgeable |
| `DENOMINATION`, `LEVELS` | — | V3 / V4 / V5 (100 LTH, 8 levels) | No for V6/V7: their trees have 20 levels |
| `computeCommitment(secret)` = `Poseidon(secret, 0)` | `withdraw` | V3 | No for V4–V7: their commitment is `Poseidon(Poseidon(spendKey, viewKey), 0)`; it can be built from `hash2` in `src/poseidon.js` (not exported by `index.js`) plus `computeCommitment` |
| `computeNullifierHash(x)` = `Poseidon(x, 1)` | `withdraw`, `v2`–`v5` | V3–V7 | Yes, if passed `spendKey` for V4–V7 notes (the secret for V3) |
| `computeZeroCascade(levels = 8)` | all | V3–V7 (same zero rule in every pool) | Yes; pass `20` for V6/V7 |
| `fetchDeposits(provider, pool)` | all | V3–V7 (`Deposit(uint256 indexed, uint32, uint256)` is the same event everywhere) | Yes, but slow: scans from block 0 in 9,000-block steps and ignores `deployBlock` |
| `buildTreeLevels`, `getMerklePath` (`src/merkleTree.js`) | all | V3–V7 with the right `levels` | Yes, with `levels = 20` for V6/V7; not exported by `index.js` |
| `getProofInputsForCommitment(provider, pool, commitment)` | `withdraw`, `v2`, `v3` | V3 / V4 / V5 (8 levels, fixed) | No for V6/V7 (builds an 8-level path); V3–V5 are pre-V7 |
| `deposit(signer, opts)` | `withdraw` | V3 (ERC-20 approve + `deposit`, commitment from a single secret) | **No.** Default pool is the forgeable V3 pool. Into V4/V5 it creates a note whose commitment no `v2`/`v3` proof can open; native-coin pools (V5 native, V6, V7 on the Latheon test chain) need `msg.value` and revert |
| `withdraw(signer, proof, [root, nullifierHash], recipient, pool)` | `withdraw`, `v2` | V3 / V4 (`uint256[2]` public signals) | Only for existing V3/V4 notes; V5 takes `root, nullifierHash, recipient`, V6/V7 also `relayer, fee`: wrong ABI |
| Proof generation | — | — | Not in the SDK (see below) |
| Disclosure proof (`disclose`) | `disclose` | V4–V7 notes | Not in the SDK; the demo does it |
| `claimFromFaucet`, `timeUntilNextClaim` | — | `LatheonFaucet` on Ethereum Sepolia (500 LTH / 24 h) | Works against that faucet; not the Latheon test chain's faucet, which is a web page (`docs/testnet.md`) |
| `canonicalSplit`, `noteOrder`, `roundDown`, `planDeposit` (`distribution.js`) | — | routers V5, V6, V7 (same `split()` rule) | Yes; with the V7 router only |
| `deriveNoteKeys`, `formatMasterKey`, `parseMasterKey` (`distribution.js`) | `v2`–`v5` note keys | routers V5, V6, V7 | Yes; the demo uses the same code for V7 |
| `selectNotes` (`distribution.js`) | — | any | Yes |

In short: for V7 today, use `distribution.js` for router deposit planning, master keys and note selection, and the demo ([`../demo/index.html`](../demo/index.html)) as the reference for note format, 20-level Merkle paths, `withdraw_v5` proofs, the withdraw and `withdrawMany` calls and disclosure. Updating `src/` for V7 is on the roadmap (`ROADMAP.md`).

A JavaScript SDK for interacting with Latheon's shielded pool — deposits, automatic Merkle proof construction, and withdrawals, without needing to manually read `zeros()` from the contract or hand-build a Merkle path (which is exactly what the Latheon team had to do by hand before this existed).

> ⚠️ Testnets only; the proof helpers target the V3 pool on Ethereum Sepolia, which is pre-V7 and must not receive deposits. This SDK does not generate zero-knowledge proofs itself — that still requires `tools/zk-toolkit.html` (or your own snarkjs setup) with the circuit's compiled artifacts. What this SDK automates is everything *around* that: deposits, tree reconstruction, and submitting the proof once you have it.

## Install

```bash
npm install @latheon/sdk
```

(Not yet published to the npm registry — for now, copy the `src/` folder directly into your project, or install from the GitHub repo.)

## Quick start

> **Do not run this against the default pool.** It shows the original V3 flow; `SEPOLIA.pool` is the V3 pool, which is pre-V7 and forgeable. Kept as documentation of the V3 API only, see [Compatibility](#compatibility).

```js
const { ethers } = require("ethers");
const latheon = require("@latheon/sdk");

const provider = new ethers.JsonRpcProvider("YOUR_SEPOLIA_RPC_URL");
const signer = new ethers.Wallet("YOUR_PRIVATE_KEY", provider);

// 1. Deposit 100 LTH into the shielded pool
const { secret, commitment } = await latheon.deposit(signer);
console.log("Save this secret somewhere safe:", secret.toString());

// 2. Later — reconstruct everything needed for a withdrawal proof,
//    without touching zeros(), currentRootIndex(), or roots() by hand
const { pathElements, pathIndices, root } =
  await latheon.getProofInputsForCommitment(provider, latheon.SEPOLIA.pool, commitment);

// 3. Generate the actual zk-SNARK proof using these values as circuit
//    inputs (root, nullifierHash, secret, pathElements, pathIndices) —
//    via tools/zk-toolkit.html or your own snarkjs pipeline. This SDK
//    does not do this step; see "Why doesn't this generate proofs?" below.

// 4. Submit the withdrawal once you have a proof
await latheon.withdraw(signer, proof, [root, nullifierHash], recipientAddress);
```

## Why doesn't this generate proofs?

Proof generation needs the circuit's compiled `.wasm` and `.zkey` files, which are tens of megabytes — too large to bundle in an npm package by default, and specific to whichever trusted-setup session produced the currently-deployed verifier (see `DEPLOYMENT-CHECKLIST.en.md` for why that matters). `tools/zk-toolkit.html` already does this well, entirely in-browser, with no install required — this SDK is meant to sit alongside it, not replace it.

## API

### Constants

- `SEPOLIA` — `{ chainId, token, pool, verifier, faucet }` addresses
- `DENOMINATION` — fixed deposit size (100 LTH, as a `bigint`)
- `LEVELS` — Merkle tree depth (8)
- `TOKEN_ABI`, `POOL_ABI`, `FAUCET_ABI` — minimal ABIs for each contract

### Cryptographic helpers

- `computeCommitment(secret)` — `Poseidon(secret, 0)`, matching the circuit exactly
- `computeNullifierHash(secret)` — `Poseidon(secret, 1)`
- `computeZeroCascade()` — the "empty subtree" values, matching the on-chain contract's constructor logic

### Merkle tree

- `fetchDeposits(provider, poolAddress)` — every `Deposit` event, in leaf order
- `getProofInputsForCommitment(provider, poolAddress, commitment)` — the main convenience function: finds your leaf and returns `{ leafIndex, pathElements, pathIndices, root }`, ready to feed into the circuit

### Actions

- `deposit(signer, opts?)` — approve + deposit in one call, returns `{ secret, commitment, txHash }`
- `withdraw(signer, proof, publicSignals, recipient, poolAddress?)` — submit a completed proof
- `claimFromFaucet(signer, faucetAddress?)` — claim 500 test LTH
- `timeUntilNextClaim(provider, address, faucetAddress?)` — seconds until your next claim is allowed

## Testing

This SDK's cryptographic logic (Poseidon hashing, Merkle path construction) is verified against real, already-confirmed on-chain data from Sepolia — not just internally self-consistent. See `examples/self-test.js` and `examples/multi-leaf-test.js`.

```bash
npm install
node examples/self-test.js
node examples/multi-leaf-test.js
```

Both require no network access — they test the pure cryptographic logic only. Testing `deposit()`, `withdraw()`, and `fetchDeposits()` against the real network requires a funded Sepolia wallet and an RPC URL.

## License

MIT
