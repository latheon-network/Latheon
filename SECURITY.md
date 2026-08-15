# Security Policy

## Project status

Latheon is experimental software. The current Sepolia deployment is a research and development prototype and must not be treated as production financial infrastructure. It has not undergone a formal third-party security audit.

## Scope

Security-sensitive areas include:

- Smart contracts (`contracts/`)
- Zero-knowledge circuits (`circuits/`)
- Proof generation and verification tooling (`tools/`)
- Commitment and nullifier handling
- Withdrawal logic
- Deployment configuration

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

## Current known limitations

See [`STATUS.md`](./STATUS.md) §6 and [`THREAT-MODEL.md`](./THREAT-MODEL.md) for a full, honest account of current limitations, including:

- No formal third-party audit yet.
- Off-chain (owner-maintained) Merkle tree bookkeeping.
- Limited external security review to date.

## Testnet warning

The Latheon Sepolia deployment is experimental. Do not use real-world funds or assume production-level security guarantees.

## Security roadmap

1. Expanded automated tests and circuit test vectors.
2. Invariant and fuzz testing for contracts.
3. Independent code review.
4. Independent cryptographic review of the circuit and trusted setup.
5. Formal third-party security audit before mainnet consideration.
