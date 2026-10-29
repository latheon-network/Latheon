# Mainnet readiness: conditions before any real value

**Status of this document:** a checklist written on 29 October 2026 from the repository (`STATUS.md`, `ROADMAP.md`, `THREAT-MODEL.md`, `SECURITY.md`, `docs/testnet.md`, `l2-eval-ci/testnet`). It is an internal planning document, **not an audit and not a statement that anything is secure**. It sets no dates: `ROADMAP.md` says no production launch date is set, and this checklist does not change that. Where `ROADMAP.md` records a decision (Arbitrum Orbit as the framework, LTH as the gas token, staged control of the chain), this document refers to it; everything `ROADMAP.md` lists as open stays open here.

**Rule:** no real funds (mainnet tokens, real stablecoins, value-bearing LTH) go into any Latheon contract, chain or bridge until every item marked **required** below is done. Today none of the required items is done.

Status values: **not started** · **partial** (what exists is named) · **done**.

## A. Code and cryptography

| # | Condition | Required | Status now | Done when |
|---|---|---|---|---|
| A1 | **External security audit of the contracts** (V7 pools native and ERC-20, router, verifiers, any pause/owner logic added later) | required | **not started.** Internal reviews only (27 and 29 October 2026); local integration tests with real proofs (`test/native-v7`, `test/distribution`, `test/demo-e2e`). | A report from an independent firm on a fixed commit, published, covering every contract that will hold value. |
| A2 | **Independent cryptographic review of the circuits** (`withdraw_v5`, `disclose`) and of the trusted-setup procedure | required | **not started.** The critical flaw fixed in V7 (`THREAT-MODEL.md` §8.0) was found internally; no external party has reviewed any circuit. `ROADMAP.md` NEXT lists it as external and funding-dependent. | A report from reviewers independent of the project on the frozen circuit (A3), published, with every finding resolved or explicitly accepted. |
| A3 | **Circuit freeze** | required | **not started.** `ROADMAP.md` plans a next pool version and possibly circuit changes; the post-quantum and proving-system questions are open (`THREAT-MODEL.md` §9.1). | A tagged commit of the circuits declared final for the first value-bearing release; any later change restarts A2 and A4. |
| A4 | **Public multi-party trusted-setup ceremony** after the freeze | required | **not started.** All keys come from single-party development setups (`docs/dev-ceremony-v3.md`, `-v4.md`, `-v5.md`), unusable for real funds. | A public phase-2 ceremony with many independent contributors, transcript and verification instructions published, final keys reproducibly checked; new verifiers and pools deployed from them. |
| A5 | **Fix the findings and re-audit** | required | **not started** (no external findings yet). Internal findings: §8.0 fixed in V7; §8.5 limits recorded, to be closed in the next pool version (`ROADMAP.md`). | Every finding of A1/A2 fixed or accepted in writing; the fixes re-reviewed by the same auditors; the deployed bytecode matches the audited commit. |
| A6 | **Close the V7 robustness limits** (`THREAT-MODEL.md` §8.5): commitment range check `0 < c < p`, payout with limited gas and no return-data copy, `withdrawMany` that skips an already-spent note | required | **partial.** Recorded and planned in `ROADMAP.md`; not implemented. The relayer only pays code-less recipients as a stop-gap. | Implemented in the next pool version, with tests; included in the A1 scope. |
| A7 | **Property / fuzz tests and invariants** for the contracts | required | **partial.** Integration tests with real proofs exist; randomised property tests for V7 are being added (`test/fuzz-v7`, branch work of 29 October 2026). | Invariants (pool balance = denomination × (deposits − withdrawals), no double spend, payout + fee = denomination, unknown roots refused) run in CI on every change. |
| A8 | **A contract-level way to stop deposits into a flawed pool** | decision needed | **not started.** Pre-V7 pools are frozen **in our interface only**; the contracts still accept deposits and stay forgeable (`THREAT-MODEL.md` §8.0). Today's pools deliberately have no owner. `ROADMAP.md` lists a deposit pause as an open question. | A decision recorded in `ROADMAP.md`; if a pause is chosen, it is held by the multisig + timelock (B1) or an emergency role limited to pausing deposits, never withdrawals. |
| A9 | **Retire the forgeable pools** (V3–V6 and the three external testnets) from the demo and `deployments.json` | required | **partial.** Marked `frozen` and `forgeable` in `deployments.json`; the demo blocks deposits; withdrawals still offered. | Removed from every interface once their test notes are withdrawn; documented as never to be used. |

## B. Control of the chain and keys

| # | Condition | Required | Status now | Done when |
|---|---|---|---|---|
| B1 | **Multisig with a timelock** over every upgrade and chain-owner power (rollup owner/UpgradeExecutor, ProxyAdmin, chain owner via `ArbOwner`, token owner) | required | **not started.** One development key holds all of these (`docs/testnet.md`, *Limits*; `docs/operator-rights.md`). Planned in `ROADMAP.md` VISION. | A Safe (or equivalent) with signers on separate devices and people owns everything; non-emergency actions pass a timelock longer than the withdrawal delay; addresses published; the deployer EOA holds no role. |
| B2 | **Chain ownership moved off the EOA** to the chain-side UpgradeExecutor | required | **not started** (`InitialChainOwner` is the deployer EOA, `l2-eval-ci/testnet/chain/chain.mjs` 132). | `ArbOwnerPublic.getAllChainOwners()` returns only the UpgradeExecutor controlled by B1. |
| B3 | **Separation of operational keys** (batch poster, validator, relayer, faucet, ops wallet) with limited balances, stored apart from each other | required | **partial.** Separate keys exist with small balances; all on one server, readable by root. | Each key in its own store (secrets manager or HSM), one service per key, balances capped and monitored, documented rotation procedure tested once. |
| B4 | **Independent validator(s)** and a meaningful bond | required | **not started.** One validator, ours, bond 0.0001 ETH (`chain.mjs` 134). | At least one validator run by a party independent of the project; base stake sized to the value at risk; the validator-whitelist expiry (`validatorAfkBlocks`) reviewed. |
| B5 | **Settlement, data availability and hosting decided** | required | **open** per `ROADMAP.md` (L3 on Arbitrum One or L2 on Ethereum; Rollup vs AnyTrust; self-hosting vs a provider). | Recorded in `ROADMAP.md`. |
| B6 | **No single server** | required | **not started.** One rented server runs node, explorer, faucet, relayer, bot and proxy. | Sequencer, validator, RPC and explorer on separate hosts; tested restore from backup; a second RPC node. |

## C. Operations

| # | Condition | Required | Status now | Done when |
|---|---|---|---|---|
| C1 | **Monitoring with alerts** | required | **partial.** External check every 15 minutes (`l2-eval-ci/.github/workflows/testnet-monitor.yml`, `testnet/monitor/check.sh`: RPC, explorer, faucet, relayer, ETH of batch poster and validator) with Telegram alerts; bot `/status` and dashboard `/ops/`; `./status.sh` on the server. Not covered: time since the last batch and the last confirmed assertion, assertions by addresses other than ours, owner/admin events on the rollup and ProxyAdmin, the pool invariant (balance = denomination × (deposits − withdrawals)), relayer error rate. | Alerts on all of the above, routed to at least two people, tested by a drill. |
| C2 | **Incident-response procedure** | required | **partial.** `docs/incident-response.md` (testnet procedure, 29 October 2026); not yet exercised. | Written, rehearsed at least once on the test chain, with roles, contacts and a public status channel. |
| C3 | **Responsible-disclosure channel** | required | **partial.** `SECURITY.md` with an e-mail address. | Published PGP key or equivalent, response-time commitment, and (when funded) a bug bounty. |
| C4 | **User-facing exit path documented** (slow withdrawal, force inclusion) | required | **partial.** `docs/bridge-withdrawal-procedure.md`; force inclusion not offered in the page. | Step-by-step instructions that work without our servers, tested. |

## D. Privacy and product

| # | Condition | Required | Status now | Done when |
|---|---|---|---|---|
| D1 | **Bridge privacy** (funding the chain from a linkable address) | decision needed | **open** (`THREAT-MODEL.md` §8.2, `docs/bridge-privacy-design.md`). `ROADMAP.md` records the direction (funds originating on the chain; a one-way bridge pool later) but nothing is built. | Either built and reviewed, or shown to users as an explicit caveat at launch (`ROADMAP.md`). |
| D2 | **Anonymity set** large enough to mean something | required for any privacy claim | **not started** (test deposits only; load tests are simulations, `docs/loadtest-2026-10-29-v7.md`). | Honest, measured statements only; the demo warns while sets are small. |
| D3 | **Launch stablecoin and compliance tooling** | decision needed | **open** per `ROADMAP.md`. | Recorded in `ROADMAP.md`. |
| D4 | **Legal review** of operating a privacy protocol and a chain in the relevant jurisdictions | required | **not started.** | Written advice obtained before any real-value launch. |

## How to use this list

Update a row only with something checkable: a commit, a report, an address, a test run. When an item changes, update `STATUS.md` and, if it is a decision, `ROADMAP.md`.
