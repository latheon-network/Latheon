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
