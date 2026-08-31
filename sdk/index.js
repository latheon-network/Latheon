const constants = require("./constants");
const poseidon = require("./poseidon");
const merkleTree = require("./merkleTree");
const pool = require("./pool");
const faucet = require("./faucet");

module.exports = {
  // Constants
  SEPOLIA: constants.SEPOLIA,
  DENOMINATION: constants.DENOMINATION,
  LEVELS: constants.LEVELS,
  TOKEN_ABI: constants.TOKEN_ABI,
  POOL_ABI: constants.POOL_ABI,
  FAUCET_ABI: constants.FAUCET_ABI,

  // Poseidon / cryptographic helpers
  computeCommitment: poseidon.computeCommitment,
  computeNullifierHash: poseidon.computeNullifierHash,
  computeZeroCascade: poseidon.computeZeroCascade,

  // Merkle tree reconstruction (for building withdrawal proof inputs)
  fetchDeposits: merkleTree.fetchDeposits,
  getProofInputsForCommitment: merkleTree.getProofInputsForCommitment,

  // High-level actions
  deposit: pool.deposit,
  withdraw: pool.withdraw,
  claimFromFaucet: faucet.claimFromFaucet,
  timeUntilNextClaim: faucet.timeUntilNextClaim,
};
