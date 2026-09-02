# Latheon — Structured Selective Disclosure: Design Document (v0.1, draft)

**Status:** Design proposal, not yet implemented. Does not change any currently deployed contract. Written to scope the work described in `ROADMAP.md` ("design work on a protocol-level selective disclosure mechanism") and referenced in our grant applications.

## 1. Problem with the current mechanism

Today, per `THREAT-MODEL.md` §2.5, selective disclosure works like this: a depositor shares their `secret` directly with a third party (an auditor, a partner). That party can recompute the commitment and confirm the deposit happened.

**This has a real security flaw, not just an inelegance**: `secret` is the *only* thing required to withdraw funds from the pool. Sharing it for disclosure purposes also hands over full spending power. A depositor who wants to *prove* a payment to an auditor is currently forced to also give that auditor the ability to *steal* the payment. In practice this makes the current "disclosure" mechanism unsafe to actually use for anything beyond a fully-trusted counterparty — which defeats much of the point.

## 2. Design goals

1. A depositor can prove "I made this deposit" to a chosen third party.
2. That proof must **not** grant the recipient any ability to withdraw the funds.
3. The proof should be **bound to the recipient** — it must not be replayable to convince a *different* party of the same thing without the depositor's cooperation.
4. It should reuse as much of the existing, already-tested cryptographic infrastructure as possible (Poseidon hashing, Groth16 proving) rather than introducing new primitives.
5. It must not require changing the currently-deployed, working contracts — this is scoped as a **new version**, developed and tested alongside the current one, not a modification to it.

## 3. Proposed construction

### 3.1 Two secrets instead of one

Replace the single `secret` with a pair, both chosen randomly by the depositor and both known only to them initially:

- `spendKey` — required to withdraw. Never disclosed to anyone, ever, under this design.
- `viewKey` — required (together with `spendKey`) to prove disclosure. Never disclosed directly either — only *proof of knowledge* of it is shared, never the value itself.

### 3.2 Commitment and nullifier

```
commitment    = Poseidon(spendKey, viewKey, 0)   // both secrets bind the deposit
nullifierHash = Poseidon(spendKey, 1)             // unchanged in spirit — still spend-only
```

Depositing works exactly as today, except the depositor now generates and stores two values instead of one.

### 3.3 Withdrawal (modified circuit)

The withdrawal circuit's private inputs grow from `{secret, pathElements, pathIndices}` to `{spendKey, viewKey, pathElements, pathIndices}`. The circuit proves knowledge of both, that their combined commitment sits in the tree, and reveals `nullifierHash` as before. Public inputs (`root`, `nullifierHash`) are unchanged. This is a small, well-understood modification to a circuit we've already built, tested, and verified on-chain — see `circuits/withdraw.circom`.

### 3.4 Disclosure (new circuit)

A **separate**, smaller circuit — call it `disclose.circom` — lets a depositor generate a proof for a specific auditor, without touching the Merkle tree at all:

**Public inputs:**
- `commitment` — the specific deposit being disclosed. This is already public on-chain (visible in the `Deposit` event), so revealing which commitment is being discussed is not new information — the auditor typically already knows *which* transaction they're asking about (e.g. "the payment for invoice #42").
- `disclosureTag = Poseidon(viewKey, auditorNonce)` — binds this specific proof to a nonce the auditor generated and gave to the depositor as a challenge, preventing the proof from being replayed to convince a third party.

**Private inputs:**
- `spendKey`, `viewKey`

**Circuit logic:**
```
commitment === Poseidon(spendKey, viewKey, 0)
disclosureTag === Poseidon(viewKey, auditorNonce)
```

That's the entire circuit — deliberately minimal. No Merkle tree membership check is needed here, because the auditor already knows which commitment they're asking about (it's public on-chain) and can independently confirm it exists as a real, accepted deposit by checking the `Deposit` event log themselves — the disclosure proof's only job is to convince them *this specific depositor* is the one who knows the secret behind it, without revealing that secret.

### 3.5 The disclosure flow, end to end

1. Auditor generates a random `auditorNonce` and sends it to the depositor (e.g. "prove you made this payment — here's a one-time code: 8k2n...").
2. Depositor runs the `disclose` circuit locally with their `spendKey`, `viewKey`, the known `commitment`, and the auditor's nonce. Produces a small proof.
3. Depositor sends the proof (plus `commitment` and `disclosureTag`, both already meant to be shared) to the auditor.
4. Auditor verifies the proof against the public `Groth16Verifier` for this circuit (a `view` call, free, no wallet needed) — exactly like the pattern our `zk-toolkit.html` Step 5.5 already uses for a different purpose.
5. Auditor separately checks the on-chain `Deposit` event log to confirm `commitment` really was deposited — independent of trusting the depositor's word.

At no point does the auditor learn `spendKey` or `viewKey`, and the proof cannot be reused to convince anyone else (a different auditor's nonce produces a completely different, non-matching `disclosureTag`).

## 4. What this does and doesn't solve

**Solved:** the auditor gains cryptographic certainty of authorship without gaining spending power, and without the proof being transferable.

**Not solved by this design** (explicitly, so we don't oversell it later):
- **Amount disclosure isn't needed here** because every deposit is the same fixed denomination (100 LTH) — this design would need extending if Latheon ever supports variable amounts.
- **Timing metadata is still public** regardless of this mechanism — see `THREAT-MODEL.md` §4, unchanged by this proposal.
- **The auditor still learns which specific commitment is being discussed** — this design intentionally does not hide that, since in the disclosure use case the counterparty typically already knows or is told which transaction is in question. If fully anonymous "prove you made *some* deposit, don't say which" is ever needed, that's the tree-membership-based design discussed in earlier drafts, which trades off more complexity for stronger anonymity — a different design point, not this one.

## 5. Migration path

This is **not** a change to the currently deployed `LatheonShieldedPoolV3`. It would ship as a new pool version (working name: `LatheonShieldedPoolV4`) with its own token/verifier wiring, developed and tested the same way the current one was — starting with the circuit in zkrepl, then a browser toolkit test, then testnet deployment. The current pool keeps running unchanged throughout.

## 6. Next steps

1. [x] ~~Prototype `disclose.circom` in zkrepl.dev~~ — **done and verified**: compiles cleanly (729 non-linear constraints, notably lighter than `withdraw.circom`'s 2446, as expected since there's no Merkle tree membership check), and a test witness was generated successfully against independently-computed Poseidon values, confirming the circuit's logic matches the design in §3.4 exactly. See `circuits/disclose.circom`.
2. [x] ~~Prototype the modified `withdraw.circom` (two secrets instead of one)~~ — **done and verified**: compiles cleanly (2689 non-linear constraints — 243 more than the original `withdraw.circom`'s 2446, exactly matching the cost of one additional Poseidon(2) call, as expected), with public inputs: 2 and private inputs: 18 (spendKey, viewKey, 8 pathElements, 8 pathIndices), and a test witness generated successfully. See `circuits/withdraw_v2.circom`.
3. Only after both circuits are independently verified: design the V4 contract and repeat the deployment process documented in `DEPLOYMENT-CHECKLIST.en.md`.

This document intentionally stops at the design stage — see `ROADMAP.md` for when circuit prototyping is scheduled.
