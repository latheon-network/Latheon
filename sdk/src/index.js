'use strict';
/*
 * @latheon/sdk: the V7 pools and router on the Latheon test chain (addresses from deployments.json).
 * V6 and V5 pools are supported for withdrawals of existing notes only; see README.md.
 */
const constants = require('./constants');
const poseidon = require('./poseidon');
const notes = require('./notes');
const deployments = require('./deployments');
const merkleTree = require('./merkleTree');
const prove = require('./prove');
const relayer = require('./relayer');
const pool = require('./pool');
const router = require('./router');
const payout = require('./payout');
const distribution = require('../distribution');

module.exports = Object.assign({},
  // constants and ABIs
  {
    FIELD_SIZE: constants.FIELD_SIZE, VERSIONS: constants.VERSIONS, CURRENT_VERSION: constants.CURRENT_VERSION,
    LEVELS: constants.LEVELS, levelsOf: constants.levelsOf, ROOT_HISTORY: constants.ROOT_HISTORY, circuitOf: constants.circuitOf, feeVersion: constants.feeVersion,
    CIRCUITS: constants.CIRCUITS, PUBLIC_SIGNALS: constants.PUBLIC_SIGNALS, MAX_NOTES: constants.MAX_NOTES, MAX_WITHDRAWALS: constants.MAX_WITHDRAWALS, POOL_COUNT: constants.POOL_COUNT,
    ERC20_ABI: constants.ERC20_ABI, POOL_ABI: constants.POOL_ABI, VERIFIER_ABI: constants.VERIFIER_ABI, ROUTER_ABI: constants.ROUTER_ABI,
  },
  // hashes
  {
    hash2: poseidon.hash2, hash4: poseidon.hash4, computeCommitment: poseidon.computeCommitment, computeNullifierHash: poseidon.computeNullifierHash,
    computeDisclosureTag: poseidon.computeDisclosureTag, computeZeroCascade: poseidon.computeZeroCascade, randomFieldElement: poseidon.randomFieldElement, isFieldElement: poseidon.isFieldElement,
  },
  // notes and master keys
  {
    encodeNote: notes.encodeNote, decodeNote: notes.decodeNote, isNote: notes.isNote, isMasterKey: notes.isMasterKey, generateNote: notes.generateNote,
    deriveNoteKeys: notes.deriveNoteKeys, deriveNotes: notes.deriveNotes, formatMasterKey: notes.formatMasterKey, parseMasterKey: notes.parseMasterKey, MASTER_SCAN_LIMIT: notes.MASTER_SCAN_LIMIT,
  },
  // registry (deployments.json)
  {
    loadDeployments: deployments.loadDeployments, findPool: deployments.findPool, poolById: deployments.poolById, findRouter: deployments.findRouter, routerById: deployments.routerById,
    routerFor: deployments.routerFor, poolForNote: deployments.poolForNote, listPools: deployments.listPools, listRouters: deployments.listRouters,
    isDepositable: deployments.isDepositable, assertDepositable: deployments.assertDepositable,
  },
  // Merkle tree
  {
    fetchDeposits: merkleTree.fetchDeposits, fetchSpent: merkleTree.fetchSpent, waitForBlock: merkleTree.waitForBlock, buildTreeLevels: merkleTree.buildTreeLevels, getMerklePath: merkleTree.getMerklePath, rootFromPath: merkleTree.rootFromPath,
    merkleProofFromDeposits: merkleTree.merkleProofFromDeposits, findDeposit: merkleTree.findDeposit, getProofInputsForCommitment: merkleTree.getProofInputsForCommitment,
  },
  // proofs
  {
    loadCircuit: prove.loadCircuit, buildWithdrawInput: prove.buildWithdrawInput, proveWithdraw: prove.proveWithdraw, checkWithdrawBinding: prove.checkWithdrawBinding,
    verifyProofLocally: prove.verifyProofLocally, verificationKeyOf: prove.verificationKeyOf, buildDiscloseInput: prove.buildDiscloseInput, proveDisclose: prove.proveDisclose,
  },
  // one pool
  { deposit: pool.deposit, isSpent: pool.isSpent, isKnownRoot: pool.isKnownRoot, verifyOnChain: pool.verifyOnChain, withdraw: pool.withdraw, withdrawNote: pool.withdrawNote, ROOT_RETRIES: pool.ROOT_RETRIES },
  // router
  {
    toUnits: router.toUnits, fromUnits: router.fromUnits, planDeposit: router.planDeposit, checkRouterOnChain: router.checkRouterOnChain, depositAny: router.depositAny,
    findNotes: router.findNotes, selectNotesForAmount: router.selectNotesForAmount, buildWithdrawManyItem: router.buildWithdrawManyItem, batchItems: router.batchItems,
    withdrawMany: router.withdrawMany, withdrawByAmount: router.withdrawByAmount,
  },
  // payouts to a list of recipients
  {
    planPayout: payout.planPayout, packChunks: payout.packChunks, depositPayout: payout.depositPayout, payOut: payout.payOut, assignPayoutNotes: payout.assignPayoutNotes,
    checkPayoutRecord: payout.checkRecord, payoutToJson: payout.payoutToJson, payoutFromJson: payout.payoutFromJson,
  },
  // relayer
  { hasRelayer: relayer.hasRelayer, relayStatus: relayer.relayStatus, relayWithdraw: relayer.relayWithdraw, relayWithdrawMany: relayer.relayWithdrawMany, relayScheduled: relayer.relayScheduled, relayCancel: relayer.relayCancel },
  // split rule and note selection (shared verbatim with the demo)
  { canonicalSplit: distribution.canonicalSplit, noteOrder: distribution.noteOrder, roundDown: distribution.roundDown, selectNotes: distribution.selectNotes },
);
