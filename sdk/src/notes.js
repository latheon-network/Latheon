'use strict';
/*
 * Notes and master keys.
 *
 * A note is one deposit in one fixed pool. Its text names the network and the pool, so nothing else has to be remembered:
 *   latheon-v5:<chainId>:<poolAddress>:<spendKey>:<viewKey>
 * (the format is unchanged since V5; V6 and V7 notes look the same). The spendKey alone can spend the note; the viewKey
 * is needed with it to prove ownership (commitment) and for disclosures.
 *
 * A master key stands for all the notes of one router deposit (up to 32):
 *   latheon-master:<chainId>:<routerAddress>:<master>
 * Note i of a master key has spendKey = Poseidon4(master, chainId, i, 1), viewKey = Poseidon4(master, chainId, i, 2)
 * (sdk/distribution.js, the code the demo carries verbatim).
 */
const { getAddress, isAddress } = require('ethers');
const { poseidon4 } = require('poseidon-lite');
const dist = require('../distribution');
const { computeCommitment, computeNullifierHash, randomFieldElement, isFieldElement } = require('./poseidon');

const NOTE_PREFIX = 'latheon-v5';

/** The text of a note for `pool` (a registry pool or anything with `address` and `net.chainId` / `chainId`). */
function encodeNote(pool, spendKey, viewKey) {
  const chainId = pool.net ? pool.net.chainId : pool.chainId;
  if (!Number.isInteger(chainId)) throw new Error('encodeNote: pool has no chainId');
  if (!isFieldElement(BigInt(spendKey)) || !isFieldElement(BigInt(viewKey))) throw new Error('encodeNote: keys must be field elements');
  return `${NOTE_PREFIX}:${chainId}:${getAddress(pool.address)}:${BigInt(spendKey)}:${BigInt(viewKey)}`;
}

/**
 * Parses a note. Throws on a master key (use parseMasterKey), a legacy V4 note (not supported by this SDK) or junk.
 * @returns {{chainId: number, address: string, spendKey: bigint, viewKey: bigint}}
 */
function decodeNote(text) {
  const parts = String(text).trim().split(':');
  if (parts[0] === 'latheon-master') throw new Error('This is a master key, not a note: use parseMasterKey / findNotes');
  if (parts[0] === 'latheon-v4-note') throw new Error('Legacy V4 notes are not supported by this SDK; use demo/index.html');
  if (parts[0] !== NOTE_PREFIX || parts.length !== 5) throw new Error('Unrecognised note format. Expected latheon-v5:<chainId>:<pool>:<spendKey>:<viewKey>');
  if (!/^[0-9]+$/.test(parts[1]) || !/^[0-9]+$/.test(parts[3]) || !/^[0-9]+$/.test(parts[4])) throw new Error('Unrecognised note format');
  if (!isAddress(parts[2])) throw new Error('Invalid pool address inside the note');
  const spendKey = BigInt(parts[3]), viewKey = BigInt(parts[4]);
  if (!isFieldElement(spendKey) || !isFieldElement(viewKey)) throw new Error('Note keys are not field elements');
  return { chainId: Number(parts[1]), address: getAddress(parts[2]), spendKey, viewKey };
}

/** True when the text parses as a note (false for master keys and junk). */
function isNote(text) { try { decodeNote(text); return true; } catch (e) { return false; } }
/** True when the text parses as a master key. */
function isMasterKey(text) { try { dist.parseMasterKey(text); return true; } catch (e) { return false; } }

/**
 * A fresh note for `pool`: random spendKey and viewKey, their commitment and the note text.
 * Keep the text: it is the only way to withdraw the deposit. There is no recovery.
 */
function generateNote(pool, keys = {}) {
  const spendKey = keys.spendKey !== undefined ? BigInt(keys.spendKey) : randomFieldElement();
  const viewKey = keys.viewKey !== undefined ? BigInt(keys.viewKey) : randomFieldElement();
  return { spendKey, viewKey, commitment: computeCommitment(spendKey, viewKey), nullifierHash: computeNullifierHash(spendKey), note: encodeNote(pool, spendKey, viewKey) };
}

/** Keys of note number `index` of a master key on chain `chainId` (sdk/distribution.js, with poseidon-lite bound). */
function deriveNoteKeys(master, chainId, index) { return dist.deriveNoteKeys(poseidon4, master, chainId, index); }

/**
 * Keys, commitment and nullifier of notes 0 .. count-1 of a master key (what a router deposit registers, in order).
 */
function deriveNotes(master, chainId, count) {
  const out = [];
  for (let i = 0; i < Number(count); i++) {
    const k = deriveNoteKeys(master, chainId, i);
    out.push({ index: i, spendKey: k.spendKey, viewKey: k.viewKey, commitment: computeCommitment(k.spendKey, k.viewKey), nullifierHash: computeNullifierHash(k.spendKey) });
  }
  return out;
}

module.exports = {
  NOTE_PREFIX, encodeNote, decodeNote, isNote, isMasterKey, generateNote,
  deriveNoteKeys, deriveNotes,
  formatMasterKey: dist.formatMasterKey, parseMasterKey: dist.parseMasterKey, MASTER_SCAN_LIMIT: dist.MASTER_SCAN_LIMIT,
};
