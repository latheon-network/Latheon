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

module.exports = { canonicalSplit, noteOrder, roundDown };
