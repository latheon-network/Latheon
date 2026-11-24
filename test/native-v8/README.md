# V8 native-coin pool and router tests

Tests for `contracts/LatheonShieldedPoolV8Native.sol` and `contracts/LatheonDistributionPoolV8Native.sol` (with
`contracts/ILatheonV8.sol`) with **real Groth16 proofs** of `circuits/withdraw_v6.circom` on a local EVM (ganache,
chain id 60531373273). The circuit is built from source; the Groth16 keys and the Solidity verifier are **throwaway**,
made in the test from `circuits/ptau/pot14_final.ptau` and deleted at the end. Internal tests, not an audit.

```
cd test/native-v8 && npm install
CIRCOM=/path/to/circom-2.2.3 npm test      # about 15 minutes on 2 vCPUs
```

Exit code 0 means every check passed.

`DEV_KEYS=1 npm test` runs the same checks with the committed development keys and verifier instead (`circuits/build/withdraw_v6`, `contracts/WithdrawVerifierV6.sol`, `docs/dev-ceremony-v8.md`): the set that gets deployed. No circom needed then. Passed on 24 November 2026 (56 checks).

## What is checked

- **Compiler:** the V8 contracts compile with solc 0.8.39 (pinned in their pragma) without warnings.
- **Context and extData:** `ctx()` equals `keccak256(abi.encode("latheon.v8.ctx", chainid, pool)) mod p` and differs per
  pool; `extDataHash()` equals the reference formula. A proof with another recipient, relayer, fee or payment reference
  is refused ("Invalid proof"); a destination chain other than this one is refused ("Wrong destination chain").
- **One proof, one pool, one chain:** the same commitment deposited into two pools gives both the same root; the proof
  made for pool A is refused by pool B although B knows the root; with a proof made for each pool, each pays its own
  deposit once. A proof made for the same pool address on another chain is refused.
- **Deposits:** wrong amount, commitment 0, p and above p are refused; constructor refuses a zero verifier and a zero
  denomination.
- **Payouts:** a recipient that refuses the coin, one that burns all gas, and one that reverts with 200 KB of data make
  the withdrawal revert ("Native transfer failed"), the note stays unspent, and the failed attempt costs under 500,000
  gas (payout gas is limited and no return data is copied); a contract recipient doing ordinary work is paid; a recipient
  that re-enters `withdraw()` is paid once; plain transfers to the pool are refused.
- **Root history:** a proof made before 150 more deposits still withdraws (V7: refused after 100), and the empty tree's
  root is still known after 151 deposits: every root is kept for the pool's life.
- **Payout gas:** a contract recipient that needs about 160,000 gas is not paid at the initial 100,000 and its note stays
  unspent; only the guardian can raise the limit, through the timelock after its delay, never lower it and never above
  1,000,000; after it is raised to 250,000 the same proof pays that recipient; a pool without a guardian keeps 100,000.
- **Deposit pause:** the guardian is an OpenZeppelin `TimelockController` with a 1-hour delay; the pause cannot be
  executed earlier; once executed, deposits into the pool and through the router are refused and withdrawals still work;
  nobody else can pause; a pool deployed without a guardian can never be paused.
- **Router:** `split()` equals `sdk/distribution.js`; a deposit lands one note per pool and the router holds nothing; a
  commitment 0 through the router is refused; pools in the wrong order are refused; `withdrawMany` skips a note someone
  else already withdrew (NoteSkipped) and pays the rest with the right fees, refuses a batch where everything is spent
  ("Nothing to withdraw"), reverts entirely if one item's payment reference was changed, and pays a note named twice
  only once.
- **Gas** for router deposits of 1, 3, 4 and 32 notes, a pool deposit and withdrawal, and `withdrawMany` of 3 notes.
