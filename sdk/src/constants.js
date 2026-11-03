'use strict';
/*
 * Protocol constants for the Latheon pools. The current generation is V7 (circuit withdraw_v5, 20-level trees,
 * recipient, relayer and fee bound into the proof). V6 and V5 are kept for WITHDRAWALS of existing notes only:
 * their circuits have the pre-V7 flaw (STATUS.md §7), and deployments.json marks every such pool `frozen` and
 * `forgeable`. Addresses live in ../deployments.json (see ./deployments.js), never here.
 *
 * Everything in this file mirrors demo/index.html, which is the reference implementation.
 */

// BN254 scalar field order: every secret, key and hash is an element of this field.
const FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Generations the SDK understands. 'v7' is the only one that may receive deposits.
const VERSIONS = ['v7', 'v6', 'v5'];
const CURRENT_VERSION = 'v7';

// Merkle tree depth per generation (V5 pools stop at 256 deposits; V6/V7 hold 1,048,576).
const LEVELS = { v7: 20, v6: 20, v5: 8 };
const levelsOf = (version) => {
  if (!(version in LEVELS)) throw new Error('Unknown pool generation: ' + version);
  return LEVELS[version];
};

// How many of its latest roots a pool remembers: a proof made against an older root is refused ("Unknown root").
const ROOT_HISTORY = { v7: 100, v6: 100, v5: 30 };

// The relayer and its fee are public inputs of the proof from V6 on (same interface in V7).
const feeVersion = (version) => version === 'v6' || version === 'v7';

// Circuit of each generation: V7 -> withdraw_v5, V6 -> withdraw_v4, V5 -> withdraw_v3.
const CIRCUIT_OF = { v7: 'withdraw_v5', v6: 'withdraw_v4', v5: 'withdraw_v3' };
const circuitOf = (version) => {
  if (!(version in CIRCUIT_OF)) throw new Error('Unknown pool generation: ' + version);
  return CIRCUIT_OF[version];
};

// Public signals of each withdrawal circuit, in order (what exportSolidityCallData returns as `pubSignals`).
const PUBLIC_SIGNALS = {
  withdraw_v5: ['root', 'nullifierHash', 'recipient', 'relayer', 'fee'],
  withdraw_v4: ['root', 'nullifierHash', 'recipient', 'relayer', 'fee'],
  withdraw_v3: ['root', 'nullifierHash', 'recipient'],
  disclose: ['commitment', 'disclosureTag', 'auditorNonce'],
};

// Circuit artifacts, pinned to a fixed commit and checked against their SHA-256 before use (same as the demo).
const CIRCUIT_COMMIT = '129a4c0d38af03b0ad2db59e8ad01823e813ed77';
const CIRCUIT_BASE = 'https://cdn.jsdelivr.net/gh/latheon-network/latheon@' + CIRCUIT_COMMIT + '/circuits/build/';
const circ = (dir, wasmSha256, zkeySha256) => ({
  dir, wasm: dir + '.wasm', zkey: dir + '_final.zkey',
  wasmUrl: CIRCUIT_BASE + dir + '/' + dir + '.wasm', zkeyUrl: CIRCUIT_BASE + dir + '/' + dir + '_final.zkey',
  wasmSha256, zkeySha256,
});
const CIRCUITS = {
  withdraw_v5: circ('withdraw_v5', '9d8d188ebf8d196cfb3ace1c3c808ff89563bbb6fae9f909da5495ae4b93d667', '5466c0421bbdeafa85e2efcbf6e292cdb0b876e5ae21ab3fe5e14d84bd1397de'),
  withdraw_v4: circ('withdraw_v4', 'ba1cf9034e40a2cffa6ee3039c014b9630886c9153d64816099c460c0fad9701', 'f9514eaa4881a68c5d8be0d6f5088c5ff23beec4085570acba89e0b97ce3deed'),
  withdraw_v3: circ('withdraw_v3', '20aea3d282af1dbdf46206219c25511b9446e88a04e1068cbdd89d76ee7c6623', '6e2fee21fefb1ec06db5ebf0d1fa588b0f8e3a92427894b32bf3521a904dce94'),
  disclose: circ('disclose', '479e1ae4350000257c4dddfc1a7f19017dd361d1bcdd9ff11ed3fcf7b896ddfe', 'da2ef269e48c724d6dadc2ac2ed7f755a937c65640cac389d4805f25c71e18ea'),
};

// Router limits (contracts/LatheonDistributionPoolV7Native.sol).
const POOL_COUNT = 4;
const MAX_NOTES = 32;         // notes in one router deposit
const MAX_WITHDRAWALS = 16;   // notes in one withdrawMany

// ---------- ABIs ----------
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];
const EVENT_ABI = ['event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp)'];
const POOL_COMMON_ABI = [
  'function deposit(uint256 commitment) payable',
  'function token() view returns (address)',
  'function DENOMINATION() view returns (uint256)',
  'function LEVELS() view returns (uint256)',
  'function nextIndex() view returns (uint32)',
  'function zeros(uint256) view returns (uint256)',
  'function isKnownRoot(uint256) view returns (bool)',
  'function nullifierHashes(uint256) view returns (bool)',
];
const POOL_ABI = {
  // V7 (and V6): recipient, relayer and fee bound into the proof; five public signals.
  v7: POOL_COMMON_ABI.concat([
    'function withdraw(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256 root, uint256 nullifierHash, address recipient, address relayer, uint256 fee)',
    'event Withdrawal(address indexed to, uint256 nullifierHash, address indexed relayer, uint256 fee, uint256 timestamp)',
  ], EVENT_ABI),
  // V5: the recipient is bound into the proof; three public signals.
  v5: POOL_COMMON_ABI.concat([
    'function withdraw(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256 root, uint256 nullifierHash, address recipient)',
    'event Withdrawal(address indexed to, uint256 nullifierHash, uint256 timestamp)',
  ], EVENT_ABI),
};
POOL_ABI.v6 = POOL_ABI.v7;   // V7 = V6 interface (withdraw_v5 only fixes the circuit, not the ABI)

const VERIFIER_ABI = {
  v7: ['function verifyProof(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256[5] _pubSignals) view returns (bool)'],
  v5: ['function verifyProof(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256[3] _pubSignals) view returns (bool)'],
  disclose: ['function verifyProof(uint256[2] _pA, uint256[2][2] _pB, uint256[2] _pC, uint256[3] _pubSignals) view returns (bool)'],
};
VERIFIER_ABI.v6 = VERIFIER_ABI.v7;

const ROUTER_COMMON_ABI = [
  'function deposit(uint256 amount, uint256[] commitments) payable',
  'function split(uint256 amount) view returns (uint256[4] counts, uint256 total)',
  'function pools(uint256) view returns (address)',
  'function denominations(uint256) view returns (uint256)',
  'function token() view returns (address)',
  'function MAX_NOTES() view returns (uint256)',
  'function MAX_WITHDRAWALS() view returns (uint256)',
  'event Distributed(address indexed depositor, uint256 amount, uint256 notes)',
  'event WithdrawnMany(address indexed recipient, uint256 notes)',
];
const ROUTER_ABI = {
  // V7 (and V6) routers: each item carries its fee and withdrawMany names the relayer (both bound into the proofs).
  v7: ROUTER_COMMON_ABI.concat(['function withdrawMany((uint256 pool, uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256 root, uint256 nullifierHash, uint256 fee)[] items, address recipient, address relayer)']),
  v5: ROUTER_COMMON_ABI.concat(['function withdrawMany((uint256 pool, uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256 root, uint256 nullifierHash)[] items, address recipient)']),
};
ROUTER_ABI.v6 = ROUTER_ABI.v7;

module.exports = {
  FIELD_SIZE, VERSIONS, CURRENT_VERSION, LEVELS, levelsOf, ROOT_HISTORY, feeVersion, CIRCUIT_OF, circuitOf, PUBLIC_SIGNALS,
  CIRCUIT_COMMIT, CIRCUIT_BASE, CIRCUITS, POOL_COUNT, MAX_NOTES, MAX_WITHDRAWALS,
  ERC20_ABI, EVENT_ABI, POOL_ABI, VERIFIER_ABI, ROUTER_ABI,
};
