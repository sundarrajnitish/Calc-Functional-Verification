/* =============================================================================
 * bench.js -- the SystemVerilog testbench architecture, ported to JavaScript
 * Author: Nitish Sundarraj
 *
 * Same layering as tb/calc1/calc1_pkg.sv and tb/calc3/calc3_pkg.sv:
 *   generator -> per-port driver -> DUT model -> monitor -> scoreboard (+coverage)
 * with the reference model predicting every response. Both the interactive
 * simulator and the in-browser regression use these classes.
 * ========================================================================== */
(function (root) {
  'use strict';
  const M1 = root.Calc1Model, M3 = root.Calc3Model;
  const u = n => n >>> 0;
  const hex = v => '0x' + u(v).toString(16).padStart(8, '0');

  // ------------------------------------------------------------- PRNG
  // mulberry32: small, fast, seedable -- so a seed reproduces a run exactly
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    const u32 = () => u(Math.floor(next() * 4294967296));
    // SystemVerilog-style 'dist': items are [value | [lo,hi], weight, perRange(':/')]
    const dist = items => {
      const w = items.map(([, wt]) => wt), tot = w.reduce((a, b) => a + b, 0);
      let r = next() * tot;
      for (const [v, wt] of items) {
        if ((r -= wt) < 0) {
          if (Array.isArray(v)) {
            const [lo, hi] = v;
            return hi - lo > 0xFFFFFF ? u(lo + Math.floor(next() * (hi - lo + 1))) : int(lo, hi);
          }
          return v;
        }
      }
      return items[items.length - 1][0];
    };
    return { next, int, u32, dist };
  }

  // =====================================================================
  //  Calc1
  // =====================================================================
  const C1_TIMEOUT = 64;

  class Calc1Coverage {
    constructor() {
      this.cmdPort = {}; this.inv = new Set(); this.opc1 = new Set(); this.opc2 = new Set();
      this.shl = new Set(); this.shr = new Set(); this.ovf = new Set(); this.unf = new Set();
      this.subEq = false; this.walk = new Set(); this.conc = new Set(); this.resp = new Set();
    }
    static opClass(v) { v = u(v); return v === 0 ? 0 : v === 1 ? 1 : v === 0xFFFFFFFF ? 2 : v < 32 ? 3 : 4; }
    issue(t, busy) {
      if ([1, 2, 5, 6].includes(t.cmd)) this.cmdPort[t.cmd + ':' + t.port] = 1;
      else if (t.cmd) this.inv.add(t.cmd);
      this.opc1.add(Calc1Coverage.opClass(t.op1)); this.opc2.add(Calc1Coverage.opClass(t.op2));
      if (t.cmd === 5) this.shl.add(t.op2 & 31);
      if (t.cmd === 6) this.shr.add(t.op2 & 31);
      if (t.cmd === 1 && t.op2 && (t.op2 & (t.op2 - 1)) === 0) this.walk.add(Math.log2(u(t.op2)) | 0);
      if (t.cmd === 2 && u(t.op1) === u(t.op2)) this.subEq = true;
      this.conc.add(busy);
    }
    result(t) {
      if (t.timedOut) return;
      if (t.act.resp === 1 && [1, 2, 5, 6].includes(t.cmd)) this.resp.add('ok' + t.cmd);
      if (t.act.resp === 2 && (t.cmd === 1 || t.cmd === 2)) this.resp.add('err' + t.cmd);
      if (t.cmd === 1 && t.exp.resp === 2) this.ovf.add(t.port);
      if (t.cmd === 2 && t.exp.resp === 2) this.unf.add(t.port);
    }
    groups() {
      return [
        { name: 'cmd × port', hit: Object.keys(this.cmdPort).length, total: 16, plan: 'every valid command on every port' },
        { name: 'invalid opcodes', hit: this.inv.size, total: 11, plan: 'opcodes 3,4,7..15 all answered with 2' },
        { name: 'operand classes', hit: this.opc1.size + this.opc2.size, total: 10, plan: '0, 1, all-ones, <32, large for op1 and op2' },
        { name: 'shift amounts', hit: this.shl.size + this.shr.size, total: 64, plan: 'SHL and SHR by every amount 0..31' },
        { name: 'overflow/underflow × port', hit: this.ovf.size + this.unf.size, total: 8, plan: 'carry and borrow seen on every port' },
        { name: 'sub equal', hit: this.subEq ? 1 : 0, total: 1, plan: 'a - a = 0' },
        { name: 'ADD walking-one op2', hit: this.walk.size, total: 32, plan: 'op2 with a single 1 in every bit position' },
        { name: 'concurrency 1..4', hit: this.conc.size, total: 4, plan: '1, 2, 3 and 4 ports busy at once' },
        { name: 'responses', hit: this.resp.size, total: 6, plan: 'success for every cmd, error for add & sub' }
      ];
    }
    percent() { const g = this.groups(); return 100 * g.reduce((a, x) => a + Math.min(x.hit, x.total), 0) / g.reduce((a, x) => a + x.total, 0); }
  }

  class Calc1Bench {
    constructor(bug = 0) {
      this.dut = new M1.Calc1(bug);
      this.bug = bug;
      this.q = [null, [], [], [], []];
      this.drv = [null, 0, 1, 2, 3].map(() => ({ ph: 'idle', t: null, gap: 0 }));
      this.dead = [false, false, false, false, false];
      this.cycle = 0; this.resetCycles = 0;
      this.hist = [];
      this.done = [];
      this.stats = { checked: 0, pass: 0, fail: 0, spurious: 0, kinds: {} };
      this.cov = new Calc1Coverage();
      this.nextId = 0;
      this.listeners = [];
      this.pendingCount = 0;
      this.applyReset(8);
    }
    applyReset(n = 8) { this.resetCycles = n; }
    make(port, cmd, op1, op2, gap = 0) { return { id: this.nextId++, port, cmd, op1: u(op1), op2: u(op2), gap }; }
    send(t) { t.exp = M1.predict(t.cmd, t.op1, t.op2); this.q[t.port].push(t); this.pendingCount++; return t; }
    pending() { return this.pendingCount; }
    busyPorts() { let n = 0; for (let p = 1; p <= 4; p++) if (this.drv[p].t) n++; return n; }

    tick() {
      const inp = { reset: 0, cmd: [0, 0, 0, 0, 0], data: [0, 0, 0, 0, 0] };
      const ev = [];
      if (this.resetCycles > 0) {
        inp.reset = 0x7F; this.resetCycles--;
      } else {
        for (let p = 1; p <= 4; p++) {
          const d = this.drv[p];
          if (d.ph === 'idle' && this.q[p].length) {
            const t = this.q[p][0];
            if (this.dead[p]) { this.q[p].shift(); t.timedOut = true; this.finish(t, ev, true); continue; }
            if (d.gap < t.gap) { d.gap++; continue; }
            this.q[p].shift(); d.gap = 0;
            this.cov.issue(t, this.busyPorts() + 1);
            d.t = t; d.ph = 'op1'; t.tIssue = this.cycle;
            ev.push({ kind: 'issue', t });
          }
          if (d.ph === 'op1') { inp.cmd[p] = d.t.cmd; inp.data[p] = d.t.op1; d.ph = 'op2'; }
          else if (d.ph === 'op2') { inp.data[p] = d.t.op2; d.ph = 'wait'; }
        }
      }
      const out = this.dut.step(inp);
      this.cycle++;
      // monitor
      if (!inp.reset) {
        for (let p = 1; p <= 4; p++) {
          const d = this.drv[p];
          if (out.resp[p] !== 0) {
            if (!d.t || d.ph !== 'wait') {
              this.stats.spurious++; this.stats.fail++;
              ev.push({ kind: 'spurious', port: p, resp: out.resp[p] });
            } else {
              d.t.act = { resp: out.resp[p], data: out.data[p] };
              d.t.tResp = this.cycle;
              this.finish(d.t, ev);
              d.t = null; d.ph = 'idle';
            }
          } else if (d.t && d.ph === 'wait' && this.cycle - d.t.tIssue > C1_TIMEOUT) {
            this.dead[p] = true;
            d.t.timedOut = true; d.t.act = { resp: null, data: null }; d.t.tResp = this.cycle;
            this.finish(d.t, ev);
            ev.push({ kind: 'hang', port: p });
            d.t = null; d.ph = 'idle';
          }
        }
      }
      this.hist.push({ cycle: this.cycle, inp, out, st: this.dut.st.slice(), dbg: { ...this.dut.dbg },
                       ap: this.dut.ap.map(s => ({ ...s })), sp: this.dut.sp.map(s => ({ ...s })) });
      if (this.hist.length > 600) this.hist.shift();
      return ev;
    }

    finish(t, ev, skipped = false) {
      let kind = '';
      if (t.timedOut) kind = 'no_response';
      else if (t.act.data.x) kind = 'x_on_output';
      else if (t.act.resp !== t.exp.resp) kind = 'wrong_resp';
      else if (t.exp.resp === 1 && u(t.act.data.v) !== u(t.exp.data)) kind = 'wrong_data';
      t.verdict = kind || 'pass';
      this.stats.checked++;
      if (kind) { this.stats.fail++; this.stats.kinds[kind] = (this.stats.kinds[kind] || 0) + 1; }
      else this.stats.pass++;
      if (!skipped) this.cov.result(t);
      this.pendingCount--;
      this.done.push(t);
      if (this.done.length > 400) this.done.shift();
      ev.push({ kind: 'check', t });
    }

    static describe(t) {
      const name = M1.CMD_NAME(t.cmd);
      return `P${t.port} ${name} ${hex(t.op1)}, ${hex(t.op2)}`;
    }
  }

  // ---- stimulus mirroring calc1_pkg::calc1_tests ----------------------
  const Calc1Tests = {
    smoke(b) {
      for (let p = 1; p <= 4; p++) {
        b.send(b.make(p, 1, 5, 3)); b.send(b.make(p, 2, 10, 3));
        b.send(b.make(p, 5, 8, 2)); b.send(b.make(p, 6, 16, 2));
      }
    },
    directed(b) {
      for (let p = 1; p <= 4; p++) {
        [[1, 0xFFFFFFFF, 1], [1, 0x80000000, 0x80000000], [1, 0xFFFFFFFE, 1], [1, 0, 0],
         [2, 0, 1], [2, 1234, 1234], [2, 0xFFFFFFFF, 0], [2, 9, 4]].forEach(([c, a, x]) => b.send(b.make(p, c, a, x)));
        for (let s = 0; s < 32; s++) { b.send(b.make(p, 5, 0xA5A50F0F, s)); b.send(b.make(p, 6, 0xF0F05A5A, s)); }
        b.send(b.make(p, 5, 1, 0xFFFFFFE3));
        for (let c = 3; c < 16; c++) if (c !== 5 && c !== 6) b.send(b.make(p, c, 7, 2));
        for (let k = 0; k < 32; k++) b.send(b.make(p, 1, 0x100, u(1 << k)));
      }
    },
    priority(b) {
      const seq = [];
      for (let rep = 0; rep < 20; rep++) {
        const c = rep % 2 ? 1 : 5;
        seq.push([1, 2, 3, 4].map(p => [p, c, 100 * p + rep, 3]));
      }
      for (let rep = 0; rep < 20; rep++)
        seq.push([[1, 1, rep, 7], [2, 6, 0xFF00 + rep, 4], [3, 2, 50 + rep, 9], [4, 5, rep + 1, 5]]);
      return seq;     // batches: each batch waits for idle
    },
    random(r) {
      return {
        port: r.int(1, 4),
        cmd: r.dist([[1, 30], [2, 30], [5, 15], [6, 15], [[3, 4], 3], [[7, 15], 7]]),
        op1: r.dist([[0, 5], [0xFFFFFFFF, 5], [[1, 15], 10], [[16, 0xFFFFFFFE], 80]]),
        op2: r.dist([[0, 5], [0xFFFFFFFF, 5], [[1, 31], 30], [[32, 0xFFFFFFFE], 60]]),
        gap: r.dist([[0, 60], [[1, 4], 40]])
      };
    }
  };

  // =====================================================================
  //  Calc3
  // =====================================================================
  const C3_TIMEOUT = 40;
  const C = M3.C;

  class Calc3Coverage {
    constructor() {
      this.cmdPort = new Set(); this.tagPort = new Set(); this.rw = new Set(); this.br = new Set();
      this.skipK = new Set(); this.depth = new Set(); this.ooo = new Set(); this.xport = false;
      this.b2b = false; this.ou = new Set(); this.inv = false;
    }
    groups() {
      return [
        { name: 'cmd × port', hit: this.cmdPort.size, total: 32, plan: '8 commands on 4 ports' },
        { name: 'tag × port', hit: this.tagPort.size, total: 16, plan: 'every tag used on every port' },
        { name: 'registers read/written', hit: this.rw.size, total: 32, plan: 'each of R0..R15 read and written' },
        { name: 'branch taken / not', hit: this.br.size, total: 4, plan: 'BZ and BE, both outcomes' },
        { name: 'skipped command kind', hit: this.skipK.size, total: 8, plan: 'every command kind skipped once' },
        { name: 'outstanding depth', hit: this.depth.size, total: 16, plan: '1..4 commands in flight per port' },
        { name: 'out-of-order × port', hit: this.ooo.size, total: 4, plan: 'a response overtakes an older one' },
        { name: 'cross-port hazard', hit: this.xport ? 1 : 0, total: 1, plan: 'same-cycle write then read on a later port' },
        { name: 'back-to-back hazard', hit: this.b2b ? 1 : 0, total: 1, plan: 'write then read next cycle, same port' },
        { name: 'overflow/underflow × port', hit: this.ou.size, total: 8, plan: 'carry and borrow on each port' },
        { name: 'invalid command', hit: this.inv ? 1 : 0, total: 1, plan: 'any illegal opcode' }
      ];
    }
    percent() { const g = this.groups(); return 100 * g.reduce((a, x) => a + Math.min(x.hit, x.total), 0) / g.reduce((a, x) => a + x.total, 0); }
  }

  class Calc3Bench {
    constructor(bug = 0) {
      this.dut = new M3.Calc3(bug);
      this.bug = bug;
      this.ref = new M3.Calc3Ref();
      this.q = [null, [], [], [], []];
      this.gapCnt = [0, 0, 0, 0, 0];
      this.freeTags = [null, [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]];
      this.exp = [null, [null, null, null, null], [null, null, null, null], [null, null, null, null], [null, null, null, null]];
      this.cycle = 0; this.resetCycles = 8;
      this.hist = []; this.done = [];
      this.stats = { checked: 0, pass: 0, fail: 0, spurious: 0, kinds: {} };
      this.cov = new Calc3Coverage();
      this.nextId = 0; this.pendingCount = 0;
      this.lastWr = [null, -1, -1, -1, -1]; this.lastWrCyc = [null, -9, -9, -9, -9];
    }
    make(port, cmd, d1 = 0, d2 = 0, r1 = 0, data = 0, gap = 0) {
      return { id: this.nextId++, port, cmd, d1, d2, r1, data: u(data), gap };
    }
    send(t) { this.q[t.port].push(t); this.pendingCount++; return t; }
    pending() { return this.pendingCount; }
    outstanding(p) { return this.exp[p].filter(Boolean).length; }

    tick() {
      const inp = { reset: 0, cmd: [0, 0, 0, 0, 0], d1: [0, 0, 0, 0, 0], d2: [0, 0, 0, 0, 0], r1: [0, 0, 0, 0, 0], tag: [0, 0, 0, 0, 0], data: [0, 0, 0, 0, 0] };
      const ev = [];
      const issued = [];
      if (this.resetCycles > 0) { inp.reset = 1; this.resetCycles--; this.ref = new M3.Calc3Ref(); }
      else {
        for (let p = 1; p <= 4; p++) {
          if (!this.q[p].length || !this.freeTags[p].length) continue;
          const t = this.q[p][0];
          if (this.gapCnt[p] < t.gap) { this.gapCnt[p]++; continue; }
          this.q[p].shift(); this.gapCnt[p] = 0;
          t.tag = this.freeTags[p].shift();
          inp.cmd[p] = t.cmd; inp.d1[p] = t.d1; inp.d2[p] = t.d2; inp.r1[p] = t.r1; inp.tag[p] = t.tag; inp.data[p] = t.data;
          issued[p] = t;
        }
      }
      const out = this.dut.step(inp);
      this.cycle++;
      if (!inp.reset) {
        // outputs first (they belong to commands accepted on earlier edges)
        for (let p = 1; p <= 4; p++) {
          const o = out[p];
          if (!o.resp) continue;
          const e = this.exp[p][o.tag];
          if (!e) {
            this.stats.checked++; this.stats.fail++; this.stats.spurious++;
            this.stats.kinds.unexpected_tag = (this.stats.kinds.unexpected_tag || 0) + 1;
            ev.push({ kind: 'unexpected', port: p, tag: o.tag, resp: o.resp });
            continue;
          }
          for (let k = 0; k < 4; k++) if (k !== o.tag && this.exp[p][k] && this.exp[p][k].tAccept < e.tAccept) this.cov.ooo.add(p);
          e.act = { resp: o.resp, data: o.data, tag: o.tag };
          e.tResp = this.cycle;
          this.retire(e, ev);
        }
        // commands accepted at this edge -> reference model (port order)
        for (let p = 1; p <= 4; p++) {
          const t = issued[p];
          if (!t) continue;
          const c = t.cmd;
          for (let q = 1; q < p; q++) if (this.lastWrCyc[q] === this.cycle && (this.lastWr[q] === t.d1 || this.lastWr[q] === t.d2)) this.cov.xport = true;
          if (this.lastWrCyc[p] === this.cycle - 1 && (this.lastWr[p] === t.d1 || this.lastWr[p] === t.d2)) this.cov.b2b = true;
          const r = this.ref.execute(p, c, t.d1, t.d2, t.r1, t.data);
          t.exp = { resp: r.resp, data: r.data }; t.skipped = r.skipped; t.taken = r.taken;
          t.tAccept = this.cycle;
          this.exp[p][t.tag] = t;
          ev.push({ kind: 'issue', t });
          this.cov.cmdPort.add(c + ':' + p); this.cov.tagPort.add(t.tag + ':' + p);
          this.cov.depth.add(p + ':' + this.outstanding(p));
          if (![1, 2, 5, 6, 9, 10, 12, 13].includes(c)) this.cov.inv = true;
          if (r.skipped) this.cov.skipK.add(c);
          if (c === C.BZ && !r.skipped) this.cov.br.add('bz' + r.taken);
          if (c === C.BE && !r.skipped) this.cov.br.add('be' + r.taken);
          if ((c === C.ADD || c === C.SUB) && r.resp === 2) this.cov.ou.add(c + ':' + p);
          const writes = !r.skipped && r.resp === 1 && [1, 2, 5, 6, 9].includes(c);
          if (writes) { this.cov.rw.add('w' + t.r1); this.lastWr[p] = t.r1; this.lastWrCyc[p] = this.cycle; }
          if ([1, 2, 5, 6, 10, 12, 13].includes(c)) this.cov.rw.add('r' + t.d1);
          if ([1, 2, 5, 6, 13].includes(c)) this.cov.rw.add('r' + t.d2);
        }
        // lost responses
        for (let p = 1; p <= 4; p++)
          for (let k = 0; k < 4; k++) {
            const e = this.exp[p][k];
            if (e && this.cycle - e.tAccept > C3_TIMEOUT) { e.timedOut = true; e.act = { resp: null, data: null, tag: null }; this.retire(e, ev); }
          }
      }
      this.hist.push({ cycle: this.cycle, inp, out, rf: this.dut.rf.slice(), slots: this.dut.slots.map(s => s && s.map(o => ({ ...o }))),
                       events: this.dut.events.slice(), skip: this.dut.skip.slice() });
      if (this.hist.length > 600) this.hist.shift();
      return ev;
    }

    retire(e, ev) {
      let kind = '';
      if (e.timedOut) kind = 'no_response';
      else if (e.act.resp !== e.exp.resp) kind = 'wrong_resp';
      else if (e.cmd === C.FETCH && e.exp.resp === 1 && u(e.act.data) !== u(e.exp.data)) kind = 'wrong_data';
      e.verdict = kind || 'pass';
      this.stats.checked++;
      if (kind) { this.stats.fail++; this.stats.kinds[kind] = (this.stats.kinds[kind] || 0) + 1; } else this.stats.pass++;
      this.exp[e.port][e.tag] = null;
      this.freeTags[e.port].push(e.tag);
      this.pendingCount--;
      this.done.push(e);
      if (this.done.length > 400) this.done.shift();
      ev.push({ kind: 'check', t: e });
    }

    static describe(t) {
      const n = M3.CMD_NAME(t.cmd);
      if (t.cmd === C.STORE) return `P${t.port} T${t.tag ?? '-'} STORE R${t.r1} ← ${hex(t.data)}`;
      if (t.cmd === C.FETCH) return `P${t.port} T${t.tag ?? '-'} FETCH R${t.d1}`;
      if (t.cmd === C.BZ) return `P${t.port} T${t.tag ?? '-'} BZ R${t.d1}`;
      if (t.cmd === C.BE) return `P${t.port} T${t.tag ?? '-'} BE R${t.d1}, R${t.d2}`;
      return `P${t.port} T${t.tag ?? '-'} ${n} R${t.r1} ← R${t.d1}, R${t.d2}`;
    }
  }

  const Calc3Tests = {
    batches() {
      const B = [];
      // smoke: store/fetch every register from every port
      for (let p = 1; p <= 4; p++) {
        const b = [];
        for (let r = 0; r < 16; r++) b.push([p, C.STORE, 0, 0, r, 0x1000 * p + r, 1]);
        for (let r = 0; r < 16; r++) b.push([p, C.FETCH, r, 0, 0, 0, 1]);
        B.push(b);
      }
      B.push([[1, C.STORE, 0, 0, 1, 25, 1], [1, C.STORE, 0, 0, 2, 5, 1], [1, C.ADD, 1, 2, 3, 0, 1], [1, C.FETCH, 3, 0, 0, 0, 4],
              [1, C.SUB, 1, 2, 4, 0, 1], [1, C.FETCH, 4, 0, 0, 0, 4], [1, C.SHL, 1, 2, 5, 0, 1], [1, C.FETCH, 5, 0, 0, 0, 5],
              [1, C.SHR, 1, 2, 6, 0, 1], [1, C.FETCH, 6, 0, 0, 0, 5]]);
      // directed
      for (let p = 1; p <= 4; p++) {
        B.push([[p, C.STORE, 0, 0, 0, 0, 1], [p, C.STORE, 0, 0, 1, 1, 1], [p, C.STORE, 0, 0, 2, 0xFFFFFFFF, 1],
                [p, C.STORE, 0, 0, 3, 0x80000000, 1], [p, C.STORE, 0, 0, 4, 33, 1]]);
        B.push([[p, C.ADD, 2, 1, 5, 0, 1], [p, C.ADD, 3, 3, 5, 0, 1], [p, C.SUB, 0, 1, 5, 0, 1], [p, C.FETCH, 5, 0, 0, 0, 4],
                [p, C.SUB, 2, 2, 6, 0, 1], [p, C.FETCH, 6, 0, 0, 0, 4], [p, C.SHL, 1, 4, 7, 0, 1], [p, C.FETCH, 7, 0, 0, 0, 5],
                [p, C.SHR, 3, 4, 8, 0, 1], [p, C.FETCH, 8, 0, 0, 0, 5]]);
        const b = [[p, C.STORE, 0, 0, 9, 0xAAAA, 1], [p, C.BZ, 0, 0, 0, 0, 1], [p, C.STORE, 0, 0, 9, 0xBAD, 1], [p, C.FETCH, 9, 0, 0, 0, 1],
                   [p, C.BZ, 1, 0, 0, 0, 1], [p, C.STORE, 0, 0, 9, 0xC0DE, 1], [p, C.FETCH, 9, 0, 0, 0, 1],
                   [p, C.BE, 2, 2, 0, 0, 1], [p, C.ADD, 1, 1, 9, 0, 1], [p, C.FETCH, 9, 0, 0, 0, 4],
                   [p, C.STORE, 0, 0, 10, 0x00011234, 1], [p, C.STORE, 0, 0, 11, 0x00021234, 1], [p, C.BE, 10, 11, 0, 0, 1],
                   [p, C.STORE, 0, 0, 12, 0x600D, 1], [p, C.FETCH, 12, 0, 0, 0, 1],
                   [p, C.BZ, 0, 0, 0, 0, 1], [p, C.BZ, 0, 0, 0, 0, 1], [p, C.STORE, 0, 0, 13, 0x1313, 1], [p, C.FETCH, 13, 0, 0, 0, 1]];
        for (const k of [1, 2, 5, 6, 9, 10, 12, 13]) { b.push([p, C.BZ, 0, 0, 0, 0, 1]); b.push([p, k, 1, 1, 14, 0x7777, 1]); }
        b.push([p, C.FETCH, 14, 0, 0, 0, 1], [p, C.STORE, 0, 0, 15, 0xF00D0000 + p, 1], [p, C.FETCH, 15, 0, 0, 0, 1],
               [p, 3, 1, 1, 1, 0, 1], [p, 7, 1, 1, 1, 0, 1], [p, 14, 1, 1, 1, 0, 1]);
        B.push(b);
      }
      // hazards
      for (let r = 0; r < 16; r++) {
        B.push([[1, C.STORE, 0, 0, r, 0x5A00 + r, 0], [2, C.FETCH, r, 0, 0, 0, 0], [3, C.FETCH, r, 0, 0, 0, 0], [4, C.FETCH, r, 0, 0, 0, 0]]);
        B.push([[3, C.STORE, 0, 0, r, 0xC300 + r, 0], [3, C.FETCH, r, 0, 0, 0, 0], [4, C.SHL, r, r, (r + 1) % 16, 0, 0],
                [4, C.FETCH, r, 0, 0, 0, 0], [4, C.ADD, r, r, (r + 2) % 16, 0, 0], [4, C.FETCH, (r + 1) % 16, 0, 0, 0, 0]]);
      }
      const deep = [];
      for (let p = 1; p <= 4; p++) for (let k = 0; k < 4; k++) deep.push([p, C.SHR, k, 1, 8 + k, 0, 0]);
      B.push(deep);
      return B;
    },
    random(r) {
      const win = r.dist([[3, 50], [7, 30], [15, 20]]);
      return {
        port: r.int(1, 4),
        cmd: r.dist([[1, 14], [2, 14], [5, 9], [6, 9], [9, 22], [10, 18], [12, 6], [13, 6], [[3, 4], 1], [[7, 8], 1], [[14, 15], 1]]),
        d1: r.int(0, win), d2: r.int(0, win), r1: r.int(0, win),
        data: r.dist([[0, 15], [0xFFFFFFFF, 5], [[1, 31], 30], [0x80000000, 5], [[32, 0xFFFFFFFE], 45]]),
        gap: r.dist([[0, 50], [[1, 3], 50]])
      };
    }
  };

  // =====================================================================
  //  Headless regression runner (cooperative: yields to the UI)
  // =====================================================================
  class Runner {
    constructor(design, bug, nRandom, seed, onProgress) {
      this.design = design; this.bug = bug; this.n = nRandom; this.seed = seed; this.onProgress = onProgress;
      this.b = design === 'calc1' ? new Calc1Bench(bug) : new Calc3Bench(bug);
      this.r = rng(seed);
      this.phase = 'directed'; this.batches = []; this.sentRandom = 0; this.curve = [];
      this.failures = [];
      this.stopped = false;
      if (design === 'calc1') {
        Calc1Tests.smoke(this.b); Calc1Tests.directed(this.b);
        this.batches = Calc1Tests.priority(this.b);
      } else {
        this.batches = Calc3Tests.batches();
      }
    }
    feed() {
      const b = this.b;
      if (b.pending() > 0 && this.phase !== 'random') return;
      if (this.phase === 'directed') {
        if (this.batches.length) {
          const batch = this.batches.shift();
          for (const x of batch) b.send(this.design === 'calc1' ? b.make(x[0], x[1], x[2], x[3]) : b.make(...x));
          return;
        }
        this.phase = 'random';
      }
      if (this.phase === 'random') {
        while (this.sentRandom < this.n && b.pending() < 48) {
          const x = this.design === 'calc1' ? Calc1Tests.random(this.r) : Calc3Tests.random(this.r);
          const t = this.design === 'calc1' ? b.make(x.port, x.cmd, x.op1, x.op2, x.gap) : b.make(x.port, x.cmd, x.d1, x.d2, x.r1, x.data, x.gap);
          b.send(t);
          this.sentRandom++;
        }
        if (this.sentRandom >= this.n && b.pending() === 0) this.phase = 'done';
      }
    }
    runSlice(maxCycles) {
      for (let i = 0; i < maxCycles && this.phase !== 'done' && !this.stopped; i++) {
        this.feed();
        if (this.phase === 'done') break;
        const ev = this.b.tick();
        for (const e of ev) {
          if (e.kind === 'check' && e.t.verdict !== 'pass' && this.failures.length < 200) this.failures.push(e.t);
          if (e.kind === 'check' && this.b.stats.checked % 25 === 0) this.curve.push([this.b.stats.checked, this.b.cov.percent()]);
        }
        if (this.b.cycle > 400000) this.phase = 'done';
      }
      return this.phase === 'done';
    }
  }

  const api = { rng, Calc1Bench, Calc3Bench, Calc1Tests, Calc3Tests, Calc1Coverage, Calc3Coverage, Runner, hex };
  root.Bench = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
