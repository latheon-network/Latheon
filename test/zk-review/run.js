'use strict';
// Runs every internal ZK review check in order. Exit code 0 = all passed. Internal review, not an audit.
const parts = ['./p1-artifacts', './p1-forgery', './p1-v5', './p2-construction'];
(async () => {
  let fails = 0;
  const only = process.argv.slice(2);
  for (const p of parts) {
    if (only.length && !only.some((o) => p.includes(o))) continue;
    fails += await require(p).main();
  }
  console.log('\n' + (fails ? 'FAILED: ' + fails + ' check(s)' : 'ALL CHECKS PASSED'));
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
