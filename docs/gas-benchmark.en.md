# Latheon — Gas & Cost Benchmark

Compiled from real, already-confirmed transactions on Sepolia — not estimates or simulations. Every number can be independently verified against the actual transaction hash in the project's deployment history.

## Deployment (one-time cost)

| Contract | Gas | Notes |
|---|---|---|
| PoseidonT3 (hashing library) | 5,240,848 | The most expensive deploy — a large library of hashing constants |
| LatheonShieldedPoolV3 | 1,832,746 | |
| LatheonShieldedPoolV4 | 1,832,722 | Nearly identical to V3 — confirms the on-chain logic itself didn't change |
| Groth16Verifier (withdrawal) | ~394,000–654,000 | Varies with the specific circuit's complexity |
| LatheonFaucet | 654,691 | |

## User operations (what actually gets paid, per action)

| Operation | Gas | Source |
|---|---|---|
| **Approve** (LatheonToken) | 46,963–52,179 | Minor variance from cold/warm storage slots |
| **Deposit** (V3, on-chain Merkle tree) | 348,486 | Confirmed real transaction |
| **Withdraw** (V3) | 268,494 | Confirmed real transaction |
| **Withdraw** (V4, spend/view key split) | 268,494 | **Identical to V3** — splitting the secret into spendKey/viewKey adds zero extra cost at withdrawal; the entire difference lives in the circuit, not the contract |
| **Faucet claim** | 63,961 | Confirmed real transaction |

## The headline finding worth using in docs/pitch materials

**Structured selective disclosure (V4) does not cost the user anything extra at withdrawal** — 268,494 gas for both V3 and V4. Stronger privacy came at zero price increase for the end user.

## In dollar terms (approximate, using the actual gas price from these transactions, ~2.6 Gwei)

At the gas price seen in our own transactions (~2.64 Gwei) and an approximate ETH price:
- Withdraw (268,494 gas × 2.64 Gwei) ≈ 0.000709 ETH per transaction

**Important caveat:** this reflects Sepolia's gas price at the time these transactions were made. Ethereum mainnet gas prices can be substantially higher during periods of network congestion — this figure should not be used as a mainnet cost projection without recalculating against mainnet's actual gas price at deployment time.

---

## Proof generation time (off-chain, measured — not a gap anymore)

Measured directly, using the timing instrumentation added to `tools/zk-toolkit.html` (`performance.now()` around `snarkjs.groth16.prove()`), on the `withdraw_v2.circom` circuit (2,689 non-linear constraints, 18 private inputs — the more complex of our two withdrawal circuits, and the more representative one for real-world use):

**Proof generation: 0.44 seconds.**

This ran using a previously saved `.zkey` (no fresh trusted setup needed — see the "save your .zkey" tip in `DEPLOYMENT-CHECKLIST.en.md`), in-browser, on ordinary consumer hardware — not a specialized proving server. Combined with the on-chain costs above, the full user-facing wait between "click withdraw" and "proof ready to submit" is well under a second, before the wallet confirmation step.
