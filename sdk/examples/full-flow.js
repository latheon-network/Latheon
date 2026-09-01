/**
 * Full example: deposit, then later withdraw, using the SDK end to end.
 *
 * This file is a reference for developers — running it for real requires:
 *   1. A Sepolia RPC URL (e.g. from Alchemy, Infura, or a public endpoint)
 *   2. A private key with some Sepolia ETH (for gas) and Sepolia LTH
 *      (from the faucet — see claimFromFaucet below)
 *   3. A generated zero-knowledge proof for the withdrawal step, produced
 *      separately via tools/zk-toolkit.html — this SDK does not generate
 *      proofs itself (see README.md for why).
 *
 * Usage:
 *   SEPOLIA_RPC_URL=... PRIVATE_KEY=... node examples/full-flow.js
 */

const { ethers } = require("ethers");
const latheon = require("../src/index");

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    console.log("This is a reference example, not meant to run without setup.");
    console.log("Set SEPOLIA_RPC_URL and PRIVATE_KEY environment variables to actually run it.");
    console.log("See the comments in this file for what each step does.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);

  console.log("Using address:", await signer.getAddress());

  // --- Step 0: make sure you have test LTH ---
  const secondsUntilClaim = await latheon.timeUntilNextClaim(provider, await signer.getAddress());
  if (secondsUntilClaim === 0) {
    console.log("Claiming test LTH from the faucet...");
    const { txHash } = await latheon.claimFromFaucet(signer);
    console.log("Claimed. Tx:", txHash);
  } else {
    console.log(`Faucet cooldown active — ${secondsUntilClaim}s remaining. Skipping claim.`);
  }

  // --- Step 1: deposit ---
  console.log("Depositing 100 LTH into the shielded pool...");
  const { secret, commitment, txHash: depositTxHash } = await latheon.deposit(signer);
  console.log("Deposited. Tx:", depositTxHash);
  console.log("Secret (SAVE THIS — it's the only way to withdraw later):", secret.toString());
  console.log("Commitment:", commitment.toString());

  // --- Step 2: reconstruct the Merkle proof inputs for this deposit ---
  // In a real application, this would likely happen later — possibly much
  // later, possibly from a different session entirely, using only the
  // saved secret. We re-derive the commitment from the secret to show
  // that flow explicitly:
  const recoveredCommitment = await latheon.computeCommitment(secret);
  console.log("\nReconstructing Merkle proof inputs from the saved secret...");
  const { leafIndex, pathElements, pathIndices, root } =
    await latheon.getProofInputsForCommitment(provider, latheon.SEPOLIA.pool, recoveredCommitment);

  console.log("Leaf index:", leafIndex);
  console.log("Current root:", root.toString());
  console.log("Path elements:", pathElements.map(String));
  console.log("Path indices:", pathIndices);

  // --- Step 3: generate the actual proof (NOT done by this SDK) ---
  console.log("\n--- Next step, outside this SDK ---");
  console.log("Feed these values into circuits/withdraw.circom as INPUT:");
  console.log(JSON.stringify({
    root: root.toString(),
    nullifierHash: (await latheon.computeNullifierHash(secret)).toString(),
    secret: secret.toString(),
    pathElements: pathElements.map(String),
    pathIndices: pathIndices.map(String),
  }, null, 2));
  console.log("\nGenerate the proof via tools/zk-toolkit.html, then call latheon.withdraw(...)");
  console.log("with the resulting proof and [root, nullifierHash] as publicSignals.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
