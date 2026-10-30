# Security Policy

## Project status

Latheon is experimental software. All deployments (Ethereum Sepolia, Arbitrum Sepolia, Robinhood Chain Testnet) are research and development prototypes on testnets and must not be treated as production financial infrastructure. They have not undergone a formal third-party security audit.

## Scope

Security-sensitive areas include:

- Smart contracts (`contracts/`)
- Zero-knowledge circuits (`circuits/`) and the proving and verifying keys under `circuits/build/`
- Proof generation and verification tooling (`tools/`, `sdk/`)
- Commitment and nullifier handling
- Withdrawal logic, including the binding of proofs to the recipient
- Deployment configuration (`sdk/deployments.json`)

## Reporting a vulnerability

Please do **not** disclose security vulnerabilities through public GitHub issues.

**Security contact:** latheon.protocol@gmail.com

Please include:

- Affected component
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested mitigation, if available

## Responsible disclosure

We ask researchers to allow reasonable time for investigation and remediation before public disclosure. We will acknowledge valid reports and coordinate disclosure timing where appropriate.

## Past findings

- **Test-chain server: root from the bot's container, and the deployer key next to service-writable code; found in an internal review on 29 October 2026, fixed and deployed on 30 October.** The operator runner (root) wrote its answers into a folder the Telegram bot's container could write to and followed links placed there, so code running in that container could have become root on the server. Separately, the commands that take the deployer key ran code from the faucet and relayer folders, which those internet-facing services could write to. Fixed in `latheon-network/l2-eval-ci` (`f43dae0`): answers are written in a root-only folder and moved, links are never followed, the service code is mounted read-only, the deployer-key commands run from a fresh copy with fresh packages, and the ops wallet key lives outside the faucet's folder. No sign of exploitation; only testnet keys were at stake.
- **Relayer robustness (29 October 2026, fixed 30 October):** a lost or never-mined transaction could hang its queue, node errors counted against honest users, a lost answer hid the transaction hash, and the relayer still sent withdrawals from the pre-V7 pools (paying gas for anyone draining them). It now relays V7 only, times out every call and wait, signs before sending, and refuses a note already in flight.
- **Demo supply chain (27 October 2026, fixed 28 October):** the demo and the bridge page loaded their cryptography libraries unpinned from a third-party CDN and the circuit files from a branch. They now load pinned builds from the site itself, fetch circuits by commit with SHA-256 checks, and run under a strict Content-Security-Policy.
- **Withdrawal without a deposit (all circuits before V7); found in an internal review on 27 October 2026, fixed in V7.** In `MerkleTreeChecker` the left/right choice at each level of the Merkle path (`pathIndices`) was not constrained to 0 or 1, so a crafted proof could match a pool's current root without any deposit and withdraw. Reproduced locally with test tokens only. Fix: `circuits/withdraw_v5.circom` (V7 pools on the Latheon test chain); all older pools are kept only so existing notes can be withdrawn. Our demo no longer deposits into them; the contracts themselves have no pause, still accept deposits and stay forgeable, so nobody should deposit into them (they are marked `frozen` and `forgeable` in `deployments.json`). Details: `THREAT-MODEL.md` §8.0 and `docs/dev-ceremony-v5.md`.
- **Withdrawal recipient not bound to the proof (V3/V4); found internally, fixed in V5.** A pending withdrawal could be redirected by replaying its proof with a different recipient. Only testnet tokens were involved. Details and reproduction: [`docs/withdraw-recipient-binding.md`](./docs/withdraw-recipient-binding.md) and `test/v5-integration`.

## Current known limitations

See [`STATUS.md`](./STATUS.md) §7 and [`THREAT-MODEL.md`](./THREAT-MODEL.md) for a full, honest account of current limitations, including:

- No formal third-party audit yet; limited external security review.
- The proving and verifying keys are development keys from single-party setups ([`docs/dev-ceremony-v3.md`](./docs/dev-ceremony-v3.md)). A public multi-party ceremony is required before any real-value deployment.
- Anonymity sets are small: the pools hold mostly test deposits.
- Metadata (timing, gas usage) is publicly visible on-chain.
- The legacy V3/V4 pools remain deployed and have the flaw described above.

## Testnet warning

All Latheon deployments are experimental testnet deployments. Do not use real-world funds or assume production-level security guarantees.

## Security roadmap

1. Expanded automated tests and circuit test vectors (V5 integration tests with real proofs are in `test/v5-integration`).
2. Invariant and fuzz testing for contracts.
3. Independent code review.
4. Independent cryptographic review of the circuit and trusted setup.
5. Public multi-party trusted-setup ceremony, after the circuit is frozen.
6. Formal third-party security audit before mainnet consideration.
