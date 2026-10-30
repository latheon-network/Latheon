'use strict';
// Local EVM for the contract-level checks: solc from test/native, ganache in this process (no network).
const fs = require('fs');
const path = require('path');
const { dep, ROOT } = require('./lib');
const solc = dep('solc');
const ganache = dep('ganache');
const { ethers } = dep('ethers');

const SETTINGS = { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
  outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.bytecode.linkReferences', 'evm.deployedBytecode.object'] } } };

// files: { 'contracts/X.sol': absolutePathOrSource }  (a value with a newline is treated as source text)
function compile(files) {
  const sources = {};
  for (const [k, v] of Object.entries(files)) sources[k] = { content: v.includes('\n') ? v : fs.readFileSync(v, 'utf8') };
  const imp = (p) => {
    for (const base of [path.join(__dirname, 'node_modules'), path.resolve(__dirname, '..', 'native', 'node_modules')]) {
      const f = path.join(base, p); if (fs.existsSync(f)) return { contents: fs.readFileSync(f, 'utf8') };
    }
    return { error: 'not found: ' + p };
  };
  const out = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: SETTINGS }), { import: imp }));
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join('\n'));
  return out;
}

async function chain() {
  const gp = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' },
    wallet: { deterministic: true, totalAccounts: 6, defaultBalance: 1_000_000 }, miner: { blockGasLimit: 60000000 } });
  const provider = new ethers.BrowserProvider(gp);
  const signers = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => provider.getSigner(i)));
  const link = (c, libs) => {
    let code = c.evm.bytecode.object; const refs = c.evm.bytecode.linkReferences;
    for (const f in refs) for (const l in refs[f]) for (const { start, length } of refs[f][l])
      code = code.slice(0, start * 2) + libs[l].slice(2).toLowerCase() + code.slice(start * 2 + length * 2);
    return code;
  };
  const deploy = async (c, args = [], libs = {}, from = signers[0]) => {
    const f = new ethers.ContractFactory(c.abi, '0x' + link(c, libs), from);
    const x = await f.deploy(...args); await x.waitForDeployment(); return x;
  };
  return { provider, signers, deploy, close: () => gp.disconnect() };
}

// snarkjs proof -> Solidity calldata shape
const sol = (proof) => ({
  a: [proof.pi_a[0], proof.pi_a[1]],
  b: [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
  c: [proof.pi_c[0], proof.pi_c[1]],
});

module.exports = { compile, chain, sol, ethers, ROOT, SETTINGS, solc };
