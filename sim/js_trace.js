// Run the website's JS models on a stimulus file and print the same trace
// format as tb/trace/*_trace_tb.v.  usage: node sim/js_trace.js calc1|calc3 BUG stim.txt
const fs = require('fs');
const path = require('path');
const [design, bugS, stim] = process.argv.slice(2);
const bug = parseInt(bugS, 10);
const lines = fs.readFileSync(stim, 'utf8').trim().split('\n');
const out = [];
const hx = (v, w) => (v >>> 0).toString(16).padStart(w, '0');
if (design === 'calc1') {
  const M = require(path.join(__dirname, '../docs/js/calc1_model.js'));
  const dut = new M.Calc1(bug);
  for (const l of lines) {
    const f = l.trim().split(/\s+/).map(s => parseInt(s, 16));
    const o = dut.step({ reset: f[0], cmd: [0, f[1], f[3], f[5], f[7]], data: [0, f[2], f[4], f[6], f[8]] });
    const parts = [];
    for (let p = 1; p <= 4; p++) parts.push(o.resp[p].toString(16), M.fmtHex(o.data[p]));
    out.push(parts.join(' '));
  }
} else {
  const M = require(path.join(__dirname, '../docs/js/calc3_model.js'));
  const dut = new M.Calc3(bug);
  for (const l of lines) {
    const f = l.trim().split(/\s+/).map(s => parseInt(s, 16));
    const inp = { reset: f[0], cmd: [0], d1: [0], d2: [0], r1: [0], tag: [0], data: [0] };
    for (let p = 0; p < 4; p++) {
      const b = 1 + p * 6;
      inp.cmd.push(f[b]); inp.d1.push(f[b + 1]); inp.d2.push(f[b + 2]); inp.r1.push(f[b + 3]); inp.tag.push(f[b + 4]); inp.data.push(f[b + 5]);
    }
    const o = dut.step(inp);
    const parts = [];
    for (let p = 1; p <= 4; p++) parts.push(o[p].resp.toString(16), o[p].tag.toString(16), hx(o[p].data, 8));
    out.push(parts.join(' '));
  }
}
process.stdout.write(out.join('\n') + '\n');
