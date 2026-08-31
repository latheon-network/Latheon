# @latheon/sdk

A JavaScript SDK for interacting with Latheon's shielded pool — deposits, automatic Merkle proof construction, and withdrawals, without needing to manually read `zeros()` from the contract or hand-build a Merkle path (which is exactly what the Latheon team had to do by hand before this existed).

> ⚠️ Sepolia testnet only. This SDK does not generate zero-knowledge proofs itself — that still requires `tools/zk-toolkit.html` (or your own snarkjs setup) with the circuit's compiled artifacts. What this SDK automates is everything *around* that: deposits, tree reconstruction, and submitting the proof once you have it.

## Install

```bash
npm install @latheon/sdk
```

(Not yet published to the npm registry — for now, copy the `src/` folder directly into your project, or install from the GitHub repo.)

## Quick start

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
