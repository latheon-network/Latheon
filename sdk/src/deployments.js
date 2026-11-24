'use strict';
/*
 * The pool and router registry, read from deployments.json (the same file the demo loads). Nothing here is hard-coded:
 * when the file changes, the SDK follows.
 *
 * A registry pool looks like deployments.json's entry plus: `net` (its network entry), `tok` (its token entry),
 * `version` normalised to 'v7' / 'v6' / 'v5', `native`, `levels`, `denomination` (base units), `verifierAddr`,
 * `startBlock`, `circuit` ('withdraw_v5' …), `frozen` and `forgeable`. V4 legacy entries are left out: this SDK does not
 * handle them (the demo does).
 *
 * Only a V7 pool or router that is neither `frozen` nor `forgeable` may receive deposits. Every pre-V7 pool is listed
 * for withdrawals only; depositing into one hands the deposit to whoever forges a proof (THREAT-MODEL.md §8.0).
 */
const { getAddress } = require('ethers');
const { levelsOf, circuitOf, feeVersion, DEPOSIT_VERSIONS } = require('./constants');

const normaliseVersion = (v) => {
  if (v === 'v8' || v === 'v8-native') return 'v8';
  if (v === 'v7' || v === 'v7-native') return 'v7';
  if (v === 'v6' || v === 'v6-native') return 'v6';
  if (v === 'v5' || v === 'v5-native') return 'v5';
  return null;   // 'v4' legacy and anything unknown
};

/**
 * Builds the registry from a deployments.json object (defaults to the file shipped with this package).
 * @returns {{config: object, networks: object, pools: object[], routers: object[]}}
 */
/**
 * deployments.json plus the V8 entry (deployments-v8.json, written by deploy-v8): the V8 pools and router are added and
 * the network gets v8Verifier, v8DiscloseVerifier and v8DiscloseLinkVerifier. Used by loadDeployments() when no config
 * is passed, until the demo's deployments.json lists V8 itself.
 */
function mergeV8(cfg, v8) {
  if (!v8 || !v8.network) return cfg;
  const out = JSON.parse(JSON.stringify(cfg));
  const net = out.networks[v8.network.id];
  if (!net) return out;
  if (out.pools.some((p) => p.version === 'v8-native' || p.version === 'v8')) return out;   // already listed
  net.v8Verifier = v8.verifiers.withdraw; net.v8DiscloseVerifier = v8.verifiers.disclose; net.v8DiscloseLinkVerifier = v8.verifiers.discloseLink;
  out.pools = v8.pools.concat(out.pools);
  out.routers = (v8.routers || []).concat(out.routers || []);
  return out;
}

function loadDeployments(config) {
  let cfg = config;
  if (!cfg) {
    cfg = require('../deployments.json');
    try { cfg = mergeV8(cfg, require('../deployments-v8.json')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  if (!cfg || !cfg.networks || !Array.isArray(cfg.pools)) throw new Error('deployments.json: unexpected shape');
  const networks = {};
  for (const [id, net] of Object.entries(cfg.networks)) networks[id] = Object.assign({ id }, net);

  const pools = [];
  for (const p of cfg.pools) {
    const version = normaliseVersion(p.version);
    if (!version || p.legacy) continue;
    const net = networks[p.network];
    if (!net) throw new Error('deployments.json: pool ' + p.id + ' names unknown network ' + p.network);
    const tok = net.tokens && net.tokens[p.token];
    if (!tok) throw new Error('deployments.json: pool ' + p.id + ' names unknown token ' + p.token);
    const verifierAddr = version === 'v8' ? net.v8Verifier : version === 'v7' ? net.v7Verifier : version === 'v6' ? net.v6Verifier : net.v5Verifier;
    pools.push(Object.assign({}, p, {
      net, tok, version, native: !!tok.native, decimals: tok.decimals, levels: levelsOf(version), circuit: circuitOf(version),
      denomination: BigInt(p.amount) * 10n ** BigInt(tok.decimals),
      verifierAddr: verifierAddr ? getAddress(verifierAddr) : null,
      startBlock: p.deployBlock !== undefined ? p.deployBlock : (p.startBlock || 0),
      address: getAddress(p.address),
      frozen: !!p.frozen || !DEPOSIT_VERSIONS.includes(version) || !!net.deprecated,
      forgeable: !!p.forgeable || !DEPOSIT_VERSIONS.includes(version),
      feeVersion: feeVersion(version),
      discloseCircuit: version === 'v8' ? 'disclose_v2' : 'disclose',
      discloseVerifierAddr: version === 'v8' ? (net.v8DiscloseVerifier ? getAddress(net.v8DiscloseVerifier) : null) : (net.discloseVerifier ? getAddress(net.discloseVerifier) : null),
      discloseLinkVerifierAddr: version === 'v8' && net.v8DiscloseLinkVerifier ? getAddress(net.v8DiscloseLinkVerifier) : null,
    }));
  }

  const routers = [];
  for (const r of cfg.routers || []) {
    const version = r.version === 'v8' ? 'v8' : r.version === 'v7' ? 'v7' : r.version === 'v6' ? 'v6' : 'v5';   // a router serves the four pools of its own version
    const net = networks[r.network];
    if (!net) throw new Error('deployments.json: router ' + r.id + ' names unknown network ' + r.network);
    const tok = net.tokens && net.tokens[r.token];
    if (!tok) throw new Error('deployments.json: router ' + r.id + ' names unknown token ' + r.token);
    const rpools = pools.filter((p) => p.network === r.network && p.token === r.token && p.version === version).sort((a, b) => b.amount - a.amount);
    if (rpools.length !== 4) continue;   // a router without its four pools is unusable
    routers.push(Object.assign({}, r, {
      net, tok, version, native: !!tok.native, decimals: tok.decimals, levels: levelsOf(version), circuit: circuitOf(version), feeVersion: feeVersion(version),
      address: getAddress(r.address), pools: rpools, denominations: rpools.map((p) => p.denomination),
      frozen: !!r.frozen || !DEPOSIT_VERSIONS.includes(version) || !!net.deprecated,
    }));
  }
  // newest generation first, so listRouters(reg, { depositable: true })[0] is the current one
  const rank = (v) => ['v8', 'v7', 'v6', 'v5'].indexOf(v);
  pools.sort((a, b) => rank(a.version) - rank(b.version));
  routers.sort((a, b) => rank(a.version) - rank(b.version));
  return { config: cfg, networks, pools, routers };
}

const sameAddr = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** The pool at `address` on chain `chainId`, or null. */
function findPool(registry, chainId, address) {
  return registry.pools.find((p) => p.net.chainId === Number(chainId) && sameAddr(p.address, address)) || null;
}
/** The pool with this deployments.json id (e.g. 'latheon-testnet:LTH-100:v7'), or null. */
function poolById(registry, id) { return registry.pools.find((p) => p.id === id) || null; }
/** The router at `address` on chain `chainId`, or null. */
function findRouter(registry, chainId, address) {
  return registry.routers.find((r) => r.net.chainId === Number(chainId) && sameAddr(r.address, address)) || null;
}
/** The router with this deployments.json id (e.g. 'latheon-testnet:LTH:v7'), or null. */
function routerById(registry, id) { return registry.routers.find((r) => r.id === id) || null; }
/** The router that serves `pool` (same network, token and generation), or null. */
function routerFor(registry, pool) {
  return registry.routers.find((r) => r.network === pool.network && r.token === pool.token && r.version === pool.version) || null;
}
/** The pool a decoded note belongs to; throws when the registry does not list it. */
function poolForNote(registry, note) {
  const pool = findPool(registry, note.chainId, note.address);
  if (!pool) throw new Error('Unknown pool ' + note.address + ' on chain ' + note.chainId + ' (not in deployments.json)');
  return pool;
}

/**
 * Pools matching a filter: { network, token, version, amount, depositable }. `depositable: true` keeps only pools that
 * may receive deposits (V7, not frozen, not forgeable).
 */
function listPools(registry, filter = {}) {
  return registry.pools.filter((p) =>
    (filter.network === undefined || p.network === filter.network) &&
    (filter.token === undefined || p.token === filter.token) &&
    (filter.version === undefined || p.version === filter.version) &&
    (filter.amount === undefined || p.amount === filter.amount) &&
    (filter.depositable === undefined || isDepositable(p) === filter.depositable));
}
/** Routers matching { network, token, version, depositable }. */
function listRouters(registry, filter = {}) {
  return registry.routers.filter((r) =>
    (filter.network === undefined || r.network === filter.network) &&
    (filter.token === undefined || r.token === filter.token) &&
    (filter.version === undefined || r.version === filter.version) &&
    (filter.depositable === undefined || isDepositable(r) === filter.depositable));
}

/** True when deposits into this pool or router are safe today: V8 or V7, and not flagged. */
function isDepositable(entry) { return DEPOSIT_VERSIONS.includes(entry.version) && !entry.frozen && !entry.forgeable; }

/** Throws unless `entry` (a pool or router) may receive deposits. Every deposit path of this SDK calls it. */
function assertDepositable(entry) {
  if (isDepositable(entry)) return;
  const what = entry.pools ? 'router' : 'pool';
  throw new Error(`Refusing to deposit into ${what} ${entry.id || entry.address}: ${!DEPOSIT_VERSIONS.includes(entry.version) ? 'pre-V7 generation (' + entry.version + ')' : 'flagged frozen/forgeable'}. ` +
    'Pre-V7 pools use a forgeable circuit (STATUS.md §7); they are listed for withdrawals only.');
}

module.exports = { loadDeployments, mergeV8, normaliseVersion, findPool, poolById, findRouter, routerById, routerFor, poolForNote, listPools, listRouters, isDepositable, assertDepositable };
