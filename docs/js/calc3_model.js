/* =============================================================================
 * calc3_model.js -- cycle-accurate JavaScript twin of rtl/calc3/calc3_top.v
 * Author: Nitish Sundarraj
 * Verified cycle-by-cycle against the RTL on Icarus (sim/check_js_models.py).
 * ========================================================================== */
(function (root) {
  'use strict';

  const C = { NOP: 0, ADD: 1, SUB: 2, SHL: 5, SHR: 6, STORE: 9, FETCH: 10, BZ: 12, BE: 13 };
  const CMD_NAME = c => ({ 0: 'NOP', 1: 'ADD', 2: 'SUB', 5: 'SHL', 6: 'SHR', 9: 'STORE', 10: 'FETCH', 12: 'BZ', 13: 'BE' }[c] || 'INV' + c);
  const LAT_NAME = { 1: 'store/fetch/branch', 3: 'add/sub', 4: 'shift' };
  const BUGS = [
    { id: 0, name: 'Golden (no bug)', origin: '', detail: 'The reference design behaves exactly as specified.' },
    { id: 1, name: 'Back-to-back responses reuse the previous tag', origin: '2024-like',
      detail: 'When a port emits responses on consecutive cycles, the second one carries the first one\'s tag. Tag mismatches were the dominant mismatch kind in the 2024 Calc3 log.' },
    { id: 2, name: 'No same-cycle forwarding between ports', origin: 'teaching',
      detail: 'A port-2 fetch issued in the same cycle as a port-1 store to the same register returns the OLD value.' },
    { id: 3, name: 'Skipped command still writes its destination', origin: 'teaching',
      detail: 'The response correctly says "skipped" (3) but the register is written anyway. Only an end-to-end check (fetch afterwards) exposes it.' },
    { id: 4, name: 'Shift amount taken from the d2 field, not R[d2]', origin: 'teaching',
      detail: 'A classic spec misread: the register INDEX is used as the shift amount instead of the register CONTENTS.' },
    { id: 5, name: 'Port-4 SUB underflow not flagged', origin: 'teaching',
      detail: 'On port 4 only, R[d1] - R[d2] with R[d2] > R[d1] answers success and writes the wrapped value.' },
    { id: 6, name: 'Port-3 writes to R15 are lost', origin: 'teaching',
      detail: 'A corner of the (port x register) space: needs coverage of every register from every port.' },
    { id: 7, name: 'Branch-if-equal compares only the low 16 bits', origin: 'teaching',
      detail: 'BE is taken when the low halves match even if the high halves differ.' }
  ];
  const u = n => n >>> 0;

  class Calc3 {
    constructor(bug = 0) { this.bug = bug; this.reset(); this.cycle = 0; }

    reset() {
      this.rf = new Array(16).fill(0);
      this.skip = [false, false, false, false, false];
      this.slots = [null, 0, 1, 2, 3].map(() => [0, 1, 2, 3].map(() => ({ v: false, cnt: 0, rsp: 0, dat: 0, cmd: 0 })));
      this.lastTag = [0, 0, 0, 0, 0];
      this.lastV = [false, false, false, false, false];
      this.out = [0, 1, 2, 3, 4].map(() => ({ resp: 0, tag: 0, data: 0 }));
      this.events = [];
    }

    /* inp = { reset, cmd[1..4], d1[], d2[], r1[], tag[], data[] } */
    step(inp) {
      this.cycle++;
      const bug = this.bug;
      this.events = [];
      if (inp.reset) { this.reset(); return this.outputs(); }

      // -------- combinational execute (port order 1..4 on a scratch copy)
      const nrf = this.rf.slice(), nskip = this.skip.slice();
      const ex = [null, null, null, null, null];
      for (let p = 1; p <= 4; p++) {
        const c = inp.cmd[p];
        if (!c) continue;
        const d1 = inp.d1[p], d2 = inp.d2[p], r1 = inp.r1[p];
        const va = bug === 2 ? this.rf[d1] : nrf[d1];
        const vb = bug === 2 ? this.rf[d2] : nrf[d2];
        const amt = bug === 4 ? d2 : (vb & 31);
        let wr = false, res = 0, rsp = 1, dat = 0, lat = 1;
        switch (c) {
          case C.ADD: { const s = va + vb; lat = 3; res = u(s); if (s > 0xFFFFFFFF) rsp = 2; else wr = true; break; }
          case C.SUB: res = u(va - vb); lat = 3;
            if (vb > va && !(bug === 5 && p === 4)) rsp = 2; else wr = true; break;
          case C.SHL: res = u(va << amt); wr = true; lat = 4; break;
          case C.SHR: res = u(va >>> amt); wr = true; lat = 4; break;
          case C.STORE: res = u(inp.data[p]); wr = true; break;
          case C.FETCH: dat = va; break;
          case C.BZ: case C.BE: break;
          default: rsp = 2;
        }
        let skipped = false, taken = false;
        if (this.skip[p] && nskip[p]) {
          rsp = 3; dat = 0; lat = 1; nskip[p] = false; skipped = true;
          if (bug !== 3) wr = false;
        } else if (c === C.BZ) {
          nskip[p] = taken = (va === 0);
        } else if (c === C.BE) {
          nskip[p] = taken = bug === 7 ? ((va & 0xFFFF) === (vb & 0xFFFF)) : (va === vb);
        }
        if (wr && !(bug === 6 && p === 3 && r1 === 15)) nrf[r1] = res;
        ex[p] = { rsp, dat, lat, tag: inp.tag[p], cmd: c, wr, r1, res, skipped, taken };
        this.events.push({ p, ...ex[p] });
      }

      // -------- response selection (lowest ready tag), aging, allocation
      const nslots = this.slots.map(s => s && s.map(o => ({ ...o })));
      const nout = [0, 1, 2, 3, 4].map(() => ({ resp: 0, tag: 0, data: 0 }));
      const nLastTag = this.lastTag.slice(), nLastV = this.lastV.slice();
      for (let p = 1; p <= 4; p++) {
        let rdy = -1;
        for (let t = 3; t >= 0; t--) if (this.slots[p][t].v && this.slots[p][t].cnt <= 1) rdy = t;
        for (let t = 0; t < 4; t++)
          if (this.slots[p][t].v && this.slots[p][t].cnt > 1) nslots[p][t].cnt = this.slots[p][t].cnt - 1;
        if (rdy >= 0) {
          nslots[p][rdy].v = false;
          const s = this.slots[p][rdy];
          nout[p] = { resp: s.rsp, tag: (bug === 1 && this.lastV[p]) ? this.lastTag[p] : rdy, data: s.dat, trueTag: rdy };
          nLastTag[p] = rdy;
        }
        nLastV[p] = rdy >= 0;
        if (ex[p]) nslots[p][ex[p].tag] = { v: true, cnt: ex[p].lat, rsp: ex[p].rsp, dat: ex[p].dat, cmd: ex[p].cmd };
      }
      this.rf = nrf; this.skip = nskip; this.slots = nslots; this.out = nout;
      this.lastTag = nLastTag; this.lastV = nLastV;
      return this.outputs();
    }

    outputs() { return this.out.map(o => ({ ...o })); }
  }

  // Transaction-level reference model (the executable spec), in acceptance order
  class Calc3Ref {
    constructor() { this.rf = new Array(16).fill(0); this.skip = [false, false, false, false, false]; }
    execute(p, c, d1, d2, r1, data) {
      const a = this.rf[d1], b = this.rf[d2];
      if (this.skip[p]) { this.skip[p] = false; return { resp: 3, data: 0, skipped: true }; }
      let resp = 1, out = 0, taken = false;
      switch (c) {
        case C.ADD: if (a + b > 0xFFFFFFFF) resp = 2; else this.rf[r1] = u(a + b); break;
        case C.SUB: if (b > a) resp = 2; else this.rf[r1] = u(a - b); break;
        case C.SHL: this.rf[r1] = u(a << (b & 31)); break;
        case C.SHR: this.rf[r1] = u(a >>> (b & 31)); break;
        case C.STORE: this.rf[r1] = u(data); break;
        case C.FETCH: out = a; break;
        case C.BZ: this.skip[p] = taken = (a === 0); break;
        case C.BE: this.skip[p] = taken = (a === b); break;
        default: resp = 2;
      }
      return { resp, data: out, skipped: false, taken };
    }
  }

  const api = { Calc3, Calc3Ref, BUGS, C, CMD_NAME, LAT_NAME };
  root.Calc3Model = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
