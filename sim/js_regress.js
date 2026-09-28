// Headless run of the in-browser testbench (docs/js/bench.js) for every bug.
// usage: node sim/js_regress.js [nRandom] [seed]
require('../docs/js/calc1_model.js');
require('../docs/js/calc3_model.js');
const B = require('../docs/js/bench.js');
const n = +(process.argv[2] || 2000), seed = +(process.argv[3] || 1);
const rows = [];
for (const d of ['calc1', 'calc3']) for (let bug = 0; bug < 8; bug++) {
  const r = new B.Runner(d, bug, n, seed);
  const t0 = Date.now();
  while (!r.runSlice(100000));
  const s = r.b.stats;
  rows.push({ design: d, bug, checked: s.checked, fail: s.fail, cov: +r.b.cov.percent().toFixed(1), kinds: s.kinds, ms: Date.now() - t0 });
  console.log(d, bug, 'checked', s.checked, 'fail', s.fail, 'cov', r.b.cov.percent().toFixed(1), JSON.stringify(s.kinds), (Date.now() - t0) + 'ms',
    r.b.cov.groups().filter(g => g.hit < g.total).map(g => g.name + ' ' + g.hit + '/' + g.total).join('; '));
}
const bad = rows.filter(r => (r.bug === 0) !== (r.fail === 0));
process.exit(bad.length ? 1 : 0);
