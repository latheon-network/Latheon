# Withdrawal recipient binding: a vulnerability in V3/V4 pools, fixed in V5

**Status:** fixed in `LatheonShieldedPoolV5` + `circuits/withdraw_v3.circom`. V5 pools are not yet deployed at the time of writing; all existing V3/V4 pools are testnet-only and hold test tokens only.

## The issue

In `LatheonShieldedPoolV3` and `LatheonShieldedPoolV4`, `withdraw()` takes the `recipient` address as a plain parameter. The zero-knowledge proof does not cover it: the circuit's public inputs are only `(root, nullifierHash)`. A valid proof is therefore valid for *any* recipient.

**Attack:** anyone who sees a pending withdrawal transaction before it is included can copy the proof, submit it with their own address as `recipient` and a higher fee, and receive the funds. The original withdrawal then fails, because the note is already spent. The attacker does not need any secret key; the proof is all that is required, and it is public in the transaction.

This had been present since V3. It was not in the original threat model (which listed mempool monitoring only as an observer capability, not as a way to redirect funds).

## How it was found and confirmed

It was noticed while reading the contract source for an unrelated change (making the denomination a constructor parameter), and then reproduced rather than assumed. In a local EVM test, a proof generated for one recipient was accepted by a V4 pool when submitted from a different address naming itself as the recipient; the attacker received the full denomination.

## Real-world exposure

- **Ethereum:** pending transactions are visible in a public mempool; automated bots watch for exactly this pattern. The risk is realistic.
- **Arbitrum-stack chains (Arbitrum, Robinhood Chain):** as far as we know there is no public mempool and transactions are ordered by a sequencer, which narrows the window considerably. The sequencer itself still sees pending transactions, and we do not treat this as a guarantee.
- **Funds actually at risk so far:** none. Every affected pool is on a testnet and holds test tokens.

## The fix

1. `circuits/withdraw_v3.circom` adds `recipient` as a third public input. An extra constraint (`recipientSquare <== recipient * recipient`) keeps the signal from being optimised out of the circuit (same technique as Tornado Cash). Everything else in the circuit is unchanged; the Merkle checker is identical to v2.
2. `LatheonShieldedPoolV5.withdraw()` no longer accepts a `_pubSignals` array from the caller. It takes `root` and `nullifierHash` and **builds the third signal itself from the address it is about to pay**. A caller cannot supply a recipient signal that differs from the payee.
3. A new verifier (3 public inputs) and a new trusted-setup key pair are required, so V5 needs freshly deployed pools. Because `verifier` is `immutable` in the pool, existing pools cannot be patched in place.

## Verification of the fix

Local EVM tests (real compilation, real verifier, real proofs), across denominations 100 / 50 / 10 / 1 of an 18-decimal token and 100 of a 6-decimal token:

- The proof carries 3 public signals and the third equals the intended recipient.
- Replaying the same proof with a different recipient is rejected with `Invalid proof`; the attacker's balance and the pool balance are unchanged.
- The legitimate recipient then receives exactly the denomination and the pool is emptied.
- Re-spending a note is rejected (`Note already spent`); a zero recipient is rejected (`Zero recipient`); deploying with a zero denomination is rejected.

These are local tests, not testnet results, and they are not a substitute for an independent review.

## Migration

- Treat all V3/V4 pools as deprecated. Do not deposit anything you cannot afford to lose into them.
- The V5 `withdraw()` ABI differs from V4: `withdraw(pA, pB, pC, root, nullifierHash, recipient)`. Clients written for V4 need updating.
