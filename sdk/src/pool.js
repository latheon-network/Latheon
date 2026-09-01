const { ethers } = require("ethers");
const { SEPOLIA, POOL_ABI, TOKEN_ABI, DENOMINATION } = require("./constants");
const { computeCommitment } = require("./poseidon");

/**
 * Deposits DENOMINATION (100 LTH) into the shielded pool.
 *
 * IMPORTANT: save the returned `secret` somewhere safe. It's the only way
 * to later prove you own this deposit and withdraw it. There is no
 * recovery mechanism if it's lost — this mirrors how the underlying
 * protocol actually works, the SDK doesn't (and can't) change that.
 *
 * @param {ethers.Signer} signer
 * @param {object} [opts]
 * @param {bigint} [opts.secret] - provide your own secret, or one is generated randomly
 * @param {string} [opts.poolAddress]
 * @param {string} [opts.tokenAddress]
 * @returns {Promise<{secret: bigint, commitment: bigint, txHash: string}>}
 */
async function deposit(signer, opts = {}) {
  const poolAddress = opts.poolAddress || SEPOLIA.pool;
  const tokenAddress = opts.tokenAddress || SEPOLIA.token;

  const secret = opts.secret !== undefined ? BigInt(opts.secret) : randomFieldElement();
  const commitment = await computeCommitment(secret);

  const token = new ethers.Contract(tokenAddress, TOKEN_ABI, signer);
  const pool = new ethers.Contract(poolAddress, POOL_ABI, signer);

  const approveTx = await token.approve(poolAddress, DENOMINATION);
  await approveTx.wait();

  const depositTx = await pool.deposit(commitment);
  const receipt = await depositTx.wait();

  return { secret, commitment, txHash: receipt.hash };
}

/**
 * Withdraws a deposit given a zero-knowledge proof. The proof itself must
 * be generated separately (see tools/zk-toolkit.html in the repository, or
 * your own snarkjs setup) — this SDK does not generate proofs, since that
 * requires the circuit's compiled wasm/zkey artifacts, which are much
 * larger than a JS package should bundle by default.
 *
 * @param {ethers.Signer} signer
 * @param {object} proof - { pA, pB, pC } as produced by snarkjs.groth16.exportSolidityCallData (parsed)
 * @param {[bigint, bigint]} publicSignals - [root, nullifierHash]
 * @param {string} recipient
 * @param {string} [poolAddress]
 */
async function withdraw(signer, proof, publicSignals, recipient, poolAddress = SEPOLIA.pool) {
  const pool = new ethers.Contract(poolAddress, POOL_ABI, signer);
  const tx = await pool.withdraw(proof.pA, proof.pB, proof.pC, publicSignals, recipient);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Generates a random field element suitable as a deposit secret. */
function randomFieldElement() {
  // BN254 scalar field order — matches what circomlib/snarkjs use.
  const FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const bytes = ethers.randomBytes(32);
  let value = BigInt(ethers.hexlify(bytes));
  return value % FIELD_SIZE;
}

module.exports = { deposit, withdraw, randomFieldElement };
