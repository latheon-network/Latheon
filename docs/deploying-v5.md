# Deploying V5 pools

A checklist distilled from the first real deployments (three networks, 16 pools). It complements
`DEPLOYMENT-CHECKLIST.en.md`, which describes the V3 stack.

## What you need

- `contracts/PoseidonT3.sol`, `contracts/WithdrawVerifierV3.sol`, `contracts/LatheonShieldedPoolV5.sol`, and an ERC-20 token.
- The verifier **must come from the same `.zkey`** as the circuit files the clients use
  (`circuits/build/withdraw_v3/withdraw_v3_final.zkey`). A verifier from another setup rejects every proof.

## Order on each network

1. **PoseidonT3.** Deploy it.
2. **WithdrawVerifierV3.** In Remix the contract is named `Groth16Verifier` (so are other verifiers in this repository):
   check the file name under the contract selector.
3. **Smoke-test the verifier before anything else.** Call `verifyProof` with the values below. It must return `true`.
   They are valid for the development keys in this repository (see `docs/dev-ceremony-v3.md`); a new setup needs new values.
4. **Pools.** Deploy `LatheonShieldedPoolV5(token, verifier, denomination)` once per size. The denomination is in the token's
   base units: `amount * 10**decimals`. A 6-decimals token such as USDG needs `100000000` for 100, **not** 18 zeros.
5. **Read back** `DENOMINATION()`, `token()` and `verifier()` of each pool: they are immutable, a typo cannot be fixed.
6. **Check the library link:** `zeros(8)` of any pool must equal
   `21551820661461729022865262380882070649935529853313286572328683688269863701601`.
7. **Exercise it:** one deposit and one withdrawal to another address per network (the demo does this).
8. **Record it:** add the pools to `sdk/deployments.json` (the demo reads it at run time), then `docs/deployments-v5.md`,
   the activity widget and the "Also live" blocks of the site.

## Smoke-test values for step 3

```
_pA
["0x1d956a0965dc7a08e2b978ef8eba77f421bfc5fc7432b0987c8c2352d0c60316","0x27b39cf3eef2ce89f697da222ae0e7ee7fcdd67e3d60d9c1a1fb30b01f030c75"]

_pB
[["0x22940b94a752ff8c16359826bb18b45aa783b72386d04d159f1b73b0f2b1b53c","0x196fa8a67f44a74ffb0e3264c8a00dde2373efcad93697fd1fa851deafb2ae76"],["0x2c2ea237a533f8aaa013fbdc418017bc68ea336059d996cfd932ba8f91b786ef","0x2e2ee1e8aae5906e8ff8d1d4541d78cde23ee1178966e5ff332e79b42919fac6"]]

_pC
["0x27aa24204c5adfedfdf13041c2f63bc2021fd2604d20b4795c1e4618a631dae4","0x19a2ea0b272440b0a1187dd7c982383418182b977ff0212dbbde11028bf0bd1a"]

_pubSignals
["0x00e33b0a9115241ba9d1a861d24518808af9fcd70937bb70d960d3d1d58edd0e","0x1932e51fbde4a0faecdcd6b272053a16e64e062a920c765a15998c4fcfd21156","0x000000000000000000000000e156154e79f7954bb0b7b79d400dafb069332a5c"]
```

## Pitfalls seen in practice

- **Remix reused a stale library address** when linking (an address from another network): the pool constructor reverted.
  The raw input of the failed transaction showed the wrong address. Deploying the library again immediately before the pool
  worked; the `zeros(8)` check above catches a wrong link.
- **The same address can mean different contracts on different networks** (same deployer, same nonce). Always pair an
  address with its chain; anything that caches by address alone breaks.
- A proof that verifies off-chain but fails on-chain usually means the verifier and the `.zkey` come from different setups.
