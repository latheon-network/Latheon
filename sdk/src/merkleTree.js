const { ethers } = require("ethers");
const { POOL_ABI, LEVELS } = require("./constants");
const { hash2, computeZeroCascade } = require("./poseidon");

/**
 * Fetches every Deposit event ever emitted by the pool, in leaf order.
 * This is what lets the SDK reconstruct the exact tree state the contract
 * has on-chain, without needing any off-chain database — the blockchain
 * itself is the source of truth.
 *
 * @param {ethers.Provider} provider
 * @param {string} poolAddress
 * @returns {Promise<Array<{commitment: bigint, leafIndex: number}>>}
 */
async function fetchDeposits(provider, poolAddress) {
  const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);
  const filter = pool.filters.Deposit();

  const latestBlock = await provider.getBlockNumber();
  // NOTE: many public RPC providers cap eth_getLogs at a 10,000-block range
  // per request. Querying from block 0 fails on Sepolia once the chain has
  // moved far enough past deployment — this bit us in the demo app first.
  // Chunking avoids it. If you know your pool's exact deployment block,
  // pass it in instead of 0 for a faster first sync.
  const startBlock = 0;
  const CHUNK_SIZE = 9000;

  let allEvents = [];
  for (let from = startBlock; from <= latestBlock; from += CHUNK_SIZE) {
    const to = Math.min(from + CHUNK_SIZE - 1, latestBlock);
    const events = await pool.queryFilter(filter, from, to);
    allEvents = allEvents.concat(events);
  }

  const deposits = allEvents.map((e) => ({
    commitment: BigInt(e.args.commitment),
    leafIndex: Number(e.args.leafIndex),
  }));
  deposits.sort((a, b) => a.leafIndex - b.leafIndex);
  return deposits;
}

/**
 * Builds the full Merkle tree (all levels, not just the root) from a list
 * of leaves in index order. Unfilled positions use the same zero-cascade
 * convention as the on-chain contract.
 *
 * This is a "rebuild from scratch" approach rather than an incremental one
 * — simpler to reason about and get right, and it produces the exact same
 * root as the contract's incremental on-chain insertion, since both are
 * standard binary Merkle trees over the same leaves with the same
 * zero-padding rule. (Verified against real on-chain data — see
 * verify-poseidon.js in this package's test output / commit history.)
 *
 * @param {bigint[]} leaves - commitments in leaf-index order
 * @param {bigint[]} zeros - output of computeZeroCascade()
 * @param {number} levels
 * @returns {Promise<bigint[][]>} treeLevels[0] = leaves, treeLevels[levels][0] = root
 */
async function buildTreeLevels(leaves, zeros, levels = LEVELS) {
  const treeLevels = [leaves.slice()];
  let current = leaves.slice();
  for (let d = 0; d < levels; d++) {
    const next = [];
    const size = Math.ceil(current.length / 2) || 1;
    for (let i = 0; i < size; i++) {
      const left = current[2 * i] !== undefined ? current[2 * i] : zeros[d];
      const right = current[2 * i + 1] !== undefined ? current[2 * i + 1] : zeros[d];
      next.push(await hash2(left, right));
    }
    treeLevels.push(next);
    current = next;
  }
  return treeLevels;
}

/**
 * Extracts the Merkle proof (sibling path) for a specific leaf index from
 * an already-built tree. This is the pathElements/pathIndices pair that
 * circuits/withdraw.circom expects as private inputs.
 *
 * @param {bigint[][]} treeLevels - output of buildTreeLevels()
 * @param {number} leafIndex
 * @param {bigint[]} zeros
 * @param {number} levels
 */
function getMerklePath(treeLevels, leafIndex, zeros, levels = LEVELS) {
  const pathElements = [];
  const pathIndices = [];
  let idx = leafIndex;
  for (let d = 0; d < levels; d++) {
    const level = treeLevels[d];
    const isRight = idx % 2 === 1;
    const siblingIndex = isRight ? idx - 1 : idx + 1;
    const sibling = level[siblingIndex] !== undefined ? level[siblingIndex] : zeros[d];
    pathElements.push(sibling);
    pathIndices.push(isRight ? 1 : 0);
    idx = Math.floor(idx / 2);
  }
  const root = treeLevels[levels][0];
  return { pathElements, pathIndices, root };
}

/**
 * High-level convenience function: given your own commitment, fetches all
 * deposits from chain, finds your leaf, and returns everything needed to
 * generate a withdrawal proof (pathElements, pathIndices, root).
 *
 * Throws if the commitment isn't found among on-chain deposits — usually
 * means either the deposit transaction hasn't confirmed yet, or the wrong
 * secret was used to compute the commitment.
 *
 * @param {ethers.Provider} provider
 * @param {string} poolAddress
 * @param {bigint} commitment - your own commitment, from computeCommitment(secret)
 */
async function getProofInputsForCommitment(provider, poolAddress, commitment) {
  const deposits = await fetchDeposits(provider, poolAddress);
  const mine = deposits.find((d) => d.commitment === commitment);
  if (!mine) {
    throw new Error(
      "Commitment not found among on-chain deposits. Either the deposit " +
      "transaction hasn't confirmed yet, or this secret doesn't match a " +
      "deposit that was actually made."
    );
  }

  const zeros = await computeZeroCascade();
  const leaves = deposits.map((d) => d.commitment);
  const treeLevels = await buildTreeLevels(leaves, zeros);
  const { pathElements, pathIndices, root } = getMerklePath(treeLevels, mine.leafIndex, zeros);

  return { leafIndex: mine.leafIndex, pathElements, pathIndices, root };
}

module.exports = { fetchDeposits, buildTreeLevels, getMerklePath, getProofInputsForCommitment };
