# Latheon Privacy & Threat Model

## 1. Purpose

This document describes the privacy goals, mechanics, assumptions, and limitations of the current Latheon shielded-pool prototype — what it protects, what remains publicly observable, and which assumptions are required for the privacy guarantee to hold. It intentionally treats privacy as a verifiable technical property, not a marketing claim.

## 2. How the shielded pool works today (🟢 LIVE)

1. **Deposit** — a user locks a fixed amount (100 LTH) into the pool. Fixed denominations exist specifically so that no deposit reveals more than any other by its size. The deposit's commitment is inserted into an **on-chain** incremental Merkle tree in the same transaction, using an on-chain Poseidon hash implementation — no operator or off-chain step is involved.
2. **Prove** — off-chain, the depositor (or anyone they've shared the secret with) generates a zero-knowledge proof (Groth16) asserting "I know a secret corresponding to a deposit in this pool" without stating which deposit.
3. **Verify** — the on-chain `Groth16Verifier` checks the proof against the pool contract's own known-root history. It never receives or sees the underlying secret.
4. **Withdraw** — on a valid proof, funds release to any address the prover specifies. That address does not need to be, and typically is not, the original depositor's address.
5. **Selective disclosure (manual, today)** — a depositor can later choose to share their secret directly with an auditor, regulator, or partner, who can independently recompute the commitment and confirm the deposit occurred, without the network ever having seen that secret. This is currently a manual, off-protocol action rather than a built-in on-chain mechanism — see §7.

## 3. What is protected

The proof system is designed to prevent an observer from linking a specific withdrawal to the specific deposit that funded it, within the anonymity set of deposits in the pool at that time.

## 4. What is NOT protected (public information)

Depending on deployment and usage, an observer of the public chain can see:

- That a deposit transaction occurred, its block, and its timestamp.
- That a withdrawal transaction occurred, its block, timestamp, and recipient address.
- Gas usage and other standard transaction metadata.
- The size of the current anonymity set (how many unspent deposits exist) — the Merkle tree and its history are public by nature, even though individual leaf-to-withdrawal links are not.

**Privacy of the deposit↔withdrawal link should not be read as full network-level anonymity.** An observer with enough resources correlating transaction timing across a small anonymity set could still form probabilistic guesses. This is a known, disclosed limitation, not a defect being hidden.

## 5. Threat model

We assume an observer capable of:

- Reading all public blockchain state and history.
- Monitoring contract events and mempool activity in real time.
- Correlating timing, gas price, and address reuse across transactions.

We do **not** currently assume protection against:

- Network-level deanonymization (e.g., IP-address correlation of who broadcast a transaction).
- An attacker who compromises the depositor's own device/secret storage.

## 6. Assumptions the current guarantee relies on

- Correct implementation of the Groth16 circuit (`circuits/withdraw.circom`) and its trusted setup.
- Correct implementation of the on-chain verifier and the on-chain Merkle tree / Poseidon hashing.
- The depositor keeps their secret confidential until they choose to disclose it.
- A sufficiently large and active anonymity set — privacy is weaker in a pool with very few deposits.

## 7. Resolved: on-chain Merkle bookkeeping

**Previous limitation (now closed):** earlier prototype versions relied on an off-chain-maintained Merkle root, published manually by the pool operator. This has been replaced — `LatheonShieldedPoolV3` maintains the tree entirely on-chain, updating it automatically with every deposit using the same Poseidon hash the zero-knowledge circuit relies on. No owner or operator action is required anywhere in the deposit → withdraw flow. See `STATUS.md` for the current deployed contract.

## 8. Remaining limitations

- A structured, protocol-level selective disclosure mechanism does not yet exist (today this is a manual off-protocol step, described in §2.5).
- No independent cryptographic review or formal security audit has been performed yet.
- Anonymity set size is currently limited by real testnet usage.

## 9. Future work

## Long-term cryptographic risk: post-quantum security (not urgent, but not zero)

Latheon's current cryptography — Groth16 proofs over elliptic curves, and Poseidon as the hash function underlying the Merkle tree, commitments, and nullifiers — is not post-quantum secure. Elliptic-curve-based systems are broken by Shor's algorithm on a sufficiently powerful quantum computer, and Poseidon, like other algebraic hash functions designed to be cheap to prove inside a circuit, has meaningfully less mature cryptanalysis behind it than a standard hash like SHA-256.

This is a long-term, industry-wide consideration, not something specific to Latheon and not an urgent one: practical, cryptographically-relevant quantum computers remain a matter of years to decades, not an imminent threat, and the overwhelming majority of production zero-knowledge systems deployed today share the same underlying assumptions we do. We're not carrying unusual risk relative to the rest of the field.

The direction the broader cryptography community is moving — mirroring the same shift already standardized for encryption and digital signatures (ML-KEM, SLH-DSA) — is toward lattice-based constructions, including lattice-based zkVMs and proving systems now emerging from serious research groups. This reinforces, rather than replaces, the open question already on our own roadmap regarding PLONK/Halo as an alternative to Groth16: a future migration path likely needs to consider lattice-based options as a third branch, not just a curve-based/hash-based choice. No decision or timeline is attached to this today — it's flagged here so it isn't quietly forgotten as the project matures.

- A structured, protocol-level selective disclosure mechanism.
- Larger, more active anonymity sets as usage grows.
- Independent cryptographic review and a formal security audit before any mainnet consideration.
- Investigation of alternative proving systems (PLONK/Halo) — see `STATUS.md` VISION section.

## 10. Reporting a privacy or security concern

See [`SECURITY.md`](./SECURITY.md). Do not disclose potential vulnerabilities in public GitHub issues.
