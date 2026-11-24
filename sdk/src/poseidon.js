'use strict';
/*
 * Poseidon hashes exactly as the circuits and PoseidonT3.sol compute them (poseidon-lite, the same library the demo
 * uses; its output equals circomlibjs's). Everything here is synchronous and takes/returns BigInt.
 */
const { poseidon2, poseidon3, poseidon4 } = require('poseidon-lite');
const { randomBytes, hexlify, keccak256, toUtf8Bytes, AbiCoder, getAddress } = require('ethers');
const { FIELD_SIZE, levelsOf } = require('./constants');

/** Poseidon(a, b): PoseidonT3.hash([a, b]) on chain. */
function hash2(a, b) { return poseidon2([BigInt(a), BigInt(b)]); }

/** Poseidon over four inputs (master-key note derivation, sdk/distribution.js deriveNoteKeys). */
function hash4(a, b, c, d) { return poseidon4([BigInt(a), BigInt(b), BigInt(c), BigInt(d)]); }

/**
 * Commitment of a note (V4 and later, including V7): Poseidon(Poseidon(spendKey, viewKey), 0).
 * Matches circuits/withdraw_v5.circom (innerHasher, commitmentHasher).
 */
function computeCommitment(spendKey, viewKey) { return hash2(hash2(spendKey, viewKey), 0n); }

/** Nullifier hash of a note: Poseidon(spendKey, 1). Recorded on chain when the note is spent. */
function computeNullifierHash(spendKey) { return hash2(spendKey, 1n); }

/** Disclosure tag: Poseidon(viewKey, auditorNonce), a public input of the disclose circuit. */
function computeDisclosureTag(viewKey, auditorNonce) { return hash2(viewKey, auditorNonce); }

/**
 * The "empty subtree" cascade every pool uses for unfilled branches: zeros[0] = 0, zeros[i+1] = Poseidon(zeros[i], zeros[i]).
 * @param {number|string} levels  tree depth (20 for V6/V7, 8 for V5) or a generation name ('v7')
 * @returns {bigint[]} levels + 1 values; zeros[levels] is the root of an empty tree
 */
function computeZeroCascade(levels = 20) {
  const depth = typeof levels === 'string' ? levelsOf(levels) : Number(levels);
  const zeros = [0n];
  let current = 0n;
  for (let i = 0; i < depth; i++) { current = hash2(current, current); zeros.push(current); }
  return zeros;
}

/** A random field element: a fresh spendKey, viewKey or master key. */
function randomFieldElement() { return BigInt(hexlify(randomBytes(32))) % FIELD_SIZE; }

/** True when x is a BigInt inside the field (what every key, hash and signal must be). */
function isFieldElement(x) { return typeof x === 'bigint' && x >= 0n && x < FIELD_SIZE; }

// ---------- V8 (circuits/latheon_v8.circom, docs/v8-design.md) ----------
const tagOf = (s) => BigInt(keccak256(toUtf8Bytes(s))) % FIELD_SIZE;
/** Domain tags of the V8 hashes: keccak256(string) mod p. */
const TAG_V8 = Object.freeze({ COMMIT: tagOf('latheon.v8.commit'), NULL: tagOf('latheon.v8.null'), DISC: tagOf('latheon.v8.disc') });
const abi = AbiCoder.defaultAbiCoder();

/** V8 commitment: Poseidon(TAG_COMMIT, spendKey, viewKey). Does not depend on the pool. */
function computeCommitmentV8(spendKey, viewKey) { return poseidon3([TAG_V8.COMMIT, BigInt(spendKey), BigInt(viewKey)]); }
/** V8 nullifier: Poseidon(TAG_NULL, spendKey, ctx) with ctx the pool's context (poolContext). */
function computeNullifierHashV8(spendKey, ctx) { return poseidon3([TAG_V8.NULL, BigInt(spendKey), BigInt(ctx)]); }
/** V8 disclosure tag: Poseidon(TAG_DISC, viewKey, auditorNonce). */
function computeDisclosureTagV8(viewKey, auditorNonce) { return poseidon3([TAG_V8.DISC, BigInt(viewKey), BigInt(auditorNonce)]); }
/** A V8 pool's context: keccak256(abi.encode("latheon.v8.ctx", chainId, pool)) mod p (what the pool's ctx() returns). */
function poolContext(chainId, poolAddress) { return BigInt(keccak256(abi.encode(['string', 'uint256', 'address'], ['latheon.v8.ctx', BigInt(chainId), getAddress(poolAddress)]))) % FIELD_SIZE; }
/** keccak256(abi.encode(recipient, relayer, fee, paymentRef, destChainId)) mod p (what the pool's extDataHash() returns). */
function computeExtDataHash(ext) { return BigInt(keccak256(abi.encode(['address', 'address', 'uint256', 'bytes32', 'uint256'], [getAddress(ext.recipient), getAddress(ext.relayer), BigInt(ext.fee), ext.paymentRef, BigInt(ext.destChainId)]))) % FIELD_SIZE; }
/** 32 random bytes as 0x-hex: the payment reference of a withdrawal that has none (so all withdrawals look alike). */
function randomPaymentRef() { return hexlify(randomBytes(32)); }

/** Commitment of a note in a pool of `version`. */
function commitmentFor(version, spendKey, viewKey) { return version === 'v8' ? computeCommitmentV8(spendKey, viewKey) : computeCommitment(spendKey, viewKey); }
/** Nullifier hash of a note in `pool` (V8 needs the pool's address and chain, earlier generations do not). */
function nullifierFor(pool, spendKey) {
  if (pool.version !== 'v8') return computeNullifierHash(spendKey);
  const chainId = pool.net ? pool.net.chainId : pool.chainId;
  return computeNullifierHashV8(spendKey, poolContext(chainId, pool.address));
}
/** The context of a registry pool (V8). */
function contextOf(pool) { return poolContext(pool.net ? pool.net.chainId : pool.chainId, pool.address); }

module.exports = {
  hash2, hash4, computeCommitment, computeNullifierHash, computeDisclosureTag, computeZeroCascade, randomFieldElement, isFieldElement,
  TAG_V8, computeCommitmentV8, computeNullifierHashV8, computeDisclosureTagV8, poolContext, contextOf, computeExtDataHash, randomPaymentRef, commitmentFor, nullifierFor,
};
