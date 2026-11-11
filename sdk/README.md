# @latheon/sdk

JavaScript SDK for Latheon's **V7** shielded pools and distribution router on the Latheon test chain: notes and master
keys, 20-level Merkle paths, `withdraw_v5` proofs (recipient, relayer and fee bound into the proof), deposits,
`withdraw` and `withdrawMany` (up to 16 notes in one transaction), and the network's relayer. Addresses come from
[`deployments.json`](./deployments.json) (the same file the demo loads). The reference implementation remains
[`../demo/index.html`](../demo/index.html); this SDK follows it function by function.

**V6 and V5 pools are supported for withdrawals only.** Every pre-V7 pool uses a circuit with a known flaw (a forged
proof can withdraw without a deposit, `THREAT-MODEL.md` §8.0); `deployments.json` marks them `"frozen": true,
`"forgeable": true` (routers `"frozen": true`), and every deposit path of this SDK refuses such an entry before touching
the chain (`assertDepositable`). They stay listed so notes already in them can be withdrawn. V4 and V3 (legacy notes,
single-secret commitments) are not handled by this SDK at all; the demo still withdraws V4 legacy notes.

Testnets only, not audited.

## Install

```bash
cd sdk && npm install            # ethers, poseidon-lite (+ snarkjs, ganache, solc for the tests)
```

Not published to npm: copy or link the `sdk/` folder. Proof generation needs `snarkjs` (optional peer dependency) and
the circuit's `wasm` + `zkey` (about 7 MB for `withdraw_v5`): `loadCircuit()` reads them from `circuits/build/` in this
repository, from paths or buffers you pass, or downloads them from the pinned commit on jsDelivr with
`{ download: true }`. Every file is checked against the SHA-256 the demo publishes before use.

## Quick start

```js
const { ethers } = require('ethers');
const sdk = require('@latheon/sdk');

const reg = sdk.loadDeployments();                                  // from deployments.json
const router = sdk.listRouters(reg, { depositable: true })[0];      // V7 LTH router on the Latheon test chain
const provider = new ethers.JsonRpcProvider(router.net.rpcUrl, router.net.chainId, { staticNetwork: true });
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const circuit = await sdk.loadCircuit('v7', { download: true });    // withdraw_v5

// Deposit 161 LTH in one transaction: 100 + 50 + 10 + 1, one master key for all four notes
const dep = await sdk.depositAny(signer, router, sdk.toUnits(router, '161'));
console.log('save this:', dep.masterKey);   // latheon-master:<chainId>:<router>:<master>

// Later: withdraw exactly 111 LTH (100 + 10 + 1) to a fresh address through the relayer (no wallet, no gas)
const out = await sdk.withdrawByAmount(provider, router, dep.masterKey, 111, recipient, { circuit, viaRelayer: true });

// One fixed pool: deposit a single note, withdraw it from a wallet
const pool = sdk.listPools(reg, { depositable: true, amount: 10 })[0];
const note = await sdk.deposit(signer, pool);        // save note.note: latheon-v5:<chainId>:<pool>:<spendKey>:<viewKey>
await sdk.withdrawNote(otherSigner, pool, note.note, recipient, { circuit, relayer, fee });
```

`examples/v7-flow.js` runs this against the test chain.

## What a V7 withdrawal is

- **Note:** `spendKey`, `viewKey` (random field elements); commitment `Poseidon(Poseidon(spendKey, viewKey), 0)` goes on
  chain as a leaf; nullifier `Poseidon(spendKey, 1)` is recorded when the note is spent. Text form
  `latheon-v5:<chainId>:<pool>:<spendKey>:<viewKey>` (unchanged since V5).
- **Master key:** one secret for all notes of a router deposit (at most 32). Note `i` has
  `spendKey = Poseidon4(master, chainId, i, 1)`, `viewKey = Poseidon4(master, chainId, i, 2)`. Text form
  `latheon-master:<chainId>:<router>:<master>`.
- **Tree:** 20 levels (1,048,576 leaves per pool), zero cascade `zeros[i+1] = Poseidon(zeros[i], zeros[i])`; the pool
  remembers its last 100 roots. The SDK rebuilds the tree from the pool's `Deposit` events and checks the count against
  `nextIndex()` before proving.
- **Proof (`withdraw_v5`):** public inputs `root, nullifierHash, recipient, relayer, fee`; private `spendKey, viewKey,
  pathElements[20], pathIndices[20]`. The pool checks the proof against exactly those five values, so nobody, not even
  the relayer, can change where the coin goes or what the fee is.
- **Calls:** `pool.withdraw(pA, pB, pC, root, nullifierHash, recipient, relayer, fee)`;
  `router.withdrawMany(items[], recipient, relayer)` with `items[i] = [poolIndex, pA, pB, pC, root, nullifierHash, fee]`,
  at most 16 per call (`MAX_WITHDRAWALS`). The relayer takes the same shapes as JSON (`POST /withdraw`,
  `POST /withdrawMany`).

## API

All amounts are BigInt in base units unless a name says tokens. Hashes are synchronous and return BigInt. Functions
that read the chain take an ethers `Provider` (or a `Signer` with one); functions that send take a `Signer`.

### Registry (`deployments.json`)

- `loadDeployments(config?)` → `{ networks, pools, routers }`. Pools carry `net`, `tok`, `version` (`'v7' | 'v6' | 'v5'`),
  `native`, `levels`, `denomination`, `verifierAddr`, `startBlock`, `circuit`, `frozen`, `forgeable`, `feeVersion`;
  routers carry `pools` (largest first), `denominations`, the same flags. V4 legacy entries are dropped.
- `listPools(reg, { network, token, version, amount, depositable })`, `listRouters(reg, { … })`
- `findPool(reg, chainId, address)`, `poolById(reg, id)`, `findRouter(reg, chainId, address)`, `routerById(reg, id)`,
  `routerFor(reg, pool)`, `poolForNote(reg, decodedNote)`
- `isDepositable(entry)`, `assertDepositable(entry)`: V7 and not flagged, nothing else.

### Hashes

- `hash2(a, b)`, `hash4(a, b, c, d)` (Poseidon), `computeCommitment(spendKey, viewKey)`, `computeNullifierHash(spendKey)`,
  `computeDisclosureTag(viewKey, auditorNonce)`, `computeZeroCascade(levels | 'v7')`, `randomFieldElement()`, `isFieldElement(x)`

### Notes and master keys

- `generateNote(pool, { spendKey?, viewKey? })` → `{ spendKey, viewKey, commitment, nullifierHash, note }`
- `encodeNote(pool, spendKey, viewKey)`, `decodeNote(text)` → `{ chainId, address, spendKey, viewKey }`, `isNote`, `isMasterKey`
- `formatMasterKey(chainId, router, master)`, `parseMasterKey(text)`, `deriveNoteKeys(master, chainId, i)`,
  `deriveNotes(master, chainId, count)`, `MASTER_SCAN_LIMIT` (64)

### Merkle tree

- `fetchDeposits(provider, pool, { fromBlock, toBlock, minSpan, log })`: every `Deposit` event from `pool.startBlock`,
  one request where the endpoint allows it (split in halves otherwise), verified against `nextIndex()`.
- `buildTreeLevels(leaves, zeros)`, `getMerklePath(tree, leafIndex, zeros)`, `rootFromPath(leaf, pathElements, pathIndices)`,
  `merkleProofFromDeposits(deposits, leafIndex, levels | 'v7')`
- `findDeposit(provider, pool, commitment)`, `getProofInputsForCommitment(provider, pool, commitment)` →
  `{ leafIndex, pathElements, pathIndices, root, deposits }`

### Proofs (snarkjs)

- `loadCircuit('v7' | 'v6' | 'v5' | 'disclose', { dir | wasm, zkey | download, verify })`
- `buildWithdrawInput({ version, spendKey, viewKey, pathElements, pathIndices, root, nullifierHash?, recipient, relayer?, fee? })`
- `proveWithdraw(input, circuit)` → `{ pA, pB, pC, pubSignals, proof, publicSignals, version }` (`pubSignals` are
  `0x`-hex strings as snarkjs's `exportSolidityCallData` gives them; the bindings are checked before returning)
- `checkWithdrawBinding(pubSignals, input, circuitName)`, `verifyProofLocally(vkeyOrCircuit, proofResult)`, `verificationKeyOf(circuit)`
- `buildDiscloseInput({ spendKey, viewKey, auditorNonce })`, `proveDisclose(input, circuit)`

### One pool

- `deposit(signer, pool, { spendKey?, viewKey? })` (V7 only; native coin as `msg.value`, ERC-20 with approve) →
  `{ note, spendKey, viewKey, commitment, leafIndex, txHash, receipt }`
- `isSpent(provider, pool, noteOrSpendKey, { spent?, scanOpts?, direct? })`, `isKnownRoot(provider, pool, root)`, `verifyOnChain(provider, pool, proof)`.
  `isSpent`, `withdrawNote` and `findNotes` decide "spent" locally from `fetchSpent(provider, pool)`: the nullifier hashes of
  all the pool's `Withdrawal` events, one scan, checked against the pool's balance. They do not call the pool's
  `nullifierHashes(x)`, because that would show the RPC endpoint which unspent note you hold (and which notes of a master
  key belong together) next to your IP address. `{ direct: true }` makes that single call anyway. What the endpoint and
  the relayer still see: `THREAT-MODEL.md` §8.6
- Delayed sending: `withdrawNote` and `withdrawByAmount` with `{ viaRelayer: true, delay: { withinSeconds } }` hand the proof to the
  relayer, which sends it at a random moment within that window (60 s up to `relayStatus(net).delay.maxSeconds`). The result
  then has `scheduled` (an id and `notAfter`) instead of a transaction hash; `relayScheduled(net, id)` reads the state
  (`waiting`, `sent` with `tx`, `failed`, `cancelled`) and `relayCancel(net, id)` cancels a waiting request. The id is the only
  credential, keep it private. `payOut` does not use delays
- `withdraw(signer, pool, proof, recipient, { relayer, fee })`: the raw call for the pool's generation
- `withdrawNote(signerOrProvider, pool, note, recipient, { relayer, fee, viaRelayer, circuit, circuitOpts, scanOpts, minBlock, log })`:
  scan, path, unspent and known-root checks, proof, verifier check, send (or relay). Proves again when the pool
  forgot the root meanwhile (`ROOT_RETRIES` = 3).

### Router

- `toUnits(router, '160')`, `fromUnits(router, units)`, `planDeposit(router, amount, { mode: 'exact' | 'round', step })`
- `checkRouterOnChain(provider, router, amount?)`: token, pools, denominations and `split()` on chain equal the registry
- `depositAny(signer, router, amount, { mode, step, master })` (V7 only) → `{ masterKey, master, plan, notes, txHash, receipt }`
- `findNotes(provider, router, masterKey)` → `{ notes, unspent, total, deposits }`; each note has `pool`, `poolIndex`,
  `leafIndex`, `value` (tokens), keys, `note` text, `spent`
- Right after a deposit, pass `{ minBlock: receipt.blockNumber }` to `findNotes` or `withdrawNote`: a node can still
  report the block before the deposit as latest for a moment (seen on the Latheon test chain), and the scan then
  waits for it (`waitForBlock`, up to 30 s) instead of missing the new notes.
- `selectNotesForAmount(notes, tokens)` → `{ chosen | null, nearest }` (fewest notes, exact sum, no change)
- `buildWithdrawManyItem(router, poolIndex, proof, fee)`, `batchItems(items, 16)`
- `withdrawMany(signer, router, items, recipient, { relayer })`: one batch, simulated first
- `withdrawByAmount(signerOrProvider, router, masterKey, tokens, recipient, { relayer, fee, viaRelayer, circuit, notes, log })`:
  scan the four pools, pick notes, one proof per note, batches of 16, each simulated, then sent or relayed; re-proves
  the unpaid notes when a pool forgot a root.

### Payouts to a list of recipients (payroll, vendors)

- `planPayout(router, [{ recipient, amount }])` (amounts in base units) → `{ payees, counts, amount, notes, chunks }`.
  Every amount is split on its own (the greedy split of a total does not divide back into the payees' amounts:
  10 × 1,234 LTH = 12,340 = 123 × 100 + 4 × 10, no 1s), and the union of those notes is packed into router deposits
  whose own greedy split is exactly their part (at most 32 notes each, `packChunks`).
- `depositPayout(signer, router, plan)` → a **payout record**: one router deposit per chunk, each under a fresh master
  key, plus the payees and their notes per pool. **The record holds the master keys: keep it secret** (`payoutToJson`,
  `payoutFromJson`, `checkPayoutRecord`).
- `payOut(signerOrProvider, router, record, { viaRelayer, relayer, fee, circuit, only, delayMs, onPayee, log })`: notes are
  assigned to payees in a fixed order (`assignPayoutNotes`), each payee is paid with `withdrawByAmount` (16 notes per
  transaction). Payees whose notes are spent are reported `already paid`, so a payout can be run again after an
  interruption; `only` pays chosen payees, `delayMs` waits between payees.
- **Privacy limit:** amounts are public. Each router deposit shows its amount and sender, each payee's withdrawal the
  amount received. With few users and unusual amounts a payout can be matched to its payer; spreading payouts over
  time weakens this, only hidden amounts would remove it. Testnet, no audit.
- For the accountant: after payment, the keys of the spent notes connect each deposit to its withdrawal and recipient
  (disclosure layer 1b, `docs/disclosure-v2-design.md` §5); never hand over keys of unspent notes.

### Relayer

- `hasRelayer(net)`, `relayStatus(net)`, `relayWithdraw(pool, proof, recipient, { relayer, fee })`,
  `relayWithdrawMany(router, items, recipient, { relayer })`

### Shared with the demo

`canonicalSplit`, `noteOrder`, `roundDown`, `selectNotes` and the master-key helpers live in
[`distribution.js`](./distribution.js); the demo carries a verbatim copy, and the unit test checks they have not drifted.

## Tests

```bash
npm test                # unit (80 checks, no network, no proofs) + proof (12 checks, real withdraw_v5 / v4 / v3 / disclose proofs)
npm run test:e2e        # 45 checks: the SDK against the repository's V7, V6 and V5 contracts on a local EVM (ganache), real proofs
```

The e2e test compiles `LatheonShieldedPoolV7Native`, `LatheonDistributionPoolV7Native`, `WithdrawVerifierV5` (and the
V6 / V5 sets), deploys four pools and a router per generation, describes them in a `deployments.json`-shaped config
and runs the SDK through: deposit, scan, `withdrawNote` (fee 0; relayer + fee; stale-root retry; through a local
relayer), `depositAny`, `findNotes`, `withdrawByAmount` (one batch; 23 notes as 16 + 7; through the relayer with a
fee), a payout to three recipients (`planPayout`, `depositPayout`, `payOut`: partial, then the rest through the relayer,
then nothing left), `withdrawMany` limits, recipient binding, refusal of pre-V7 deposits, and V6 / V5 withdrawals. It takes several
minutes. Nothing talks to a public network.

## Not in this SDK

- The real relayer is only exercised against a local stand-in with the same routes and JSON shapes; the live
  `explorer.testnet.latheon.xyz/relay/api` was not called from the tests.
- ERC-20 V7 pools (`LatheonShieldedPoolV7.sol`) have an `approve` path in `deposit()` / `depositAny()`, but none is
  deployed, so it is untested on chain.
- The disclosure report format of the demo's auditor tab (many notes in one file) and the Blockscout log fallback are
  demo features, not SDK functions.
- V4 legacy notes (`latheon-v4-note:…`), the Ethereum Sepolia faucet helpers and the V3 single-secret API of SDK 0.1
  were removed.

## License

MIT
