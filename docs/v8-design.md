# V8: one circuit and contract revision (design draft, 7 November 2026)

Status: being built. The final V8 circuits and the native-coin contracts exist since 24 November 2026 and are deployed on the test chain (not yet in the demo) (`circuits/withdraw_v6.circom`, `disclose_v2.circom`, `disclose_link.circom`, shared `latheon_v8.circom`; tests `test/circuits-v8`); contracts `LatheonShieldedPoolV8Native` and `LatheonDistributionPoolV8Native`, tests `test/native-v8`); development keys made (`docs/dev-ceremony-v8.md`); deployed on the test chain the same day. The questions in §11 are still open and still meant for an outside review; work did not wait for one because none is arranged. Decided on 8 November 2026 (§13): no association set in V8, a payment reference in every withdrawal, a deposit pause for the test chain held by a timelocked multisig. Testnet only; no audit; the V7 pools stay as they are.

## 1. Why one revision

Every change to a circuit means new proving keys, a new trusted setup, new pools and a move of users' notes. So the changes that are already known to be needed are collected into one revision, which is also the natural scope for an audit and for a public multi-party ceremony:

1. Bind every proof to its chain and pool (internal review of 29 October 2026; `ROADMAP.md`).
2. Explicit domain separation for Poseidon (same review).
3. A proof that links a deposit to its nullifier for one auditor (`disclose_withdrawal` in `docs/disclosure-v2-design.md` §6). It is needed for two things the current tools cannot do: a payment receipt ("this deposit paid that withdrawal") and proof of reserves ("these notes are still unspent at block N"; see §5).
4. The contract items of the internal reviews (`THREAT-MODEL.md` §8.5, `docs/self-review-2026-11-06.md`).
5. A decision on an optional association-set root (§6): decided, not in V8.

What does not change: Groth16 on BN254, Poseidon, tree depth 20, fixed denominations with the router, the relayer model, the `spendKey` / `viewKey` split and master keys, user-started disclosure only (no regulator key). Everything must also work unchanged on Latheon's own chain later (the context in §3 includes the chain id for that reason).

Naming: pools and router V8; circuits `withdraw_v6` and `disclose_link`. V7 pools stay open for withdrawals.

## 2. Measured cost of the options

Prototype circuits in `circuits/drafts/v8/` (not the final circuits). circom 2.2.3, circomlib 2.0.5, snarkjs 0.7.6, Node 22; timing on a 2-vCPU cloud machine (Intel Xeon 2.30 GHz) with throwaway keys from `pot14_final.ptau`, median of 3 proofs after a warm-up. Browser and phone times are not measured.

| Circuit | Variant | R1CS constraints | Proof time |
|---|---|---|---|
| `withdraw_v5` (V7, today) | — | 11,954 | 1.09 s |
| `withdraw_v6` draft a | tags on commitment and nullifier, context, extData hash; tree nodes untagged | 11,613 | 1.02 s |
| `withdraw_v6` draft b | as a, tree nodes tagged (3-input Poseidon) | 13,373 | 1.06 s |
| `withdraw_v6` draft c | as a, plus optional association-set tree | 22,015 | not measured (needs a 2^15 ptau) |
| `withdraw_v6` draft d | as b, plus optional association-set tree | 25,535 | not measured (needs a 2^15 ptau) |
| `disclose` (today) | — | 1,551 | not measured |
| `disclose_link` draft | commitment ↔ nullifier, context, auditor code | 1,815 | 0.25 s |

Final circuits (24 November 2026, `test/circuits-v8`; same toolchain; a 2-vCPU cloud machine, Intel Xeon 2.10 GHz; throwaway keys; median of 3 proofs after a warm-up):

| Circuit | R1CS constraints | Public inputs | Proof time |
|---|---|---|---|
| `withdraw_v6` | 11,611 (5,449 non-linear) | 4: root, nullifierHash, ctx, extDataHash | 1.18 s |
| `disclose_v2` | 1,210 | 3: commitment, disclosureTag, auditorNonce | 0.22 s |
| `disclose_link` | 1,815 | 5: commitment, nullifierHash, ctx, auditorNonce, disclosureTag | 0.24 s |

Draft a is slightly smaller than today because the commitment becomes one 3-input hash instead of two 2-input hashes. Tagging the tree nodes costs about 15 % more constraints in the circuit, and on chain every insert would use a 3-input Poseidon (20 per deposit); that gas is not measured yet. An association-set tree roughly doubles the circuit.

## 3. Binding a proof to its chain and pool

Today a `withdraw_v5` proof fits any V7 pool that knows the same root. The recipient is bound, so a replay gives an attacker nothing today, but with several chains (and a bridge) a proof should mean "this pool on this chain".

Proposal:
- Public input `ctx`. The contract computes it, it is never supplied by the caller: `ctx = keccak256(abi.encode("latheon.v8.ctx", block.chainid, address(this))) mod p`, cached in the constructor and recomputed if `block.chainid` changes (a fork). Keccak keeps it cheap on chain; inside the circuit `ctx` is just an input.
- The nullifier includes it: `nullifierHash = Poseidon(TAG_NULL, spendKey, ctx)`. A note's nullifier then differs between pools, so the same commitment deposited by mistake in two pools no longer shares one nullifier (`THREAT-MODEL.md` §8.5, "one spendKey, one nullifier"), and nullifiers of different chains cannot be compared.
- Alternative kept open: `ctx` only as a public input, nullifier unchanged. Simpler, but keeps the shared-nullifier property.

## 4. Domain tags

Today commitment (`Poseidon(Poseidon(s, v), 0)`), nullifier (`Poseidon(s, 1)`) and tree nodes (`Poseidon(l, r)`) all use the same 2-input Poseidon, separated only by the constants 0 and 1. No collision is known to be exploitable, but the separation is implicit.

Proposal: a 3-input Poseidon with a distinct first input per use: `TAG_COMMIT` (commitment `Poseidon(TAG_COMMIT, spendKey, viewKey)`), `TAG_NULL`, `TAG_DISC` (auditor tag `Poseidon(TAG_DISC, viewKey, auditorNonce)`), and possibly `TAG_NODE` for the tree. The draft uses 1–5; final values could be derived from a string (for example `keccak("latheon.v8.commit") mod p`). Final (24 November 2026): each tag is `keccak256(string) mod p` for the strings `latheon.v8.commit`, `latheon.v8.null` and `latheon.v8.disc`; the context is computed by the contract (§3) and needs no tag in the circuit.

Open: tag the tree nodes too (draft b), or leave the tree as standard `Poseidon(l, r)` (draft a), where leaves are already separated because a leaf is always a tagged commitment. Draft a keeps the on-chain tree and existing tooling unchanged; draft b is the cleaner separation at about 15 % more constraints and more gas per deposit.

## 5. `disclose_link`: receipts and reserves

Added 24 November 2026: the plain disclosure ("this deposit is mine", layer 1 of the report today) also needs a V8 version, because the commitment format changes. `disclose_link` cannot replace it: it reveals the note's nullifier, so the auditor would recognise the withdrawal and its recipient later. So V8 has two disclosure circuits: `disclose_v2` (commitment and auditor code only, no nullifier; the default) and `disclose_link` (adds the nullifier, for receipts and reserves). §9 is corrected accordingly.


One small circuit (1,815 constraints, 0.25 s) proves, for one auditor's code: "I know `spendKey`, `viewKey` such that this commitment and this nullifier belong to the same note in this pool."
- Public: `commitment`, `nullifierHash`, `ctx`, `auditorNonce`, `disclosureTag`. Private: `spendKey`, `viewKey`.
- No Merkle path: the auditor reads the `Deposit` event for the commitment and the `Withdrawal` event (or its absence) for the nullifier.

What it gives:
- **Receipt:** "deposit D paid withdrawal W" without handing over keys (today, layer 1b hands over the keys of withdrawn notes). Bound to one auditor's code, so it cannot be shown to someone else as theirs.
- **Reserves:** "these notes are unspent at block N": the auditor checks that no `Withdrawal` event with that nullifier exists up to block N (logs are always available, unlike old state). Today this cannot be checked at all: without a proven link a user could state a nullifier that was never used.
- Cost to state plainly: once an auditor knows the nullifier of an unspent note, they will recognise its withdrawal later. That is the price of a reserves proof.

**Payment reference (decided: yes, always present):** a `reference` field in the withdrawal's extData (a salted hash of an invoice id, chosen by the payer, emitted in the `Withdrawal` event). With `disclose_link` the payer can then show "invoice N was paid by this withdrawal from my deposit", and the reference was fixed at payment time, not written afterwards. Only the hash is public; the payer gives the invoice id and salt to the auditor. The field is filled in every withdrawal (a random value when there is no invoice), so a withdrawal with a reference does not stand out, and the wallet must use a fresh random salt per invoice, or the id could be guessed from the hash.

## 6. Optional association-set root (decision needed)

A second Merkle proof: the commitment is also in an association set chosen by the user (`aspRoot` public; `aspRoot = 0` means none). It lets a user prove "my deposit is in this set" at withdrawal, the model of Privacy Pools. It fits Latheon's position that screening is optional and chosen by the user, not done by the relayer before execution.

Costs: about twice the constraints (22,015 or 25,535), a larger ptau (2^15), roughly twice the proving time (estimate), and who runs a set is an open question. Benefit of deciding now: adding it later means another circuit, ceremony and pool generation.

Options: (A) include now, optional per withdrawal; (B) leave out of V8 and decide on Latheon's own chain. **Decided: B.** V8 stays at about the size of today's circuit; for the first users (accountants, payouts) receipts and reserves through `disclose_link` matter more, and an association set is of no use until someone runs one.

## 7. Withdrawal public inputs: one extData hash

Today: `root, nullifierHash, recipient, relayer, fee`. Proposal: `root, nullifierHash, ctx, extDataHash` (+ `aspRoot` if §6 A), where `extDataHash = keccak256(abi.encode(recipient, relayer, fee, reference)) mod p` is computed by the contract from the call's arguments. The binding stays the same (a different recipient, relayer, fee or reference gives a different hash and the proof fails), new fields can be added later without a circuit change, and there is one public input less. This is the approach of Tornado Nova; the contract must compute the hash itself from the arguments it then uses.

Decided 12 November 2026: `extData` also carries `destChainId`, so `extDataHash = keccak256(abi.encode(recipient, relayer, fee, reference, destChainId)) mod p`. In V8 the pool accepts only `destChainId == block.chainid` (a withdrawal on this chain) and reverts otherwise. The field costs nothing in the circuit, which sees only the hash. Its purpose is the pool contract: a later withdrawal that pays out on another chain would otherwise need new pools, and new pools start with an empty anonymity set. Nothing that uses another value is designed or promised (`docs/bridge-privacy-design.md`).

## 8. Contract items for the same version

From `THREAT-MODEL.md` §8.5 and `docs/self-review-2026-11-06.md`:
- `deposit`: require `0 < commitment < p`.
- Payout with limited gas and without copying return data (a contract recipient cannot make a withdrawal expensive); our relayer's no-code rule can then be relaxed.
- `withdrawMany`: skip a note that someone else already withdrew instead of reverting the whole batch, and report which notes were paid.
- ERC-20 variants: `SafeERC20`, refuse fee-on-transfer and rebasing tokens (balance difference on deposit), before any ERC-20 pool.
- Pin the compiler: solc 0.8.38 or later (0.8.37, used for V7, has the low-severity optimizer bug SOL-2026-7, see the self-review addendum), the same version in the pragma, the build script and the explorer verification; one shared verifier interface file, correct NatSpec titles.
- Root history (proposal of 11 November 2026, not decided, cost to be measured): V7 keeps the last 100 roots in a ring and `isKnownRoot` walks it, so a proof is valid for the next 99 deposits into its pool. Replace the walk with one lookup (root → its sequence number; known while `current - seq < HISTORY`) and make `HISTORY` much larger. Reason: a withdrawal whose proof is made now and sent later (below) must not go stale in a busy pool, and today's retry (prove again) needs the user's keys online. Cost to measure: one new storage slot per deposit instead of an overwritten one.
- Delayed withdrawals through the relayer (built on 11 November 2026 in the relayer, the SDK and the demo; no circuit change): the user hands the finished proof to the relayer with a window ("send at a random moment within N hours"); the relayer cannot change recipient, relayer or fee, because the proof binds them, so the trust is in liveness and in the relayer not telling anyone when the proof arrived. It separates the time the user was online from the time of the withdrawal, the cheapest defence against timing correlation in a small anonymity set. Limits to state openly: the relayer sees the arrival time and IP address (`THREAT-MODEL.md` §8.6); with V7's 100-root history a held proof goes stale after 99 deposits into that pool, hence the item above.
- Stealth addresses, if added later: an ERC-5564 announcement publishes an ephemeral secp256k1 key, which a quantum computer could later use to link payments to a recipient. Either use a post-quantum key encapsulation (ML-KEM) for that step or state the loss in `THREAT-MODEL.md` (see §11, question 6).
- Deposit pause (decided for the test chain): deposits only, never withdrawals; held by a multisig with a time delay, not by one key. Before any chain with real value this is a question for a lawyer (an operator with a lever), and the alternative without any key (deposits close by themselves at a date fixed at deployment) stays on the table.

### 8a. How the V8 native contracts implement §8 (24 November 2026)

- `deposit` refuses a commitment outside 0 < c < p ("Commitment out of range").
- Payouts: a call with at most `payoutGas` gas (100,000 at deployment) that copies no return data. Measured: a recipient that burns all gas or reverts with 200 KB of data makes the attempt cost under 500,000 gas, and the note stays unspent. 100,000 is enough for ordinary contract wallets; ordinary addresses spend no gas on receipt. A recipient that needs more is not paid, the note stays unspent and can be withdrawn to another address. Decided 24 November 2026 (Vladimir): the limit can be raised later, so the guardian (the timelock) may raise `payoutGas`, only upwards and at most to 1,000,000; it can never lower it, so this lever cannot block withdrawals.
- `withdrawMany` skips a spent note (event `NoteSkipped`), returns how many notes were paid, and reverts only if none could be paid ("Nothing to withdraw") or something else fails.
- Compiler pinned: `pragma solidity 0.8.39` in all V8 files; the shared interface is `contracts/ILatheonV8.sol`. In Solidity the payment reference is called `paymentRef` (`reference` is a reserved word).
- Root history (decided 24 November 2026, Vladimir): every root the pool ever had stays known for the pool's whole life (`knownRoots[root]`, one lookup), so a proof made now and sent later never goes stale, whatever the traffic. An old root only proves membership in the tree as it was then; the nullifier still stops a second withdrawal, and the demo and SDK always prove against the newest root. Measured on the local chain: a 32-note router deposit 22,275,427 gas against 21,850,278 for V6/V7 (+1.9%, one new storage slot per deposit); a one-note withdrawal 306,417 against 310,789.
- Deposit pause and payout gas: `guardian` is set at deployment and is meant to be a timelock controlled by a multisig; tested with OpenZeppelin `TimelockController` (1-hour delay). It can pause deposits and raise `payoutGas`; nothing else. `guardian = address(0)` means neither can ever happen. Withdrawals have no pause.
- `ctx()` is computed on every call from `block.chainid` and the pool's address, not stored at deployment.
- `extData.destChainId` must equal `block.chainid` ("Wrong destination chain").

## 9. Migration

- New pools V8 and a router V8; V7 stays for withdrawals only (frozen for deposits in the interface).
- New note string prefix (for example `latheon-v8:`); master keys stay (derivation unchanged; notes found per pool).
- Demo, SDK, relayer, payout files and disclosure reports learn V8 next to V7. The disclosure report keeps layer 1 and 1b for V7 notes; for V8 notes it uses `disclose_v2` for layer 1 and `disclose_link` where a receipt or reserves are asked for (corrected 24 November 2026; the draft said `disclose_link` for V8 notes, which would have revealed every disclosed note's nullifier).
- Requirement (decided 14 November 2026): a V7 master key and V7 notes stay usable after V8 is out. The same master key finds the user's V7 notes and V8 notes; nothing the user saved for V7 becomes worthless.
- Demo "Move to V8" (planned with V8): withdraw V7 notes and deposit the same amounts into V8 from the same master key in one flow, through the relayer by default. A move is an ordinary withdrawal followed by an ordinary deposit, so it is public that some V7 note left and some V8 deposit arrived; with delayed sending the two are not linked by time. It cannot be done for the user without their keys, so there is no automatic transfer.

## 10. Tests and review before any deployment

- The existing pattern for every circuit: real proofs accepted; every public input altered refused.
- New: a proof for pool A refused by pool B and by the same pool on another chain id; nullifiers differ across pools; `extDataHash` mismatch refused; `disclose_link` with a wrong nullifier, commitment, context or code refused; for §6, a proof with a non-member under a non-zero `aspRoot` refused.
- Under-constraint tools beyond Circomspect (Picus, zkFuzz or Ecne, as they install), regression suite like `test/regression-v7`. Done for the circuits on 24 November 2026: `test/circuits-v8` (44 checks: real proofs, every public input altered, other pool and other chain refused, every extData field changed, false statements refused by the witness generator, and the path-selector bit check shown at r1cs level against a copy of the circuit without it); Circomspect 0.9.0 reports no issue for `disclose_v2` and `disclose_link` and one expected warning for `withdraw_v6` (`extDataHashSquare` is used once by design, as the squares in `withdraw_v5`). Picus, zkFuzz and Ecne not run yet.
- Development ceremony for the test chain as before; a public multi-party ceremony before any real value.
- Measurements on named devices: browser and phone proof times for the chosen variant; deposit and withdrawal gas.

## 11. Open questions

For an outside review (no reviewer is arranged yet: the questions went to Least Authority on 6 November 2026, whose pro bono programme had ended in September 2025; questions 1–3 match §3, §5 and the ceremony):
1. `ctx` in the nullifier or only as a public input?
2. Tree nodes tagged or not; tag values from strings or small constants?
3. Is `disclose_link` without a Merkle path sound, given that the auditor checks the events?
4. `extDataHash` reduced mod p: any concern with keccak output above p?
5. What makes a phase-2 ceremony credible for a project of one developer?

Added 11 November 2026 (not yet sent to a reviewer):
6. Quantum adversary and past privacy. Our reading, to be confirmed or refuted: a quantum computer breaks the soundness of Groth16 over BN254 (a forged proof could drain a pool), but not the privacy of withdrawals already made, because nothing encrypted under an elliptic-curve key is ever published: a note's commitment and nullifier hash are Poseidon hashes of keys derived from a random master key, and a Groth16 proof made with a well-formed proving key reveals nothing about its witness regardless of computing power. Is that correct, and does it survive the V8 changes (`ctx` in the nullifier, `disclose_link`, the payment reference)? If it holds, V8 should keep it on purpose: no note encryption or key exchange on elliptic curves in the protocol (see §8, stealth addresses).

Decided by Vladimir on 8 November 2026: see §13.

## 12. Order of work

1. Answers to §11 from the outside review; this document updated.
2. Final circuits and their tests; constraint and time measurements; under-constraint tools. — done 24 November 2026 (except the further under-constraint tools).
3. Contracts V8 and their tests; gas on a local chain. — native-coin pool and router done 24 November 2026 (`contracts/LatheonShieldedPoolV8Native.sol`, `LatheonDistributionPoolV8Native.sol`, `ILatheonV8.sol`; `test/native-v8`, 56 checks with real proofs). ERC-20 variants not written (not needed on the test chain; the ERC-20 items of §8 stay open for them).
4. Development ceremony; deployment on the test chain; SDK, demo, relayer; live runs recorded in `STATUS.md`. — development keys made and deployed on the test chain 24 November 2026, smoke test with real proofs passed (`STATUS.md` §4, addresses in `sdk/deployments-v8.json`); SDK, demo and relayer next.

## 12a. Ideas after V8 (not in this revision)

- Payment names (24 November 2026, idea only): a name a payer can send to, so that the payment lands in a shielded pool for the named person instead of at a public address. Not possible with the V8 note format: whoever creates a note knows its spendKey, so a payer who created a note for someone else could spend it back. Paying another person needs a note bound to the recipient's public key that only the recipient's private key can spend (the model of Zcash and Railgun): a new circuit and note format, so a generation after V8. It also needs encrypted delivery of the note to the recipient, which is exactly the step where §8 (stealth addresses) and §11 question 6 apply. A plain public name registry is not planned: it would permanently link a label to an address.
- Pool capacity at scale (24 November 2026, open): each pool holds 1,048,576 deposits (20 levels); the 1-LTH pool fills first because the router puts most notes there. A full pool refuses deposits and keeps paying withdrawals. For a production chain with many users this needs a decision: a deeper tree (each level adds about 550 constraints to the withdrawal circuit) or new pools when one fills.
- Kohaku plugin interface (Ethereum Foundation wallet privacy framework; shield, unshield, balance): an adapter in the SDK after V8, decided 23 November 2026.

## 13. Decisions (8 November 2026)

1. Association-set root: not in V8 (§6, option B); decided again for Latheon's own chain.
2. Payment reference in extData: yes, filled in every withdrawal, random when unused (§5, §7).
3. Deposit pause: for the test chain, deposits only, held by a timelocked multisig; legal question before any real value (§8).
4. Unless the outside review advises otherwise: `ctx` is folded into the nullifier (§3) and tree nodes stay untagged (§4, draft a).
5. (12 November 2026) `destChainId` in extData, fixed to this chain in V8 (§7).
