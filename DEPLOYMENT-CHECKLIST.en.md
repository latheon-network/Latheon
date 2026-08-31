# Latheon — Deployment Checklist

Order of operations for redeploying the contract stack on Ethereum Sepolia. Built from real issues encountered during development — each step includes a "if this goes wrong" note, not just the action itself.

**Current live addresses** (for reference — do not reuse these when deploying new instances):

| Contract | Address |
|---|---|
| LatheonToken | `0x53F7f947D150D41FecAC4e3FBE04cdD1bf19F67D` |
| Groth16Verifier | `0x5E4D51352153513A9085e4e65B8541f393E4D470` |
| PoseidonT3 (library) | `0x33bA81C2f2ef705910Ee7022d8e2481eD83aDD1B` |
| LatheonShieldedPoolV3 | `0x9d047AdA4e33D28fBd86220f3F899A7Df7e3360C` |
| LatheonFaucet | `0xF4ab260E65D7c6bEE3D1192d2Cef677199B1f214` |

---

## Before you start

- [ ] Remix Environment = **"Browser Extension"** (MetaMask), not WalletConnect. WalletConnect has dropped mid-deployment multiple times during development — this is the single most common cause of confusing failures.
- [ ] Check your Sepolia ETH balance — budget at least **0.05 ETH** for a full stack redeploy.
- [ ] Compiler optimizer: **Enable optimization = on, runs = 200** (standard value). Do **not** set runs=1, and do **not** make the Poseidon library's `hash()` function `internal` — that combination was already tried, and it pushed the contract past the on-chain size limit, silently breaking the deployment.

---

## Do you actually need to redeploy the WHOLE stack?

Usually, no. The token almost never needs to change. Figure out what you're actually changing before starting from zero:

| What you're changing | What needs redeploying |
|---|---|
| Only the pool logic (`LatheonShieldedPoolV3.sol`) | PoseidonT3 (if not already deployed this session) + the pool itself |
| The ZK circuit or proving system | A new Verifier.sol (via zk-toolkit) + a new pool (pointing at the new verifier address) |
| The token | Everything else too, since every other contract stores the token's address |
| Only the faucet | Just the faucet |

---

## Step 1: LatheonToken

1. Deploy `LatheonToken.sol`, `initialOwner` = your address
2. **Copy the address immediately** — don't move on until it's saved somewhere
3. Sanity check: call `totalSupply()` — should read `100000000000000000000000000` (100M LTH)

---

## Step 2: Groth16Verifier — ⚠️ the most important note in this whole checklist

**If you are NOT changing the proving system itself** — do not generate a new Verifier.sol. Reuse the existing one (`0x5E4D...4D470`). Every fresh run of zk-toolkit produces **new cryptographic keys**, incompatible with any previously-generated proof.

**If you genuinely need a new verifier**:
1. Run zk-toolkit.html **start to finish in one uninterrupted session, without reloading the page** (steps: r1cs+wtns → ptau → setup → proof → Solidity export)
2. Deploy the resulting `Verifier.sol`
3. Copy the new address
4. **Remember**: any test proof for a withdrawal must now be generated from that same tool session — calldata from older sessions will not work against this verifier

---

## Step 3: PoseidonT3 (library)

1. Deploy `PoseidonT3.sol` — no constructor parameters
2. Confirm the `hash()` function is declared `public`, not `internal` (see the warning above)
3. Copy the address

**If you get "Cannot find compilation data of library"** — the library was deployed in a *different* Remix session than the one you're in now. Fix: redeploy it fresh, in this same session — an extra copy doesn't hurt anything.

---

## Step 4: LatheonShieldedPoolV3

1. Compile (Remix should auto-link the library you just deployed)
2. Deploy with:
   - `tokenAddress` = address from Step 1
   - `verifierAddress` = address from Step 2
3. **Verify immediately**, don't skip this: call `nextIndex()` — should read `0`. If you get a `missing revert data` error, the contract likely didn't actually deploy correctly (see the size-limit issue above) despite the transaction showing as "successful." Go back and check the optimizer settings.

---

## Step 5: LatheonFaucet

1. Deploy with `tokenAddress` = address from Step 1
2. Fund it: in `LatheonToken`, call `transfer(to=faucet_address, value=50000000000000000000000)` (50,000 LTH)
3. Sanity check: `claimsRemaining()` should read `100`

---

## Step 6: End-to-end verification (don't skip this)

1. Approve + deposit into the new pool with a small amount, just to confirm the token → pool path works
2. Read `roots(currentRootIndex())` — should be a nonzero number
3. If the verifier changed, generate a fresh proof against the new root/nullifier and test `withdraw`

---

## Step 7: Update every place that references the old addresses

A single redeploy touches at least **five** places if an address changed:

- [ ] Website, docs section (contract cards, all 3 languages)
- [ ] `STATUS.md` on GitHub
- [ ] `ROADMAP.md` / `THREAT-MODEL.md`, if they contain direct address references
- [ ] Investor deck, slide 4
- [ ] Grant application drafts — note that an already-submitted application can't be edited, only future ones

---

## Quick troubleshooting reference (from real experience)

| Symptom | Likely cause | Fix |
|---|---|---|
| `missing revert data` on a simple read | RPC/Infura is having issues, OR the contract didn't actually deploy correctly | Check directly via Etherscan/Blockscout; if the same error appears there too, wait it out or switch RPC |
| `Cannot find compilation data of library` | The library was deployed in a different session | Redeploy the library in the current session |
| `insufficient funds for intrinsic transaction cost` | Not enough ETH for gas | Top up via a faucet (Alchemy/Google Cloud/Chainstack) |
| Contract code size exceeds 24576 bytes | Optimizer is off or misconfigured | Enable optimization, runs=200, keep the library `public`, not `internal` |
| "Invalid proof" on withdraw | The proof and the verifier came from different zk-toolkit sessions | Generate a fresh proof in the same session as the current verifier |
