'use strict';
/*
 * Poseidon hashes exactly as the circuits and PoseidonT3.sol compute them (poseidon-lite, the same library the demo
 * uses; its output equals circomlibjs's). Everything here is synchronous and takes/returns BigInt.
 */
const { poseidon2, poseidon4 } = require('poseidon-lite');
const { randomBytes, hexlify } = require('ethers');
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

module.exports = { hash2, hash4, computeCommitment, computeNullifierHash, computeDisclosureTag, computeZeroCascade, randomFieldElement, isFieldElement };
