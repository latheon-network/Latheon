'use strict';
// Optional: compile the circuits from source (needs the circom 2.2.3 binary in $CIRCOM and circomlib 2.0.5).
// Used for: withdraw.circom (no proving key was ever published, so its forgery is shown with a throw-away key),
// r1cs-level checks of forged witnesses, and comparing committed artifacts with a fresh build.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT } = require('./lib');

// withdraw_v2 and disclose were built (and their keys made) with circomlib 2.0.2 and --O1: that combination reproduces
// the committed wasm byte for byte; circomlib 2.0.5 gives a different wire layout. Everything else: 2.0.5, default -O.
const PROFILE = { withdraw_v2: { lib: 'circomlib-2.0.2', opt: '--O1' }, disclose: { lib: 'circomlib-2.0.2', opt: '--O1' } };
function circomlibDir(pkg = 'circomlib') {
  for (const base of [path.join(__dirname, 'node_modules'), path.resolve(__dirname, '..', 'native', 'node_modules')]) {
    const d = path.join(base, pkg, 'circuits');
    if (fs.existsSync(d)) return d;
  }
  return null;
}
function available() { return !!(process.env.CIRCOM && fs.existsSync(process.env.CIRCOM) && circomlibDir()); }

const OUT = path.join(os.tmpdir(), 'latheon-zk-review-build');
const cache = new Map();
// Returns { r1cs, wasm, sym } for circuits/<name>.circom, built once per run into a temp dir.
function build(name) {
  if (cache.has(name)) return cache.get(name);
  const prof = PROFILE[name] || { lib: 'circomlib', opt: null };
  const dir = path.join(OUT, prof.lib + (prof.opt || ''));
  const lib = path.join(dir, 'lib');
  fs.mkdirSync(lib, { recursive: true });
  const link = path.join(lib, 'circomlib');
  const src = circomlibDir(prof.lib);
  if (!src) throw new Error(prof.lib + ' not installed (npm install in test/zk-review)');
  if (!fs.existsSync(link)) fs.symlinkSync(src, link);
  const args = [path.join(ROOT, 'circuits', name + '.circom'), '--r1cs', '--wasm', '--sym', '-l', lib, '-o', dir];
  if (prof.opt) args.push(prof.opt);
  execFileSync(process.env.CIRCOM, args, { stdio: 'pipe' });
  const r = { r1cs: path.join(dir, name + '.r1cs'), wasm: path.join(dir, name + '_js', name + '.wasm'), sym: path.join(dir, name + '.sym'), profile: prof };
  cache.set(name, r);
  return r;
}
module.exports = { available, build, circomlibDir, OUT };
