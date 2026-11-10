# Latheon V7 — pre-audit self-review with static analysis tools (6 November 2026)

This is an internal self-review, not an audit and not an independent review. It records what three free static analysers report on the current (V7) contracts and circuits, and how each item was triaged against the source by us. Testnet only; development keys from a single-party setup.

## Scope and setup
- Source: latheon-network/Latheon, main, commit `142d001`.
- Contracts: `LatheonShieldedPoolV7Native.sol` and `LatheonDistributionPoolV7Native.sol` (deployed on the Latheon test chain), `LatheonShieldedPoolV7.sol` and `LatheonDistributionPoolV7.sol` (ERC-20 variants, not deployed anywhere), `WithdrawVerifierV5.sol`, `DiscloseVerifier.sol`, `PoseidonT3.sol`.
- Circuits: `circuits/withdraw_v5.circom`, `circuits/disclose.circom` (circomlib 2.0.5).
- Tools: Slither 0.11.6; Aderyn 0.6.8; Circomspect 0.9.0. Compiler solc 0.8.24 (static Linux build, SHA-256 `fb03a29a…c30d5f`, matched against the official solc-bin list); OpenZeppelin Contracts 5.6.1 (same as in the repository).
- Run in a cloud sandbox on a copy of the source; nothing deployed or sent.

## Result in one paragraph
No tool finding survived triage as a vulnerability. All "High" items from Slither and Aderyn are known false-positive patterns (assembly `return` in snarkjs-generated verifiers and in the Poseidon library, intended payout to the proof-bound recipient, a constructor reading trusted pool parameters). Circomspect reports nothing for `disclose` and only expected notes and warnings for `withdraw_v5`. Several hardening and hygiene items are listed below; none changes what the deployed contracts do.

## Counts
| Tool | Target | High | Medium | Low | Info/notes |
|---|---|---|---|---|---|
| Slither | ShieldedPoolV7Native | 2 | 0 | 1 | 8 |
| Slither | DistributionPoolV7Native | 0 | 0 | 6 | 1 |
| Slither | ShieldedPoolV7 (ERC-20) | 1 | 0 | 3 | 9 |
| Slither | DistributionPoolV7 (ERC-20) | 0 | 0 | 7 | 3 |
| Slither | WithdrawVerifierV5 | 3 | 0 | 0 | 40 |
| Slither | DiscloseVerifier | 3 | 0 | 0 | 36 |
| Aderyn | all of the above | 4 groups | — | 10 groups | — |
| Circomspect | withdraw_v5 | — | — | 3 warnings | 10 notes |
| Circomspect | disclose | — | — | 0 | 0 |

## Triage of every High item
1. **Slither `incorrect-return` / Aderyn H-4 "Yul block contains return"** in `WithdrawVerifierV5`, `DiscloseVerifier` (lines 75/76, 91/92, 101/102, 186/193) and `PoseidonT3.sol:388`.
   False positive. The verifiers are snarkjs-generated: `verifyProof` is an external entry point whose assembly ends the call with the result on purpose. `PoseidonT3.hash` is a `public` library function, so pools call it externally (library call); its `return(0, 0x20)` ends only that call, not `deposit`. Deposits on the test chain emit `Deposit` events after hashing, which confirms the behaviour.
2. **Slither `arbitrary-send-eth`** in `LatheonShieldedPoolV7Native.withdraw` (payout to `recipient` and `relayer`).
   Intended. `recipient`, `relayer` and `fee` are public inputs of the withdraw_v5 proof (`pubSignals = [root, nullifierHash, recipient, relayer, fee]`); a caller cannot change them without a new valid proof. `fee <= DENOMINATION`, `fee == 0 || relayer != 0`, `recipient != 0` are checked first.
3. **Aderyn H-2 "state change after external call"** in pool `withdraw` (after `verifier.verifyProof`) and in both routers' constructors.
   Not exploitable. `verifyProof` is a `view` call to an immutable verifier. In `withdraw` the nullifier is marked spent before any value transfer (checks-effects-interactions), so re-entry finds the note spent. Constructor calls read `token()` and `DENOMINATION()` of the pools passed at deployment.
4. **Aderyn H-1 "contract locks Ether"** in `LatheonDistributionPoolV7Native`.
   False positive. `deposit` requires `msg.value == amount` and `split` decomposes `amount` exactly into denominations that divide each other, so every wei is forwarded to the pools in the same call. The router has no `receive`/`fallback`; it can only receive coin by force (self-destruct or block reward), which does not affect users.
5. **Aderyn H-3 "contract name reused"** (`IGroth16VerifierV5` declared in two files).
   No effect on our build (the test scripts compile each contract file with solc separately). Hygiene: move the interface to one shared file.

## Circomspect on withdraw_v5
- 3 warnings: `recipientSquare`, `relayerSquare`, `feeSquare` appear in only one constraint. Intended: the standard trick that puts the public inputs `recipient`, `relayer` and `fee` into at least one constraint so they are bound to the proof (otherwise the compiler could drop them and a proof would verify for any value). Nothing else should use these signals.
- 10 notes on field arithmetic and comparisons in `for` loop counters and in the squares above: loop bounds are compile-time constants (`levels = 20`), no runtime overflow.
- The path-selector constraint added in V7, `pathIndices[i] * (1 - pathIndices[i]) === 0` at every level, is present (line 40).
- `disclose`: no issues found.
- Limits: Circomspect is a pattern analyser. It does not prove that a circuit is fully constrained. The circuit-level checks that matter here were done separately (internal ZK review 29.10, regression suite test/regression-v7: selector on every level, recipient/relayer/fee binding, nullifier reuse, withdrawMany 2/16/17).

## Hardening and hygiene (no vulnerability; candidates for the next contract version)
- **ERC-20 variants** (`LatheonShieldedPoolV7`, `LatheonDistributionPoolV7`, not deployed): use `SafeERC20` and refuse fee-on-transfer or rebasing tokens (check the balance difference on deposit) before any ERC-20 deployment, for example a stablecoin pool. Today a token that returns no boolean would make calls revert (fail closed), and a fee-on-transfer token would break the pool's accounting.
- **Pragma**: `^0.8.24` and `>=0.7.0 <0.9.0` (verifiers). Pin the exact compiler version used for deployment for reproducible builds. Note (10 November 2026): the deployed V7 bytecode was compiled with solc 0.8.37 (`l2-eval-ci/testnet/latheon/build.js`, artifact `latheon-testnet.json`), while this self-review compiled the sources with 0.8.24; a rerun with 0.8.37 is still to be done.
- **Immutables**: `pools`, `denominations` (routers) and `zeros` (pools) are set once; as arrays they cannot be `immutable` directly, but could be constants or unrolled immutables to save gas. Gas only.
- **NatSpec**: `LatheonShieldedPoolV7Native` still describes itself as "V6" in the title (known, listed for the next contract version).
- **Router `withdrawMany`**: one failing note reverts the whole batch (all-or-nothing). Intended; worth stating in the docs and the SDK.
- **PUSH0** (Aderyn L-4): the Latheon test chain (Arbitrum Nitro) supports it; contracts are deployed and used. Relevant only for chains without Shanghai.

## Not covered by this self-review
- No formal verification or under-constraint search with dedicated tools (Picus, zkFuzz, Ecne); Circomspect does not replace them.
- No dynamic analysis (Echidna/Medusa fuzzing) in this pass; the repository has its own fuzz suite (test/fuzz-v7), still to be re-run on anvil.
- Front-end (demo, bridge), relayer, faucet and server are out of scope here (see the internal reviews of 27.10, 29.10 and 01.11).
- Trusted setup: single-party development ceremony; a public multi-party ceremony is required before real value.

## Reproduce
```
git clone https://github.com/latheon-network/Latheon && cd Latheon && git checkout 142d001
npm init -y && npm install @openzeppelin/contracts@5.6.1 circomlib@2.0.5
pip install slither-analyzer==0.11.6
slither contracts/LatheonShieldedPoolV7Native.sol --solc <path to solc 0.8.24> --solc-remaps "@openzeppelin/=node_modules/@openzeppelin/"
npm install -g @cyfrin/aderyn   # 0.6.8; foundry.toml with src = the V7 files and solc = the local 0.8.24 binary
cargo install --locked circomspect   # 0.9.0
mkdir -p lib && ln -s ../node_modules/circomlib/circuits lib/circomlib
circomspect -L lib -l INFO circuits/withdraw_v5.circom
```
