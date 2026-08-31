const { ethers } = require("ethers");
const { SEPOLIA, FAUCET_ABI } = require("./constants");

/**
 * Claims test LTH from the faucet. Reverts on-chain (and this function
 * throws) if called again within 24 hours from the same address.
 *
 * @param {ethers.Signer} signer
 * @param {string} [faucetAddress]
 */
async function claimFromFaucet(signer, faucetAddress = SEPOLIA.faucet) {
  const faucet = new ethers.Contract(faucetAddress, FAUCET_ABI, signer);
  const tx = await faucet.claim();
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/**
 * Checks how many seconds remain before `address` can claim again.
 * Returns 0 if they can claim right now.
 *
 * @param {ethers.Provider} provider
 * @param {string} address
 * @param {string} [faucetAddress]
 */
async function timeUntilNextClaim(provider, address, faucetAddress = SEPOLIA.faucet) {
  const faucet = new ethers.Contract(faucetAddress, FAUCET_ABI, provider);
  const seconds = await faucet.timeUntilNextClaim(address);
  return Number(seconds);
}

module.exports = { claimFromFaucet, timeUntilNextClaim };
