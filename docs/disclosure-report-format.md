# Disclosure report file, version 1 (specification)

**Status:** describes the file the demo has written and read since 1 November 2026 (report and auditor tabs) and that the SDK builds and checks since 12 November 2026 (`sdk/src/report.js`). Testnet project, no audit; the keys behind the `disclose` circuit are development keys from a single-party setup. This document is the reference for anyone who wants to read or write the file without our code. Background and the layers still to come: [`disclosure-v2-design.md`](disclosure-v2-design.md).

The words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## 1. What the file is for

A user shows an accountant or auditor that a list of deposits in Latheon pools is theirs, and optionally where the withdrawn ones went. The auditor first gives the user a one-time code; every proof in the file is bound to that code. Only the user can make the file: there is no key, role or contract function that discloses a note without the user's keys.

The file is plain JSON. Whoever holds it can read it and check it. Binding to the code prevents presenting the file as an answer to a different auditor's code; it does not hide the content from anyone who gets a copy.

## 2. What a valid file proves, and what it does not

For every row that passes section 5:

- **Proven by the proof:** whoever made the row knew the two keys (`spendKey`, `viewKey`) behind the row's `commitment`, and made the proof for the auditor code in the file.
- **Proven by the chain, once the auditor has looked (steps 7 and 8):** that commitment is a deposit in the stated pool, made at the stated time; the pool's denomination is the amount. With keys in the row: the note was withdrawn, in which transaction and to which address.
- **Not proven:**
  - that the list is complete (the user chooses what to include);
  - who sent the deposit or who controls the recipient address;
  - `amount`, `token`, `version`, `leafIndex`, `depositTime`, `withdrawn` and `totals` as written in the file: they are the user's statements and are overridden by what the chain says;
  - `label`: the user's own text;
  - for a row without keys, whether the note was withdrawn at all (`withdrawn` is a claim);
  - that the user still holds the funds of an unspent note at any later time.

## 3. Cryptographic objects

All field elements are integers below the BN254 scalar field size `p = 21888242871839275222246405745257275088548364400416034343698204186575808495617`. `Poseidon2` is the two-input Poseidon hash over that field with the circomlib parameters (the same function as the on-chain `PoseidonT3`).

| Name | Definition |
|---|---|
| `commitment` | `Poseidon2(Poseidon2(spendKey, viewKey), 0)` |
| `nullifierHash` | `Poseidon2(spendKey, 1)` |
| `disclosureTag` | `Poseidon2(viewKey, auditorNonce)` |

The proof is a Groth16 proof over BN254 for the circuit `circuits/disclose.circom` with public signals, in this order: `[commitment, disclosureTag, auditorNonce]`. The circuit enforces the first and third definitions above for private `spendKey` and `viewKey`. The verification key is the one exported from `circuits/build/disclose/disclose_final.zkey` (SHA-256 of the files: `sdk/src/constants.js`, `CIRCUITS.disclose`); the same key is deployed as the `discloseVerifier` contract of each network in `sdk/deployments.json`.

## 4. The file

UTF-8 JSON, one object. Unknown members MUST be ignored by a reader. Integers that may exceed 2^53 are decimal strings.

| Member | Type | Meaning |
|---|---|---|
| `type` | string | MUST be `"latheon-disclosure-report"` |
| `version` | number | MUST be `1` |
| `created` | string | ISO 8601 time the file was made (a statement, not proven) |
| `network` | string | network name (informative) |
| `chainId` | number | chain the pools are on |
| `verifierAddress` | string | address of the `disclose` verifier contract on that chain (informative: a reader MUST use the verifier or key it trusts, not this field) |
| `auditorNonce` | string | the auditor's one-time code, decimal digits only |
| `items` | array | 1 to 500 rows, see below; a writer SHOULD sort them by `depositTime`, then `leafIndex` |
| `totals` | object | `{ notes, deposited, withdrawn }`: row count, text such as `"102 LTH"`, number of rows with `withdrawn: true` (informative) |

Each row of `items`:

| Member | Type | Meaning |
|---|---|---|
| `pool` | string | address of the pool the note is in |
| `version` | string | pool generation, for example `"v7"` (informative) |
| `token`, `amount` | string, number | the pool's token and denomination as the user states them |
| `commitment` | string | decimal; MUST equal public signal 0 of the proof |
| `leafIndex` | number | position of the deposit in the pool's tree (a statement) |
| `depositTime` | number | Unix time of the deposit (a statement) |
| `withdrawn` | boolean | the user's claim that the note has been withdrawn |
| `proof` | object | `{ pA: [2], pB: [2][2], pC: [2], pubSignals: [3] }`, the proof in the form the Solidity verifier takes: hex or decimal strings, with the two coordinates of each `pB` pair swapped relative to snarkjs' `pi_b` |
| `label` | string, optional | the user's text, at most 60 characters after cleaning (control characters and line breaks replaced by spaces) |
| `keys` | object, optional | `{ spendKey, viewKey }` as decimal strings |

**Rule for writers about `keys`.** The two keys of a note are the note: whoever has them can withdraw it. A writer MUST NOT put `keys` in a row unless the note has already been withdrawn, and SHOULD confirm that from two independent signals (a `Withdrawal` event with the note's `nullifierHash`, and the pool's own record for that `nullifierHash`) before writing them. The SDK's `buildReport` refuses `keys` for a row not marked withdrawn; the demo applies the two-signal rule.

## 5. Checking a file

Steps 1 to 6 need no network. A reader MUST perform them in this order and MUST treat a failed row as "not shown", never as an error that hides the other rows.

1. **Shape.** `type` and `version` as above; `items` has 1 to 500 rows; `auditorNonce` is decimal digits. Otherwise refuse the file.
2. **The code.** Let `N` be the code the auditor issued. If the reader does not know the issued code and uses `auditorNonce` from the file instead, it MUST say so in its result: the file then shows knowledge of the keys, not that it was made for this reader.
3. **Per row, the proof.** `proof` has the shape above with exactly three public signals. Verify it with the trusted verification key (locally, or by calling the trusted verifier contract's `verifyProof`).
4. **Per row, the statements.** Public signal 0 equals the row's `commitment`; public signal 2 equals `N`.
5. **Repeats.** If the same commitment appears in more than one row, only the first counts.
6. **Keys, when present.** Both are field elements and `Poseidon2(Poseidon2(spendKey, viewKey), 0)` equals the row's commitment; then compute `nullifierHash`. Keys that do not match MUST be reported; they do not undo a valid proof, but nothing may be concluded from them.

A row **counts** when steps 3 to 5 pass. The reader's total is the sum over rows that count.

Steps 7 and 8 read the chain and MUST use the reader's own source for it (its own node, or an RPC it trusts), not anything from the file:

7. **Per counted row, the deposit.** `pool` is a pool the reader recognises on `chainId`; a `Deposit` event of that pool carries the commitment. Take the time from the event and the amount and token from the pool, not from the row.
8. **Per row with matching keys, the withdrawal.** A `Withdrawal` event of that pool carries the `nullifierHash`; the event gives the recipient, the relayer and fee, and the time. A reader MAY also ask the pool's `nullifierHashes(nullifierHash)`; the two answers SHOULD agree, and a disagreement MUST be shown rather than resolved silently.

A reader SHOULD fetch all `Deposit` and `Withdrawal` events of a pool and search them locally, instead of asking its RPC endpoint about one commitment or one nullifier: such questions tell the endpoint which notes the reader is looking at (`THREAT-MODEL.md` §8.6).

A network failure in steps 7 or 8 is "no verdict" for that row, not "failed".

## 6. Security notes

- **Replay.** A proof is bound to one code. An auditor MUST issue a fresh random code per request and check step 4 against it. A code that is guessable or reused lets an old file answer a new request.
- **The file is not confidential.** It lists commitments, and with `keys` it links deposits to withdrawals for anyone who reads it. Send it over a channel you trust.
- **Keys of unspent notes** in a file are a loss of funds waiting to happen; see the writer rule in section 4. A reader that finds matching keys for a note that is not withdrawn on chain SHOULD warn its user to tell the sender at once.
- **Trusted verification key.** `verifierAddress` in the file is not a trust anchor. A file pointing at a verifier that accepts anything would otherwise pass.
- **Totals and labels** are user text. A reader MUST compute its own totals and MUST neutralise labels before putting them in a spreadsheet (a label starting with `=`, `+`, `-` or `@` is a formula in most of them).
- **Soundness rests on the circuit's setup.** The current keys come from a single-party development setup; whoever ran it could forge proofs. This is stated in `STATUS.md` and is the reason the file must not be relied on for real value yet.
- **Completeness is outside the format.** Nothing here shows that the user listed every note. Layer 2 of `disclosure-v2-design.md` (a proof that ties a withdrawal to its deposit) and scope-limited keys are the planned ways to narrow this; neither is built.

## 7. Versioning

`version` changes when a reader of the old version would draw a wrong conclusion from a new file. New optional members do not change it. A reader MUST refuse a version it does not know.

## 8. Reference implementation and test vectors

- **Writer and reader:** `sdk/src/report.js` (`buildReport`, `verifyReport` for steps 1 to 6, `checkReportOnChain` for steps 7 and 8); the demo's report and auditor tabs.
- **Command line:** `node tools/verify-report.js REPORT.json --code N [--chain]`.
- **Vectors** in `test/vectors/disclosure-report/`, checked by `sdk/test/report.js`:
  - `valid-v1.json`: three rows made by the SDK with the code `424242` and the fixed keys `(1001, 2001)`, `(1002, 2002)`, `(1003, 2003)`; one row carries keys and a label. The keys are public on purpose: never deposit to notes made from them. The rows name real pool addresses of the test chain but these commitments were never deposited, so the vector passes steps 1 to 6 and would fail step 7.
  - `demo-built-v1.json`: a file made by the demo in the browser test (`test/demo-e2e/disclosure-e2e.js` with `REPORT_OUT`), on a local chain, with keys of withdrawn notes. It shows that the two implementations agree on the format.
- The same test changes `valid-v1.json` in memory and expects: a wrong code (no row counts), a stated commitment that differs from the proven one, a swapped public signal, a changed proof point, a repeated row (counted once), keys that do not match, malformed keys, a malformed proof (a failed row, not an error), and malformed files (refused).
