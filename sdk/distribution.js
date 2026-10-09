'use strict';
/*
 * Client-side mirror of the distribution pool's split rule (contracts/LatheonDistributionPool.sol, split()).
 *
 * The contract is the source of truth: `await dist.split(amount)` returns the same counts. This mirror lets a
 * wallet know BEFORE any transaction how many notes (and therefore how many key pairs / commitments) a deposit
 * needs, and in which order the contract expects the commitments. test/distribution checks that the two agree.
 *
 * All amounts are BigInt in the token's base units (for an 18-decimals token, 1 token = 10n ** 18n).
 */

// distribution-core:begin
/**
 * Canonical greedy split.
 * @param {bigint} amount          amount in base units
 * @param {bigint[]} denominations pool denominations, largest first, each dividing the previous one
 * @returns {{counts: bigint[], total: bigint}}
 */
function canonicalSplit(amount, denominations) {
  if (typeof amount !== 'bigint') throw new TypeError('amount must be a BigInt');
  if (amount <= 0n) throw new Error('Zero amount');
  const last = denominations[denominations.length - 1];
  if (amount % last !== 0n) throw new Error('Amount is not a multiple of the smallest denomination');
  let rest = amount;
  let total = 0n;
  const counts = denominations.map((d) => {
    const c = rest / d;
    rest -= c * d;
    total += c;
    return c;
  });
  return { counts, total };
}

/**
 * The denomination of each note, in the order the contract expects the commitments:
 * all notes of the largest pool first. For counts [1n, 1n, 0n, 3n] and denominations [100n, 50n, 10n, 1n]
 * this is [100n, 50n, 1n, 1n, 1n].
 */
function noteOrder(counts, denominations) {
  const order = [];
  counts.forEach((c, i) => { for (let n = 0n; n < c; n++) order.push(denominations[i]); });
  return order;
}

/** Round an amount DOWN to a multiple of `step` (decision D3: the remainder stays in the user's wallet). */
function roundDown(amount, step) {
  if (step <= 0n) throw new Error('step must be positive');
  return amount - (amount % step);
}


// ---------------------------------------------------------------------------------------------------------------
// Wallet side: one master key for all the notes of a deposit, and picking notes for a withdrawal by amount.
// (The demo, demo/index.html, carries a verbatim copy of the block between the two "distribution-core" markers;
//  test/distribution/wallet.js checks that the copy and this file have not drifted apart.)
// ---------------------------------------------------------------------------------------------------------------
/** Highest note index looked at when a master key is used to find its notes (a deposit has at most 32 notes). */
const MASTER_SCAN_LIMIT = 64;

/**
 * Keys of note number `index` of a master key. Two Poseidon hashes, so the same master key gives different notes on
 * different chains and for different indices, and knowing one note's keys reveals nothing about the master key.
 * @param {(inputs: bigint[]) => bigint} poseidon4  Poseidon over four inputs (poseidon-lite: poseidon4)
 */
function deriveNoteKeys(poseidon4, master, chainId, index) {
  const m = BigInt(master), c = BigInt(chainId), i = BigInt(index);
  return { spendKey: poseidon4([m, c, i, 1n]), viewKey: poseidon4([m, c, i, 2n]) };
}

/** `latheon-master:<chainId>:<router>:<master>`: names the network and the router, so nothing has to be remembered. */
function formatMasterKey(chainId, router, master) {
  return 'latheon-master:' + chainId + ':' + router + ':' + BigInt(master).toString();
}

/** Inverse of formatMasterKey. Throws on anything that is not a master key. */
function parseMasterKey(text) {
  const parts = String(text).trim().split(':');
  if (parts.length !== 4 || parts[0] !== 'latheon-master') throw new Error('Not a master key');
  if (!/^[0-9]+$/.test(parts[1]) || !/^0x[0-9a-fA-F]{40}$/.test(parts[2]) || !/^[0-9]+$/.test(parts[3])) throw new Error('Not a master key');
  return { chainId: Number(parts[1]), router: parts[2], master: BigInt(parts[3]) };
}

/**
 * How a deposit of `amount` is split. mode 'exact': the amount must be a multiple of the smallest denomination.
 * mode 'round': it is first rounded DOWN to a multiple of `step`, and the remainder stays in the wallet (decision D3).
 * @returns {{amount: bigint, remainder: bigint, counts: bigint[], total: bigint, order: bigint[]}}
 */
function planDeposit(amount, denominations, mode, step) {
  let use = amount;
  if (mode === 'round') use = roundDown(amount, step);
  if (use <= 0n) throw new Error('Zero amount');
  const { counts, total } = canonicalSplit(use, denominations);
  return { amount: use, remainder: amount - use, counts, total, order: noteOrder(counts, denominations) };
}

/**
 * Pick notes that add up to EXACTLY `target`, using as few notes as possible (fewer notes, fewer proofs, less
 * gas, and fewer notes tied together). There is no change: a note is spent whole, so only sums of whole notes work.
 * @param {{value: number}[]} notes   unspent notes; value is a whole number of the smallest unit
 * @param {number} target             whole number of the smallest unit
 * @returns {{chosen: object[]|null, nearest: number}} chosen is null when no exact sum exists; `nearest` is then the
 *          largest reachable sum below the target (equal to the target when chosen is not null)
 */
function selectNotes(notes, target) {
  if (!Number.isSafeInteger(target) || target <= 0) throw new Error('Bad target');
  if (target > 1e6) throw new Error('Target too large');
  const n = notes.length, W = target + 1, INF = 255;
  const best = new Uint8Array((n + 1) * W).fill(INF);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    const v = notes[i].value, row = i * W, nxt = (i + 1) * W;
    for (let s = 0; s < W; s++) {
      let b = best[row + s];
      if (s >= v && best[row + s - v] !== INF && best[row + s - v] + 1 < b) b = best[row + s - v] + 1;
      best[nxt + s] = b;
    }
  }
  let reach = target;
  while (reach > 0 && best[n * W + reach] === INF) reach--;
  if (reach !== target) return { chosen: null, nearest: reach };
  const chosen = [];
  for (let i = n, s = target; i > 0; i--) {
    const v = notes[i - 1].value;
    if (best[(i - 1) * W + s] !== best[i * W + s]) { chosen.push(notes[i - 1]); s -= v; }
  }
  return { chosen: chosen.reverse(), nearest: target };
}
// distribution-core:end

module.exports = { canonicalSplit, noteOrder, roundDown, MASTER_SCAN_LIMIT, deriveNoteKeys, formatMasterKey, parseMasterKey, planDeposit, selectNotes };
