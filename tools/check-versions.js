#!/usr/bin/env node
'use strict';
/*
 * Compares, for each contracts/*V7*.sol (or every versioned contract with --all), the version in the file name, the
 * contract name and the versions named in its comments (header, @title, @notice, @dev), and prints what does not match.
 * Read-only: the deployed V7 contracts were built from commit 129a4c0 and their sources must not change (any edit
 * changes the metadata hash), so the fixes belong in the next contract version (ROADMAP.md).
 *
 *   node tools/check-versions.js [--all] [--strict]
 * Output, per file:
 *   MISMATCH  the contract name differs from the file name, or a header / @title / first @notice line names another
 *             pool generation, or the comments point to another generation's circuit or key ceremony
 *   review    any other comment naming another generation (often a correct reference to an older one, e.g. "notes keep
 *             the V5 format"; listed so a human can decide)
 * Exit code 0; with --strict, 1 when there is any MISMATCH.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ALL = process.argv.includes('--all');
const STRICT = process.argv.includes('--strict');

// Pool generation -> its withdrawal circuit and key ceremony (STATUS.md, docs/dev-ceremony-v*.md)
const GEN = {
  3: { circuit: 'withdraw', ceremony: null },
  4: { circuit: 'withdraw_v2', ceremony: null },
  5: { circuit: 'withdraw_v3', ceremony: 'dev-ceremony-v3' },
  6: { circuit: 'withdraw_v4', ceremony: 'dev-ceremony-v4' },
  7: { circuit: 'withdraw_v5', ceremony: 'dev-ceremony-v5' },
};
// The withdrawal verifier contract for a circuit: WithdrawVerifierV5 belongs to withdraw_v5 (V7), and so on.
const VERIFIER_FOR_GEN = { 5: 'V3', 6: 'V4', 7: 'V5' };

const dir = path.join(ROOT, 'contracts');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sol') && (ALL ? /(Pool)V\d+/.test(f) : /V7/.test(f))).sort();
let mismatches = 0;

for (const f of files) {
  const gen = Number(f.match(/V(\d+)/)[1]);
  const exp = GEN[gen] || {};
  const src = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  const out = [];
  const mm = (line, msg) => { out.push(`  MISMATCH ${f}:${line}: ${msg}`); mismatches++; };
  const rv = (line, msg) => out.push(`  review   ${f}:${line}: ${msg}`);

  // contract name vs file name
  const base = f.replace(/\.sol$/, '');
  const decls = src.map((l, i) => [l.match(/^\s*(?:abstract\s+)?contract\s+(\w+)/), i + 1]).filter(([m]) => m);
  if (!decls.some(([m]) => m[1] === base)) mm(decls[0] ? decls[0][1] : 1, `no contract named ${base} (declared: ${decls.map(([m]) => m[1]).join(', ') || 'none'})`);
  for (const [m, line] of decls) { const v = m[1].match(/V(\d+)/); if (v && Number(v[1]) !== gen) mm(line, `contract ${m[1]} in a V${gen} file`); }

  const firstDecl = src.findIndex((l) => /^\s*(?:abstract\s+)?(contract|interface|library)\s+\w+/.test(l));
  const mainDecl = decls.length ? decls[decls.length - 1][1] - 1 : src.length;
  let inBlock = false, seenNotice = false;
  src.forEach((l, i) => {
    const isComment = /^\s*(\/\/|\*|\/\*)/.test(l) || inBlock || /\/\/.*$/.test(l);
    if (/\/\*/.test(l)) inBlock = true; if (/\*\//.test(l)) inBlock = false;
    if (!isComment) return;
    const comment = l.includes('//') ? l.slice(l.indexOf('//')) : l;
    const line = i + 1;
    const isTitle = /@title/.test(comment);
    const isFirstNotice = /@notice/.test(comment) && !seenNotice && i < mainDecl;
    if (/@notice/.test(comment) && i < mainDecl) seenNotice = true;
    const isTopHeader = i < firstDecl && /^\s*\/\/(?!\/)/.test(l);   // plain // comment lines above the first declaration

    for (const m of comment.matchAll(/\bV(\d+)\b/g)) {
      const v = Number(m[1]);
      if (v === gen) continue;
      // "IGroth16VerifierV5" etc. are identifiers, not matched by \bV\d+\b; plain "V5" next to "verifier" is the verifier's own name
      const header = isTitle || isFirstNotice || isTopHeader;
      const text = comment.trim().slice(0, 140);
      if (header && v === gen - 1) mm(line, `header names V${v} in a V${gen} file: "${text}"`);
      else rv(line, `V${v}: "${text}"`);
    }
    for (const m of comment.matchAll(/\b(withdraw(?:_v\d+)?)\.circom\b|circuits\/(withdraw(?:_v\d+)?)\b|\b(withdraw_v\d+)\b/g)) {
      const c = m[1] || m[2] || m[3];
      if (exp.circuit && c !== exp.circuit && /LEVELS|levels|verifier/i.test(comment) && !/=|keep|same|format|as in|like/i.test(comment)) mm(line, `names circuit ${c}; V${gen} uses ${exp.circuit}: "${comment.trim().slice(0, 140)}"`);
      else if (exp.circuit && c !== exp.circuit) rv(line, `circuit ${c}: "${comment.trim().slice(0, 140)}"`);
    }
    for (const m of comment.matchAll(/dev-ceremony-v(\d+)/g)) {
      if (exp.ceremony && 'dev-ceremony-v' + m[1] !== exp.ceremony) mm(line, `points to dev-ceremony-v${m[1]}; the keys of V${gen} (${exp.circuit}) are in ${exp.ceremony}.md: "${comment.trim().slice(0, 140)}"`);
    }
  });
  // the verifier interface should be the one for this generation's circuit
  const vi = src.join('\n').match(/interface\s+IGroth16Verifier(V\d+)/);
  if (vi && VERIFIER_FOR_GEN[gen] && vi[1] !== VERIFIER_FOR_GEN[gen]) mm(1, `verifier interface ${vi[0].split(/\s+/)[1]}, expected IGroth16Verifier${VERIFIER_FOR_GEN[gen]} for ${exp.circuit}`);

  console.log(`${f} (V${gen}, circuit ${exp.circuit || '?'}): ${out.filter((x) => x.includes('MISMATCH')).length} mismatch(es), ${out.filter((x) => x.includes('review')).length} to review`);
  out.forEach((x) => console.log(x));
}
console.log(`\n${files.length} file(s), ${mismatches} mismatch(es). Do not edit the deployed V7 sources; fix the comments in the next contract version.`);
process.exit(STRICT && mismatches ? 1 : 0);
