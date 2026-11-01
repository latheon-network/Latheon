# Disclosure v2: user-chosen scope, many notes at once, where the funds went (design, draft)

**Status:** design only, nothing here is built. Testnet project, no audit. Builds on [`selective-disclosure-design.md`](./selective-disclosure-design.md) (v0.1, implemented as `circuits/disclose.circom`).

## 1. Why

Today a user proves one deposit to one auditor: `disclose` shows that the user knows the keys behind one commitment, bound to the auditor's one-time code. For the people who will actually ask for disclosure this is not enough:

- **Accountants, auditors, financial managers (first audience):** they need a report for a period, many notes, totals, and where each payment went. One proof per note, built by hand, does not scale.
- **Regulators (second audience):** they usually ask about one specific operation, often "where did these funds go". `disclose` cannot answer that: it does not connect a deposit to a withdrawal.

## 2. Principles (fixed)

1. **Only the user starts a disclosure.** No key, backdoor or special role in the protocol lets anyone see a user's notes without the user. This is what "verifiable on demand" means.
2. **Minimal by default.** The interface offers the narrowest scope first; anything wider is an explicit choice.
3. **The user chooses the scope:** which notes, which period, deposits only or also withdrawals.
4. **Bound to one auditor where the cryptography allows it.** A proof carries the auditor's one-time code, so it cannot be presented as a fresh answer to someone else's code. (Anyone holding a proof can still check it; binding prevents reuse, not reading.)
5. **Free to verify.** Checks run as `view` calls or locally in the auditor's browser; no gas.
6. **Portable to Latheon's own chain later.** Off-chain bundles and stateless verifier contracts, nothing tied to one deployment.

## 3. What the user can choose

| Scope | Answers | Layer |
|---|---|---|
| A. Selected notes | "these deposits are mine" | 1 |
| B. All notes of one or more master keys, or of a period | "these are all my deposits for Q4" | 1 |
| C. Where a withdrawn note went | "the payment to address R came from my deposit C" | 1b (keys of spent notes) / 2 (proof) |
| D. Totals only, without listing notes | "I deposited X and withdrew Y" | research (§7) |
| E. Standing view access for a period | "the auditor watches my notes this year" | 3, research |

## 4. Layer 1: batch disclosure, works with V7 today (no new circuit)

The demo builds one `disclose` proof per note automatically and packs them into one file.

**User side.** The user picks notes: by master key(s) (`latheon-master:…`; a master key covers all the notes of one router deposit, up to 32), by fixed-pool note, or "everything in this wallet's list for a period". The auditor's one-time code is entered once. The demo checks every note on chain (its `Deposit` event), builds the proofs (the `disclose` circuit is small: a fraction of a second each on a laptop, to be measured on named devices), and saves a bundle.

**Bundle (JSON, versioned):** chain ID, the auditor's code, and per note: pool, amount, commitment, deposit transaction and time, the `disclose` proof and tag. Optional per note: its status (`unspent` / `spent`, read from the pool's `nullifierHashes`). A summary: number of notes and total per pool and overall. Nothing secret is in the bundle.

**Auditor side.** The auditor tab loads the bundle and, for every entry, verifies the proof (verifier contract `view` call or snarkjs locally), checks that the tag matches their own code, and finds the `Deposit` event. It shows a table and totals and exports CSV for accounting.

**Limits of layer 1:** it proves ownership of deposits, not where the funds went (scope C), and the user must have the notes' keys: a period report is only as complete as the user's own list of master keys and notes. The demo keeps no reliable history today (browser storage can be lost), so a local export of the user's note list comes with this layer.

## 5. Layer 1b: where the funds went, for notes already withdrawn (no new circuit, with care)

Once a note is withdrawn, its nullifier is recorded in the pool and its `spendKey` can no longer spend anything. For such notes the user may hand the auditor the note's keys `(spendKey, viewKey)`. The auditor recomputes:

- `commitment = Poseidon(Poseidon(spendKey, viewKey), 0)`, found in a `Deposit` event;
- `nullifierHash = Poseidon(spendKey, 1)`, found in a `Withdrawal` event, which shows the recipient, the relayer and the fee.

That connects the deposit to its withdrawal and recipient today, on V7, with no ceremony.

**Costs, stated plainly:**
- Not bound to one auditor: the keys are a statement anyone can check, forever. Whoever holds them can show them to anyone.
- Whoever holds the keys can also build fresh `disclose` proofs for that note to others, i.e. "speak" for that deposit.
- Only for withdrawn notes. The demo must refuse to reveal keys of a note whose nullifier is not recorded on chain: for an unspent note the `spendKey` is the money.
- Each note's keys are derived from the master key with Poseidon (`sdk/distribution.js`, `deriveNoteKeys`); one note's keys reveal nothing about the master key or the other notes.

Fit: a company's own accountant or financial manager, who keeps the records anyway. Not the default for a regulator or anyone outside; for them layer 2.

## 6. Layer 2: new circuits (with the planned circuit revision)

Both join the next circuit revision already in `ROADMAP.md` (proof bound to chain and pool, explicit Poseidon domain tags), so there is one new trusted setup, not several.

**`disclose_withdrawal`**: proves that a withdrawal came from a deposit, bound to the auditor's code, without revealing keys.
- Public: `commitment`, `nullifierHash`, `auditorNonce`, `disclosureTag`.
- Private: `spendKey`, `viewKey`.
- Constraints: `commitment = Poseidon(Poseidon(spendKey, viewKey), 0)`, `nullifierHash = Poseidon(spendKey, 1)`, `disclosureTag = Poseidon(viewKey, auditorNonce)` (with the domain tags of the revision).
- The auditor finds the `Withdrawal` event with that `nullifierHash` and reads recipient, relayer and fee from it. No Merkle tree in the circuit: small.

**`disclose_batch` (N notes, e.g. 16)**: the same statements for N notes in one proof, so a period report of hundreds of notes is a handful of proofs. Optional, if layer 1's speed on real devices is not good enough.

Both get the existing test pattern: real proofs accepted, every altered public input refused, negative cases for unspent notes and wrong codes.

## 7. Research, not planned for build

- **Totals without listing notes (D):** proving "notes worth X, deposited in a period" without revealing which ones needs membership proofs and amounts inside one proof, and deposit times are not in the tree. Open.
- **Standing view access (E):** a key that lets an auditor find the user's notes and spends by themselves, but not spend. The current note format does not allow it (commitment and nullifier both need `spendKey`). It needs a new note format (a separate key for seeing spends, an encrypted record per deposit) and per-period keys, because a view key cannot be revoked. A candidate for Latheon's own chain, not for the current pools.
- **Regulator requests:** the same layer 1/2 tools, with the user answering a specific request. No protocol role for a regulator (principle 1). How this meets particular legal regimes is a question for lawyers, not settled here.

## 8. Order of work

1. This document; decisions in §9.
2. Layer 1 in the demo: note list export/import, batch `disclose` bundle, auditor tab that verifies bundles and exports CSV. Before changing the demo: `test/demo-e2e/router-e2e.js`, `test/distribution/wallet.js`, and the distribution-core block must stay identical to `sdk/distribution.js`; new browser tests for the bundle.
3. Layer 1b behind an explicit warning, withdrawn notes only (checked on chain).
4. Layer 2 circuits with the circuit revision, then their own tests and development ceremony.

## 9. Decisions

- Taken (Vladimir, 1 November 2026): the first audience is accountants, auditors and financial managers; regulators second but considered from the start. Disclosure is started only by the user; no regulator key.
- Open: whether layer 1b ships (it trades binding for an answer to "where did it go" today); bundle format details; whether `disclose_batch` is needed after measuring layer 1 on real devices.
