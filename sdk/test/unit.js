'use strict';
// Unit checks for the V7 SDK: hashes, notes, master keys, the registry read from deployments.json, 20-level Merkle
// paths, proof inputs, withdrawMany items and batching. No network, no proofs: `node test/unit.js` (a few seconds).
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const sdk = require('../src/index');
const D = require('../distribution');

let fails = 0, n = 0;
const ok = (name, cond, note) => { n++; if (!cond) fails++; console.log((cond ? 'ok   ' : 'FAIL ') + name + (note ? '   [' + note + ']' : '')); };
const throws = (f, re) => { try { f(); return false; } catch (e) { return re ? re.test(e.message) : true; } };
const FIELD = sdk.FIELD_SIZE;
const E18 = 10n ** 18n;

console.log('-- hashes (poseidon-lite equals the circuits and the on-chain PoseidonT3)');
ok('Poseidon(739738264, 0) matches the on-chain V3 commitment this SDK was first verified against', sdk.hash2(739738264n, 0n) === 9795364973993693415770521494914416411979868395478123512127090409899354231800n);
ok('commitment(555111222, 888444333) matches the demo self-check (known on-chain data)', sdk.computeCommitment(555111222n, 888444333n) === 17532398397455971669194033134168638503125316998070411330403243243693265230884n);
ok('nullifier is Poseidon(spendKey, 1)', sdk.computeNullifierHash(5n) === sdk.hash2(5n, 1n));
ok('disclosure tag is Poseidon(viewKey, nonce)', sdk.computeDisclosureTag(7n, 9n) === sdk.hash2(7n, 9n));
const z20 = sdk.computeZeroCascade(20), z8 = sdk.computeZeroCascade(8);
ok('zero cascade: 21 values for 20 levels, zeros[0] = 0, zeros[8] matches the V5 pools\' zeros(8)', z20.length === 21 && z20[0] === 0n && z20[8] === 21551820661461729022865262380882070649935529853313286572328683688269863701601n);
ok('zero cascade by generation name: v7 -> 20 levels, v5 -> 8; prefixes agree', sdk.computeZeroCascade('v7').length === 21 && sdk.computeZeroCascade('v5').length === 9 && z8.every((z, i) => z === z20[i]));
ok('random field elements are in the field and distinct', (() => { const s = new Set(); for (let i = 0; i < 50; i++) { const r = sdk.randomFieldElement(); if (!sdk.isFieldElement(r)) return false; s.add(r); } return s.size === 50; })());
ok('isFieldElement rejects FIELD, negatives and non-BigInt', !sdk.isFieldElement(FIELD) && !sdk.isFieldElement(-1n) && !sdk.isFieldElement(5) && sdk.isFieldElement(FIELD - 1n));

console.log('-- registry from deployments.json');
const reg = sdk.loadDeployments();
const v7pools = sdk.listPools(reg, { version: 'v7' });
ok('four V7 pools on the Latheon test chain: 100 / 50 / 10 / 1 LTH', v7pools.length === 4 && v7pools.map((p) => p.amount).sort((a, b) => b - a).join() === '100,50,10,1' && v7pools.every((p) => p.network === 'latheon-testnet' && p.token === 'LTH'));
ok('V7 pools: native coin, 20 levels, withdraw_v5, fee version, denomination in base units, verifier = v7Verifier', v7pools.every((p) => p.native && p.levels === 20 && p.circuit === 'withdraw_v5' && p.feeVersion && p.denomination === BigInt(p.amount) * E18 && p.verifierAddr === ethers.getAddress(reg.networks['latheon-testnet'].v7Verifier)));
ok('V7 pool addresses are the ones in deployments.json (checksummed)', ['0x53a11072B55761Bc5e17C5B4c150a0443A7dA6ae', '0x5A3DA32BCc848a81A3a379620120ae06DfA7C657', '0xAe33ac9C4D5Ff55D571a0a2Ae4E6e96Db006A429', '0x358A6567F8Fd54D1d70482616dd24d0FeDD2678A'].every((a) => v7pools.some((p) => p.address === a)));
ok('only the four V7 pools and the V7 router are depositable', sdk.listPools(reg, { depositable: true }).length === 4 && sdk.listPools(reg, { depositable: true }).every((p) => p.version === 'v7') && sdk.listRouters(reg, { depositable: true }).map((r) => r.id).join() === 'latheon-testnet:LTH:v7');
ok('every V6 and V5 pool is frozen and forgeable (withdrawals only)', sdk.listPools(reg).filter((p) => p.version !== 'v7').every((p) => p.frozen && p.forgeable && !sdk.isDepositable(p)));
ok('V6 pools: 20 levels, withdraw_v4, v6Verifier; V5 pools: 8 levels, withdraw_v3, v5Verifier', sdk.listPools(reg, { version: 'v6' }).every((p) => p.levels === 20 && p.circuit === 'withdraw_v4' && p.verifierAddr === ethers.getAddress(p.net.v6Verifier)) && sdk.listPools(reg, { version: 'v5' }).every((p) => p.levels === 8 && p.circuit === 'withdraw_v3' && !p.feeVersion && p.verifierAddr === ethers.getAddress(p.net.v5Verifier)));
ok('V4 legacy entries are left out', reg.pools.every((p) => !p.legacy && p.version !== 'v4') && reg.config.pools.some((p) => p.legacy));
const r7 = sdk.routerById(reg, 'latheon-testnet:LTH:v7');
ok('V7 router: address from deployments.json, four pools largest first, denominations, chain 60531373273, relayer listed', r7 && r7.address === '0x1D1189D5399B24BB40858AEACDb649977b596Cf2' && r7.pools.map((p) => p.amount).join() === '100,50,10,1' && r7.denominations.join() === [100n, 50n, 10n, 1n].map((d) => d * E18).join() && r7.net.chainId === 60531373273 && sdk.hasRelayer(r7.net));
ok('every router has its four pools of its own generation; pre-V7 routers are frozen', reg.routers.length === 7 && reg.routers.every((r) => r.pools.length === 4 && r.pools.every((p) => p.version === r.version)) && reg.routers.filter((r) => r.version !== 'v7').every((r) => r.frozen));
ok('routerFor(pool) finds the router of the same generation', sdk.routerFor(reg, v7pools[0]) === r7 && sdk.routerFor(reg, sdk.poolById(reg, 'latheon-testnet:LTH-100:v6')).version === 'v6');
ok('findPool / findRouter are case-insensitive on the address and strict on the chain', sdk.findPool(reg, 60531373273, v7pools[0].address.toLowerCase()) === v7pools[0] && sdk.findPool(reg, 1, v7pools[0].address) === null && sdk.findRouter(reg, 60531373273, r7.address.toLowerCase()) === r7);
ok('assertDepositable throws for V6, V5 and a flagged V7 entry, passes for V7', throws(() => sdk.assertDepositable(sdk.poolById(reg, 'latheon-testnet:LTH-100:v6')), /pre-V7/) && throws(() => sdk.assertDepositable(sdk.poolById(reg, 'ethereum-sepolia:LTH-100')), /pre-V7/) && throws(() => sdk.assertDepositable(Object.assign({}, v7pools[0], { frozen: true })), /frozen/) && !throws(() => sdk.assertDepositable(v7pools[0])));
ok('a synthetic config: a V7 entry inferred not frozen, a V6 one frozen even without flags, a deprecated network frozen', (() => {
  const cfg = { networks: { x: { chainId: 1, tokens: { T: { address: ethers.ZeroAddress, decimals: 18, native: true } }, v7Verifier: ethers.ZeroAddress, v6Verifier: ethers.ZeroAddress }, y: { chainId: 2, deprecated: true, tokens: { T: { address: ethers.ZeroAddress, decimals: 18, native: true } }, v7Verifier: ethers.ZeroAddress } },
    pools: [{ id: 'a', network: 'x', version: 'v7-native', token: 'T', amount: 1, address: ethers.ZeroAddress, deployBlock: 5 }, { id: 'b', network: 'x', version: 'v6-native', token: 'T', amount: 1, address: ethers.ZeroAddress, deployBlock: 5 }, { id: 'c', network: 'y', version: 'v7-native', token: 'T', amount: 1, address: ethers.ZeroAddress, deployBlock: 5 }] };
  const r = sdk.loadDeployments(cfg);
  return r.pools.length === 3 && !r.pools[0].frozen && r.pools[1].frozen && r.pools[1].forgeable && r.pools[2].frozen && r.routers.length === 0 && r.pools[0].startBlock === 5;
})());
ok('sdk/deployments.json and demo/deployments.json are the same file', fs.readFileSync(path.join(__dirname, '..', 'deployments.json'), 'utf8') === fs.readFileSync(path.join(__dirname, '..', '..', 'demo', 'deployments.json'), 'utf8'));

console.log('-- notes');
const p100 = sdk.poolById(reg, 'latheon-testnet:LTH-100:v7');
const note = sdk.generateNote(p100);
ok('generateNote: keys in the field, commitment = Poseidon(Poseidon(sk, vk), 0), nullifier, text', sdk.isFieldElement(note.spendKey) && sdk.isFieldElement(note.viewKey) && note.commitment === sdk.hash2(sdk.hash2(note.spendKey, note.viewKey), 0n) && note.nullifierHash === sdk.hash2(note.spendKey, 1n) && note.note === `latheon-v5:60531373273:${p100.address}:${note.spendKey}:${note.viewKey}`);
const dec = sdk.decodeNote('  ' + note.note + '\n');
ok('decodeNote round-trips (trimmed), checksums the pool address, resolves the pool', dec.chainId === 60531373273 && dec.address === p100.address && dec.spendKey === note.spendKey && dec.viewKey === note.viewKey && sdk.poolForNote(reg, dec) === p100);
ok('decodeNote accepts a lower-case pool address and normalises it', sdk.decodeNote(note.note.replace(p100.address, p100.address.toLowerCase())).address === p100.address);
ok('generateNote with given keys is deterministic', sdk.generateNote(p100, { spendKey: 1n, viewKey: 2n }).note === sdk.generateNote(p100, { spendKey: '1', viewKey: 2 }).note);
ok('decodeNote refuses a master key, a legacy V4 note, a bad address, non-field keys and junk', throws(() => sdk.decodeNote('latheon-master:1:' + p100.address + ':5'), /master key/) && throws(() => sdk.decodeNote('latheon-v4-note:1:2'), /Legacy/) && throws(() => sdk.decodeNote('latheon-v5:1:0x12:3:4'), /address/) && throws(() => sdk.decodeNote('latheon-v5:1:' + p100.address + ':' + FIELD + ':4'), /field/) && throws(() => sdk.decodeNote('hello')) && throws(() => sdk.decodeNote('latheon-v5:1:' + p100.address + ':3')));
ok('poolForNote throws for a pool not in deployments.json', throws(() => sdk.poolForNote(reg, sdk.decodeNote('latheon-v5:60531373273:' + ethers.Wallet.createRandom().address + ':3:4')), /Unknown pool/));
ok('isNote / isMasterKey', sdk.isNote(note.note) && !sdk.isMasterKey(note.note) && sdk.isMasterKey('latheon-master:60531373273:' + r7.address + ':12345') && !sdk.isNote('latheon-master:60531373273:' + r7.address + ':12345'));
ok('encodeNote refuses keys outside the field', throws(() => sdk.encodeNote(p100, FIELD, 1n), /field/));

console.log('-- master keys');
const mkText = sdk.formatMasterKey(r7.net.chainId, r7.address, 987654321n);
ok('formatMasterKey / parseMasterKey round-trip', (() => { const m = sdk.parseMasterKey(mkText); return m.chainId === r7.net.chainId && m.router === r7.address && m.master === 987654321n; })());
const derived = sdk.deriveNotes(12345n, 60531373273, 32);
ok('deriveNotes: 32 notes, keys equal distribution.js deriveNoteKeys, all distinct commitments', derived.length === 32 && derived.every((d, i) => { const k = D.deriveNoteKeys(require('poseidon-lite').poseidon4, 12345n, 60531373273, i); return d.index === i && d.spendKey === k.spendKey && d.viewKey === k.viewKey && d.commitment === sdk.computeCommitment(k.spendKey, k.viewKey) && d.nullifierHash === sdk.computeNullifierHash(k.spendKey); }) && new Set(derived.map((d) => d.commitment)).size === 32);
ok('the same master gives different notes on another chain', sdk.deriveNoteKeys(12345n, 60531373273, 0).spendKey !== sdk.deriveNoteKeys(12345n, 421614, 0).spendKey);
ok('MASTER_SCAN_LIMIT is 64 (at least MAX_NOTES 32)', sdk.MASTER_SCAN_LIMIT === 64 && sdk.MAX_NOTES === 32 && sdk.MAX_WITHDRAWALS === 16);

console.log('-- deposit planning through the router');
let plan = sdk.planDeposit(r7, 161n * E18);
ok('161 LTH -> 100 + 50 + 10 + 1 in that order, pools attached', plan.total === 4n && plan.counts.join() === '1,1,1,1' && plan.notes.map((p) => p.amount).join() === '100,50,10,1' && plan.remainder === 0n);
plan = sdk.planDeposit(r7, sdk.toUnits(r7, '99.5'), { mode: 'round', step: E18 });
ok('round mode: 99.5 -> 99 (0,1,4,9 = 14 notes), remainder 0.5 stays', plan.amount === 99n * E18 && plan.total === 14n && plan.counts.join() === '0,1,4,9' && plan.remainder === E18 / 2n && sdk.fromUnits(r7, plan.remainder) === '0.5');
ok('exact mode refuses 0.5 LTH; more than 32 notes is refused (e.g. 999 LTH = 9+1+4+9 = 23 ok, 3300 = 33 no)', throws(() => sdk.planDeposit(r7, E18 / 2n)) && sdk.planDeposit(r7, 999n * E18).total === 23n && throws(() => sdk.planDeposit(r7, 3300n * E18), /32/));
ok('toUnits / fromUnits use the token decimals', sdk.toUnits(r7, '160') === 160n * E18 && sdk.fromUnits(r7, 160n * E18) === '160');

console.log('-- Merkle tree (20 levels)');
const leaves = Array.from({ length: 37 }, (_, i) => sdk.hash2(BigInt(i + 1), 0n));
const tree = sdk.buildTreeLevels(leaves, z20);
ok('tree has 21 levels; the top level has one node', tree.length === 21 && tree[20].length === 1);
ok('the root of the empty tree is zeros[20]', sdk.buildTreeLevels([], z20)[20][0] === z20[20]);
ok('every leaf\'s path recomputes the root (pathIndices are bits, 20 elements)', leaves.every((leaf, i) => { const { pathElements, pathIndices, root } = sdk.getMerklePath(tree, i, z20); return pathElements.length === 20 && pathIndices.every((b) => b === 0 || b === 1) && root === tree[20][0] && sdk.rootFromPath(leaf, pathElements, pathIndices) === root; }));
ok('a wrong leaf or a flipped index does not recompute the root', (() => { const { pathElements, pathIndices, root } = sdk.getMerklePath(tree, 5, z20); const flipped = pathIndices.slice(); flipped[0] ^= 1; return sdk.rootFromPath(leaves[6], pathElements, pathIndices) !== root && sdk.rootFromPath(leaves[5], pathElements, flipped) !== root; })());
ok('merkleProofFromDeposits (deposits in any order, V7) agrees with buildTreeLevels + getMerklePath', (() => { const deps = leaves.map((c, i) => ({ commitment: c, leafIndex: i })).reverse(); const m = sdk.merkleProofFromDeposits(deps, 9, 'v7'); const g = sdk.getMerklePath(tree, 9, z20); return m.root === g.root && m.leafIndex === 9 && m.pathElements.join() === g.pathElements.join() && m.pathIndices.join() === g.pathIndices.join(); })());
ok('the incremental on-chain rule gives the same root: insert leaves one by one with filledSubtrees', (() => {
  // mirror of _insert() in LatheonShieldedPoolV7Native.sol
  const filled = z20.slice(0, 20); let root = null;
  for (let idx = 0; idx < leaves.length; idx++) { let cur = leaves[idx], i = idx; for (let l = 0; l < 20; l++) { if (i % 2 === 0) { filled[l] = cur; cur = sdk.hash2(cur, z20[l]); } else cur = sdk.hash2(filled[l], cur); i = Math.floor(i / 2); } root = cur; }
  return root === tree[20][0];
})());
ok('a 20-level tree accepts leaf 300 (what a V5 8-level tree cannot hold)', (() => { const big = []; big[300] = 77n; const t = sdk.buildTreeLevels(big, z20); const { root, pathElements, pathIndices } = sdk.getMerklePath(t, 300, z20); return sdk.rootFromPath(77n, pathElements, pathIndices) === root && throws(() => sdk.buildTreeLevels(Array(257).fill(1n), z8), /Too many/); })());
ok('getMerklePath refuses an out-of-range leaf and a depth mismatch', throws(() => sdk.getMerklePath(tree, 2 ** 20, z20)) && throws(() => sdk.getMerklePath(tree, 0, z8)));

console.log('-- proof inputs (withdraw_v5)');
const { pathElements, pathIndices, root } = sdk.getMerklePath(tree, 3, z20);
const recipient = ethers.Wallet.createRandom().address, relayerAddr = ethers.Wallet.createRandom().address;
const base = { spendKey: 11n, viewKey: 22n, pathElements, pathIndices, root, recipient };
let input = sdk.buildWithdrawInput(base);
ok('V7 input: decimal strings, relayer 0 and fee 0 by default, nullifier derived, recipient as a number', input.root === root.toString() && input.nullifierHash === sdk.computeNullifierHash(11n).toString() && input.relayer === '0' && input.fee === '0' && input.recipient === BigInt(recipient).toString() && input.pathElements.length === 20 && input.pathElements.every((s) => typeof s === 'string') && input.pathIndices.every((b) => b === 0 || b === 1) && input.spendKey === '11' && input.viewKey === '22');
input = sdk.buildWithdrawInput(Object.assign({}, base, { relayer: relayerAddr, fee: 5n * E18 }));
ok('V7 input with relayer and fee', input.relayer === BigInt(relayerAddr).toString() && input.fee === (5n * E18).toString());
ok('a fee without a relayer is refused; a wrong nullifier is refused; the zero recipient is refused', throws(() => sdk.buildWithdrawInput(Object.assign({}, base, { fee: 1n })), /relayer/) && throws(() => sdk.buildWithdrawInput(Object.assign({}, base, { nullifierHash: 1n })), /nullifierHash/) && throws(() => sdk.buildWithdrawInput(Object.assign({}, base, { recipient: ethers.ZeroAddress })), /recipient/));
ok('a path of the wrong depth, non-bit indices and out-of-field keys are refused', throws(() => sdk.buildWithdrawInput(Object.assign({}, base, { pathElements: pathElements.slice(0, 8) })), /20/) && throws(() => sdk.buildWithdrawInput(Object.assign({}, base, { pathIndices: pathIndices.map(() => 2) })), /bits/) && throws(() => sdk.buildWithdrawInput(Object.assign({}, base, { spendKey: FIELD })), /field/));
const p8 = sdk.getMerklePath(sdk.buildTreeLevels(leaves.slice(0, 5), z8), 2, z8);
input = sdk.buildWithdrawInput({ version: 'v5', spendKey: 1n, viewKey: 2n, pathElements: p8.pathElements, pathIndices: p8.pathIndices, root: p8.root, recipient });
ok('V5 input: 8 levels, no relayer / fee; a relayer or fee is refused for V5', input.pathElements.length === 8 && input.relayer === undefined && input.fee === undefined && throws(() => sdk.buildWithdrawInput({ version: 'v5', spendKey: 1n, viewKey: 2n, pathElements: p8.pathElements, pathIndices: p8.pathIndices, root: p8.root, recipient, fee: 1n, relayer: relayerAddr }), /V5/));
ok('checkWithdrawBinding accepts matching signals and rejects a changed recipient or count', (() => { const inp = sdk.buildWithdrawInput(base); const sig = [inp.root, inp.nullifierHash, inp.recipient, inp.relayer, inp.fee]; const bad = sig.slice(); bad[2] = BigInt(relayerAddr).toString(); return !throws(() => sdk.checkWithdrawBinding(sig, inp, 'withdraw_v5')) && throws(() => sdk.checkWithdrawBinding(bad, inp, 'withdraw_v5'), /recipient/) && throws(() => sdk.checkWithdrawBinding(sig.slice(0, 3), inp, 'withdraw_v5'), /5 public/); })());
const di = sdk.buildDiscloseInput({ spendKey: 11n, viewKey: 22n, auditorNonce: 33n });
ok('disclose input: commitment, tag = Poseidon(viewKey, nonce), nonce, keys', di.commitment === sdk.computeCommitment(11n, 22n).toString() && di.disclosureTag === sdk.hash2(22n, 33n).toString() && di.auditorNonce === '33');
ok('constants: levelsOf / circuitOf / feeVersion / PUBLIC_SIGNALS', sdk.levelsOf('v7') === 20 && sdk.levelsOf('v5') === 8 && sdk.circuitOf('v7') === 'withdraw_v5' && sdk.circuitOf('v6') === 'withdraw_v4' && sdk.circuitOf('v5') === 'withdraw_v3' && sdk.feeVersion('v7') && sdk.feeVersion('v6') && !sdk.feeVersion('v5') && sdk.PUBLIC_SIGNALS.withdraw_v5.join() === 'root,nullifierHash,recipient,relayer,fee' && throws(() => sdk.levelsOf('v4')));

console.log('-- withdrawMany items, batching, ABIs');
const fakeProof = { pA: ['1', '2'], pB: [['3', '4'], ['5', '6']], pC: ['7', '8'], pubSignals: [root.toString(), '9', BigInt(recipient).toString(), '0', '0'] };
const item = sdk.buildWithdrawManyItem(r7, 2, fakeProof, 3n);
ok('V7 item: [pool, pA, pB, pC, root, nullifierHash, fee]', item.length === 7 && item[0] === 2 && item[4] === root.toString() && item[5] === '9' && item[6] === 3n);
const r5 = sdk.routerById(reg, 'latheon-testnet:LTH');
ok('V5 item has no fee', sdk.buildWithdrawManyItem(r5, 0, fakeProof).length === 6 && r5.version === 'v5');
ok('poolIndex outside 0..3 is refused', throws(() => sdk.buildWithdrawManyItem(r7, 4, fakeProof)));
ok('the V7 item encodes with the router ABI (withdrawMany(items, recipient, relayer)) and decodes back', (() => {
  const iface = new ethers.Interface(sdk.ROUTER_ABI.v7);
  const data = iface.encodeFunctionData('withdrawMany', [[item, sdk.buildWithdrawManyItem(r7, 0, fakeProof, 0n)], recipient, relayerAddr]);
  const dec2 = iface.decodeFunctionData('withdrawMany', data);
  return dec2.items.length === 2 && dec2.items[0].pool === 2n && dec2.items[0].fee === 3n && dec2.items[0].root === root && dec2.items[1].pool === 0n && dec2.recipient === recipient && dec2.relayer === relayerAddr;
})());
ok('the V5 item encodes with the V5 router ABI (withdrawMany(items, recipient))', (() => { const iface = new ethers.Interface(sdk.ROUTER_ABI.v5); const d = iface.decodeFunctionData('withdrawMany', iface.encodeFunctionData('withdrawMany', [[sdk.buildWithdrawManyItem(r5, 1, fakeProof)], recipient])); return d.items[0].pool === 1n && d.items[0].fee === undefined; })());
const items = Array.from({ length: 35 }, (_, i) => i);
ok('batchItems: 35 items -> 16 + 16 + 3; 16 -> one batch; 0 -> none', sdk.batchItems(items).map((b) => b.length).join() === '16,16,3' && sdk.batchItems(items.slice(0, 16)).length === 1 && sdk.batchItems([]).length === 0 && throws(() => sdk.batchItems(items, 0)));
ok('pool ABI: V7 withdraw has 8 inputs (…recipient, relayer, fee), V5 has 6; verifier takes 5 / 3 public signals', new ethers.Interface(sdk.POOL_ABI.v7).getFunction('withdraw').inputs.length === 8 && new ethers.Interface(sdk.POOL_ABI.v5).getFunction('withdraw').inputs.length === 6 && new ethers.Interface(sdk.VERIFIER_ABI.v7).getFunction('verifyProof').inputs[3].arrayLength === 5 && new ethers.Interface(sdk.VERIFIER_ABI.v5).getFunction('verifyProof').inputs[3].arrayLength === 3 && sdk.POOL_ABI.v6 === sdk.POOL_ABI.v7 && sdk.ROUTER_ABI.v6 === sdk.ROUTER_ABI.v7);
ok('ABIs match the demo\'s (same function signatures for withdraw and withdrawMany)', (() => {
  const demo = fs.readFileSync(path.join(__dirname, '..', '..', 'demo', 'index.html'), 'utf8');
  const sigs = ['function withdraw(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256 root, uint256 nullifierHash, address recipient, address relayer, uint256 fee)',
    'function withdraw(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256 root, uint256 nullifierHash, address recipient)',
    'function withdrawMany((uint256 pool, uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256 root, uint256 nullifierHash, uint256 fee)[] items, address recipient, address relayer)',
    'function withdrawMany((uint256 pool, uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256 root, uint256 nullifierHash)[] items, address recipient)',
    'function deposit(uint256 amount, uint256[] commitments) payable', 'event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp)'];
  const all = [].concat(sdk.POOL_ABI.v7, sdk.POOL_ABI.v5, sdk.ROUTER_ABI.v7, sdk.ROUTER_ABI.v5);
  return sigs.every((s) => demo.includes(s) && all.includes(s));
})());
ok('circuit hashes and commit match the demo', (() => { const demo = fs.readFileSync(path.join(__dirname, '..', '..', 'demo', 'index.html'), 'utf8'); return demo.includes(sdk.CIRCUITS.withdraw_v5.wasmSha256) && demo.includes(sdk.CIRCUITS.withdraw_v5.zkeySha256) && demo.includes(sdk.CIRCUITS.disclose.zkeySha256) && demo.includes("CIRCUIT_COMMIT = '129a4c0d38af03b0ad2db59e8ad01823e813ed77'"); })());

console.log('-- note selection (distribution.js, shared with the demo)');
const mkNotes = (vals) => vals.map((v, i) => ({ id: i, value: v, spent: false }));
let sel = sdk.selectNotesForAmount(mkNotes([100, 50, 50, 10, 1]).concat([{ id: 9, value: 100, spent: true }]), 100);
ok('selectNotesForAmount ignores spent notes and picks the single 100', sel.chosen && sel.chosen.length === 1 && sel.chosen[0].id === 0);
sel = sdk.selectNotesForAmount(mkNotes([50, 10, 1]), 100);
ok('an unreachable amount gives null and the nearest sum', sel.chosen === null && sel.nearest === 61);
ok('the demo carries an identical copy of distribution-core', (() => {
  const block = (t) => { const a = t.indexOf('distribution-core:begin'), b = t.indexOf('distribution-core:end'); return t.slice(a, b).split('\n').slice(1).join('\n').replace(/\s+/g, ' ').trim(); };
  const a = block(fs.readFileSync(path.join(__dirname, '..', 'distribution.js'), 'utf8')), b = block(fs.readFileSync(path.join(__dirname, '..', '..', 'demo', 'index.html'), 'utf8'));
  return a.length > 500 && a === b;
})());

console.log('-- guards that need no chain');
const fakeSigner = { sendTransaction() {}, getAddress() {}, provider: null };
ok('assertDepositable refuses the frozen V5 router', throws(() => sdk.assertDepositable(r5), /pre-V7/));
(async () => {
  let a = false, b = false, c = false, d = false;
  try { await sdk.deposit(fakeSigner, sdk.poolById(reg, 'latheon-testnet:LTH-100:v6')); } catch (e) { a = /pre-V7/.test(e.message); }
  try { await sdk.depositAny(fakeSigner, r5, 1n * E18); } catch (e) { b = /pre-V7/.test(e.message); }
  try { await sdk.withdrawNote({}, p100, note.note, recipient); } catch (e) { c = /Signer|provider/.test(e.message); }
  try { await sdk.withdrawNote(fakeSigner, p100, note.note.replace(p100.address, sdk.poolById(reg, 'latheon-testnet:LTH-50:v7').address), recipient); } catch (e) { d = /another pool/.test(e.message); }
  ok('deposit into a V6 pool, depositAny through a V5 router, withdrawNote without a provider, a note of another pool: all refused', a && b && c && d);
  let e1 = false, e2 = false;
  try { await sdk.findNotes({ getBlockNumber: async () => 0 }, r7, sdk.formatMasterKey(1, r7.address, 5n)); } catch (e) { e1 = /belongs to router/.test(e.message); }
  try { await sdk.loadCircuit('withdraw_v5', { dir: '/nonexistent' }); } catch (e) { e2 = /not found/.test(e.message); }
  ok('findNotes refuses a master key of another router; loadCircuit names the missing directory', e1 && e2);
  try { await sdk.loadCircuit('withdraw_v5', { wasm: Buffer.from('x'), zkey: Buffer.from('y') }); ok('loadCircuit refuses files that do not match the published hash', false); } catch (e) { ok('loadCircuit refuses files that do not match the published hash', /SHA-256/.test(e.message)); }
  ok('loadCircuit accepts unknown files with verify: false', (await sdk.loadCircuit('v7', { wasm: Buffer.from('x'), zkey: Buffer.from('y'), verify: false })).name === 'withdraw_v5');
  { // waitForBlock: an RPC that still reports the block before a deposit is waited for, a stuck one is refused
    const seq = [5, 5, 6, 7]; let calls = 0;
    const lag = { getBlockNumber: async () => seq[Math.min(calls++, seq.length - 1)] };
    const h = await sdk.waitForBlock(lag, 7, undefined, { pollMs: 1, waitMs: 1000 });
    let stuck = false; try { await sdk.waitForBlock({ getBlockNumber: async () => 3 }, 4, undefined, { pollMs: 1, waitMs: 20 }); } catch (e) { stuck = /behind block 4/.test(e.message); }
    ok('waitForBlock(): waits for a lagging RPC to reach the deposit block, refuses one that stays behind', h === 7 && calls === 4 && stuck);
  }
  console.log(fails ? '\n' + fails + ' of ' + n + ' FAILED' : '\nALL ' + n + ' CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})();
