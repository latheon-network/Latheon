const circomlibjs = require("circomlibjs");
const { LEVELS } = require("./constants");

let poseidonInstance = null;

/**
 * Poseidon(2) hasher, matching the exact hash used on-chain by PoseidonT3.sol
 * and by circuits/withdraw.circom. Lazily initialized — circomlibjs's
 * Poseidon build is async (it compiles a WASM circuit internally).
 */
async function getPoseidon() {
  if (!poseidonInstance) {
    poseidonInstance = await circomlibjs.buildPoseidon();
  }
  return poseidonInstance;
}

/** Poseidon(a, b) -> BigInt, matching PoseidonT3.hash([a, b]) on-chain. */
async function hash2(a, b) {
  const poseidon = await getPoseidon();
  return BigInt(poseidon.F.toString(poseidon([BigInt(a), BigInt(b)])));
}

/**
 * Commitment for a secret, matching circuits/withdraw.circom:
 *   commitmentHasher.inputs[0] <== secret;
 *   commitmentHasher.inputs[1] <== 0;
 */
async function computeCommitment(secret) {
  return hash2(BigInt(secret), 0n);
}

/**
 * Nullifier hash for a secret, matching circuits/withdraw.circom:
 *   nullifierHasher.inputs[0] <== secret;
 *   nullifierHasher.inputs[1] <== 1;
 */
async function computeNullifierHash(secret) {
  return hash2(BigInt(secret), 1n);
}

/**
 * The "empty subtree" cascade used by LatheonShieldedPoolV3 for unfilled
 * branches: zeros[0] = 0, zeros[i+1] = Poseidon(zeros[i], zeros[i]).
 * Computed fresh here rather than hardcoded, for the same reason the
 * on-chain contract computes it in its constructor instead of using a
 * copied constant — verified independently against on-chain values in
 * this SDK's test suite.
 */
async function computeZeroCascade(levels = LEVELS) {
  const zeros = [0n];
  let current = 0n;
  for (let i = 0; i < levels; i++) {
    current = await hash2(current, current);
    zeros.push(current);
  }
  return zeros;
}

module.exports = { hash2, computeCommitment, computeNullifierHash, computeZeroCascade, getPoseidon };
