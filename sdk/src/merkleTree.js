'use strict';
/*
 * Reading a pool's deposits and rebuilding its Merkle tree, for the path a withdrawal proof needs.
 *
 * The chain is the source of truth: every Deposit(commitment, leafIndex, timestamp) event of the pool, in leaf order.
 * The rebuilt tree is a plain binary Poseidon tree over the leaves with the same zero-padding rule as the contract's
 * incremental insertion, so its root equals the pool's current root (checked with isKnownRoot before proving).
 */
const { Contract } = require('ethers');
const { POOL_ABI, levelsOf } = require('./constants');
const { hash2, computeZeroCascade } = require('./poseidon');

const versionOf = (pool) => (pool && pool.version) || 'v7';

/**
 * Every Deposit event of a pool, sorted by leaf index, checked for completeness against nextIndex().
 *
 * Asks for the whole block range in one request and splits a range the endpoint refuses (log-range caps, timeouts)
 * in halves, down to `minSpan` blocks, like the demo. With a provider that keeps full history this is one request.
 *
 * @param {import('ethers').Provider} provider
 * @param {object} pool          registry pool (address, version, startBlock), or { address, version?, startBlock? }
 * @param {object} [opts]        { fromBlock, toBlock, minBlock, minSpan = 1000, parallel = 4, log }
 *   minBlock: scan at least up to this block (pass the deposit's receipt.blockNumber right after depositing)
 * @returns {Promise<Array<{commitment: bigint, leafIndex: number, timestamp: number}>>}
 */
async function fetchDeposits(provider, pool, opts = {}) {
  const contract = new Contract(pool.address, POOL_ABI[versionOf(pool)], provider);
  const filter = contract.filters.Deposit();
  let toBlock = opts.toBlock !== undefined ? Number(opts.toBlock) : Number(await provider.getBlockNumber());
  // Right after a deposit, a node can still report the block before it as latest (seen on the Arbitrum Orbit test
  // chain): the scan and nextIndex() then agree on the older block and the new deposit is silently missing.
  // minBlock (the deposit's receipt.blockNumber) makes the scan wait until the RPC has reached that block.
  if (opts.toBlock === undefined && opts.minBlock !== undefined) toBlock = await waitForBlock(provider, Number(opts.minBlock), toBlock, opts);
  const fromBlock = opts.fromBlock !== undefined ? Number(opts.fromBlock) : Number(pool.startBlock || 0);
  const minSpan = opts.minSpan || 1000;
  const log = opts.log || (() => {});

  const events = fromBlock <= toBlock ? await getLogsAdaptive((a, b) => contract.queryFilter(filter, a, b), fromBlock, toBlock, { minSpan, log }) : [];
  const deposits = events.map((e) => ({ commitment: BigInt(e.args.commitment), leafIndex: Number(e.args.leafIndex), timestamp: Number(e.args.timestamp) }));
  deposits.sort((a, b) => a.leafIndex - b.leafIndex);

  // Completeness: the pool itself says how many deposits it holds. A scan that missed any is refused, so no proof is
  // ever built on an incomplete tree (it would name a root the pool does not know).
  if (opts.verify !== false) {
    const onChain = Number(await contract.nextIndex({ blockTag: toBlock }));
    if (deposits.length !== onChain || deposits.some((d, i) => d.leafIndex !== i)) {
      throw new Error(`Deposit scan incomplete: found ${deposits.length} of ${onChain} deposits in pool ${pool.address} (blocks ${fromBlock}-${toBlock}). ` +
        'Check startBlock / fromBlock and that the RPC keeps event history.');
    }
  }
  return deposits;
}

/**
 * Waits until the RPC reports at least block `minBlock`. Returns the reported block number.
 * opts: { waitMs = 30000, pollMs = 500 }. Throws if the RPC is still behind after waitMs.
 */
async function waitForBlock(provider, minBlock, head, opts = {}) {
  const waitMs = opts.waitMs !== undefined ? opts.waitMs : 30000, pollMs = opts.pollMs !== undefined ? opts.pollMs : 500;
  let h = head !== undefined ? Number(head) : Number(await provider.getBlockNumber());
  const t0 = Date.now();
  while (h < minBlock) {
    if (Date.now() - t0 >= waitMs) throw new Error(`The RPC still reports block ${h}, behind block ${minBlock}; try again in a moment or use another RPC`);
    await new Promise((r) => setTimeout(r, pollMs));
    h = Number(await provider.getBlockNumber());
  }
  return h;
}

// Splits a refused range in two until it is accepted or smaller than minSpan; results keep block order.
async function getLogsAdaptive(getRange, from, to, { minSpan, log }) {
  try { return await getRange(from, to); } catch (e) {
    const span = to - from + 1;
    if (span <= minSpan || isFatal(e)) throw e;
    log(`Splitting blocks ${from}-${to} (${(e.shortMessage || e.message || String(e)).slice(0, 100)})`);
    const mid = Math.floor((from + to) / 2);
    const left = await getLogsAdaptive(getRange, from, mid, { minSpan, log });
    const right = await getLogsAdaptive(getRange, mid + 1, to, { minSpan, log });
    return left.concat(right);
  }
}
const isFatal = (e) => !!(e && ['CALL_EXCEPTION', 'INVALID_ARGUMENT', 'ACTION_REJECTED', 'BAD_DATA'].includes(e.code));

/**
 * The full tree (all levels) over `leaves` in leaf-index order; unfilled positions use the zero cascade.
 * @param {bigint[]} leaves   commitments; leaves[i] is leaf i (holes are treated as empty)
 * @param {bigint[]} zeros    computeZeroCascade(levels); the depth is zeros.length - 1
 * @returns {bigint[][]}      tree[0] = leaves, tree[depth][0] = root
 */
function buildTreeLevels(leaves, zeros) {
  const depth = zeros.length - 1;
  if (leaves.length > 2 ** depth) throw new Error(`Too many leaves for a ${depth}-level tree`);
  const tree = [leaves.slice()];
  let cur = tree[0];
  for (let d = 0; d < depth; d++) {
    const next = [];
    const size = Math.ceil(cur.length / 2) || 1;
    for (let i = 0; i < size; i++) {
      const left = cur[2 * i] !== undefined ? cur[2 * i] : zeros[d];
      const right = cur[2 * i + 1] !== undefined ? cur[2 * i + 1] : zeros[d];
      next.push(hash2(left, right));
    }
    tree.push(next);
    cur = next;
  }
  return tree;
}

/**
 * The sibling path of leaf `leafIndex` (pathElements / pathIndices as the circuit expects them) and the root.
 */
function getMerklePath(tree, leafIndex, zeros) {
  const depth = tree.length - 1;
  if (depth !== zeros.length - 1) throw new Error('tree and zeros have different depths');
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= 2 ** depth) throw new Error('leafIndex out of range');
  const pathElements = [], pathIndices = [];
  let idx = leafIndex;
  for (let d = 0; d < depth; d++) {
    const level = tree[d], isRight = idx % 2 === 1, sib = isRight ? idx - 1 : idx + 1;
    pathElements.push(level[sib] !== undefined ? level[sib] : zeros[d]);
    pathIndices.push(isRight ? 1 : 0);
    idx = Math.floor(idx / 2);
  }
  return { pathElements, pathIndices, root: tree[depth][0] };
}

/** Recomputes the root from a leaf and its path (what the circuit's MerkleTreeChecker does). */
function rootFromPath(leaf, pathElements, pathIndices) {
  let cur = BigInt(leaf);
  for (let i = 0; i < pathElements.length; i++) cur = pathIndices[i] ? hash2(pathElements[i], cur) : hash2(cur, pathElements[i]);
  return cur;
}

/**
 * Merkle proof inputs for `leafIndex` from a deposit list (no network): { pathElements, pathIndices, root, leafIndex }.
 * @param {Array<{commitment: bigint, leafIndex: number}>} deposits
 * @param {number} leafIndex
 * @param {number|string} levels   20 for V7 (default), or a generation name
 */
function merkleProofFromDeposits(deposits, leafIndex, levels = 20) {
  const zeros = computeZeroCascade(levels);
  const leaves = [];
  for (const d of deposits) leaves[d.leafIndex] = BigInt(d.commitment);
  const tree = buildTreeLevels(leaves, zeros);
  return Object.assign({ leafIndex }, getMerklePath(tree, leafIndex, zeros));
}

/**
 * Finds a commitment among a pool's deposits: { deposits, mine } (mine is undefined when the deposit is not there yet).
 */
async function findDeposit(provider, pool, commitment, opts) {
  const deposits = await fetchDeposits(provider, pool, opts);
  const c = BigInt(commitment);
  return { deposits, mine: deposits.find((d) => d.commitment === c) };
}

/**
 * Everything a withdrawal proof needs for `commitment` in `pool`, read from chain:
 * { leafIndex, pathElements, pathIndices, root, deposits }. Throws when the deposit is not on chain (not confirmed yet,
 * or the keys do not match a deposit that was actually made).
 */
async function getProofInputsForCommitment(provider, pool, commitment, opts) {
  const { deposits, mine } = await findDeposit(provider, pool, commitment, opts);
  if (!mine) throw new Error('Commitment not found among on-chain deposits of pool ' + pool.address + '. Either the deposit is not confirmed yet, or the note does not belong to this pool.');
  return Object.assign(merkleProofFromDeposits(deposits, mine.leafIndex, levelsOf(versionOf(pool))), { deposits, timestamp: mine.timestamp });
}

module.exports = { fetchDeposits, waitForBlock, buildTreeLevels, getMerklePath, rootFromPath, merkleProofFromDeposits, findDeposit, getProofInputsForCommitment };
