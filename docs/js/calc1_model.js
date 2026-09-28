/* =============================================================================
 * calc1_model.js -- cycle-accurate, 4-state JavaScript twin of rtl/calc1/calc1_top.v
 * Author: Nitish Sundarraj
 *
 * Used by the website simulator. It is verified cycle-by-cycle against the
 * Verilog RTL running on Icarus Verilog (sim/check_js_models.py), for every
 * injected bug, so what you see in the browser is what the RTL does.
 *
 * Values that can carry X are represented as {v, x}: v = value bits,
 * x = mask of unknown bits (LSB = bit 0, i.e. IBM bit 31).
 * ========================================================================== */
(function (root) {
  'use strict';

  const ST = { IDLE: 0, OP2: 1, PEND: 2, BUSY: 3 };
  const ST_NAME = ['IDLE', 'OP2', 'PEND', 'BUSY'];
  const CMD = { NOP: 0, ADD: 1, SUB: 2, SHL: 5, SHR: 6 };
  const CMD_NAME = c => ({ 0: 'NOP', 1: 'ADD', 2: 'SUB', 5: 'SHL', 6: 'SHR' }[c] || 'INV' + c);
  const BUGS = [
    { id: 0, name: 'Golden (no bug)', origin: '', detail: 'The reference design behaves exactly as specified.' },
    { id: 1, name: 'Port-1 adder: operand-2 bit 4 bridged to bit 5', origin: '2024',
      detail: 'Two nets are shorted. When op2 bit4 and bit5 differ, the bit-4 net is driven both ways and reads X; the ripple-carry adder smears it into the next bits. Reproduces every one of the 3,321 ADD results in the 2024 Questa log.' },
    { id: 2, name: 'Port-1 SUB result stuck at 0, borrow never flagged', origin: '2024',
      detail: 'Port-1 subtraction always answers "success" with data 0. Only a - a (which really is 0) passes -- the 2024 log shows exactly that pattern.' },
    { id: 3, name: 'SHL by 0 drives X', origin: '2024',
      detail: 'A shift amount of zero selects an undriven mux leg: every bit that is 1 in op1 becomes X. 0 << 0 still reads 0, just like the log.' },
    { id: 4, name: 'SHR by 0 -> 0, SHR by 1 -> no shift', origin: '2024',
      detail: 'Small shift amounts are decoded off by one. Shifts of 2..31 are correct, which is why a test with a single shift amount can miss it.' },
    { id: 5, name: 'ADD carry-out (overflow) not reported', origin: 'teaching',
      detail: 'Overflowing additions answer 1 (success) with the wrapped sum instead of 2 (overflow).' },
    { id: 6, name: 'Port-4 request dropped when port 1 wins arbitration', origin: 'teaching',
      detail: 'Only visible with concurrent traffic: if ports 1 and 4 want the same unit in the same cycle, port 4 is released without ever being executed and never answers.' },
    { id: 7, name: 'Invalid command never answered', origin: 'teaching',
      detail: 'Opcodes 3, 4, 7..15 should get response 2. Instead the port hangs forever -- a liveness bug only a timeout catches.' }
  ];

  const M32 = 0xFFFFFFFF;
  const u = n => n >>> 0;
  const K = v => ({ v: u(v), x: 0 });            // known value

  // 4-state single-bit helpers: 0, 1 or 'x'
  const AND = (a, b) => (a === 0 || b === 0) ? 0 : (a === 1 && b === 1) ? 1 : 'x';
  const OR  = (a, b) => (a === 1 || b === 1) ? 1 : (a === 0 && b === 0) ? 0 : 'x';
  const XOR = (a, b) => (a === 'x' || b === 'x') ? 'x' : (a ^ b);
  const NOT = a => a === 'x' ? 'x' : 1 - a;
  const getb = (w, i) => ((w.x >>> i) & 1) ? 'x' : ((w.v >>> i) & 1);

  // ripple-carry adder, identical gate structure to calc1_top.v::ripple_add
  function rippleAdd(a, b, cin) {
    let c = cin, v = 0, x = 0;
    for (let i = 0; i < 32; i++) {
      const ai = getb(a, i), bi = getb(b, i);
      const p = XOR(ai, bi);
      const s = XOR(p, c);
      if (s === 'x') x |= (1 << i); else v |= (s << i);
      c = OR(AND(ai, bi), AND(c, p));
    }
    return { sum: { v: u(v), x: u(x) }, carry: c };
  }
  const notw = w => ({ v: u(~w.v & ~w.x), x: w.x });

  class Calc1 {
    constructor(bug = 0) { this.bug = bug; this.reset(); this.cycle = 0; }

    reset() {
      this.st = [0, 0, 0, 0, 0];
      this.cmd = [0, 0, 0, 0, 0];
      this.op1 = [0, 0, 0, 0, 0];
      this.op2 = [0, 0, 0, 0, 0];
      const pipe = () => [0, 1, 2].map(() => ({ v: false, port: 0, rsp: 0, dat: K(0), tag: null }));
      this.ap = pipe();
      this.sp = pipe();
      this.resp = [0, 0, 0, 0, 0];
      this.dout = [K(0), K(0), K(0), K(0), K(0)];
      this.dbg = { addWin: 0, shfWin: 0, invWin: 0, drop4: false };
    }

    /* Advance one rising edge of c_clk.
     *  inp = { reset: 0..127, cmd: [_,c1,c2,c3,c4], data: [_,d1,d2,d3,d4] }  (index 1..4)
     *  returns the registered outputs after the edge. */
    step(inp) {
      this.cycle++;
      const bug = this.bug;
      if (inp.reset) { this.reset(); return this.outputs(); }

      // ---------------- combinational: arbitration
      const isAdd = c => c === 1 || c === 2, isShf = c => c === 5 || c === 6;
      let addWin = 0, shfWin = 0, invWin = 0;
      for (let p = 4; p >= 1; p--) {
        if (this.st[p] === ST.PEND) {
          if (isAdd(this.cmd[p])) addWin = p;
          else if (isShf(this.cmd[p])) shfWin = p;
          else invWin = p;
        }
      }
      const drop4 = bug === 6 && this.st[4] === ST.PEND &&
        ((isAdd(this.cmd[4]) && addWin === 1) || (isShf(this.cmd[4]) && shfWin === 1));

      // ---------------- ADD unit
      let addRsp = 1, addDat = K(0);
      if (addWin) {
        const a = K(this.op1[addWin]);
        let b = K(this.op2[addWin]);
        if (addWin === 1 && bug === 1) {
          const b4 = (this.op2[1] >>> 4) & 1, b5 = (this.op2[1] >>> 5) & 1;
          if (b4 !== b5) b = { v: u(b.v & ~(1 << 4)), x: 1 << 4 };   // contention -> X on bit 4
        }
        if (this.cmd[addWin] === CMD.ADD) {
          const r = rippleAdd(a, b, 0);
          if (r.carry === 1 && bug !== 5) addRsp = 2; else addDat = r.sum;
        } else {
          const r = rippleAdd(a, notw(b), 1);
          if (bug === 2 && addWin === 1) addDat = K(0);
          else if (r.carry === 0) addRsp = 2;
          else addDat = r.sum;
        }
      }

      // ---------------- SHIFT unit
      let shfDat = K(0);
      if (shfWin) {
        const a = this.op1[shfWin], amt = this.op2[shfWin] & 31;
        if (this.cmd[shfWin] === CMD.SHL) {
          if (bug === 3 && amt === 0) shfDat = { v: 0, x: u(a) };
          else shfDat = K(a << amt);
        } else {
          if (bug === 4 && amt === 0) shfDat = K(0);
          else if (bug === 4 && amt === 1) shfDat = K(a);
          else shfDat = K(a >>> amt);
        }
      }

      // ---------------- sequential update (non-blocking semantics)
      const nst = this.st.slice(), ncmd = this.cmd.slice(), nop1 = this.op1.slice(), nop2 = this.op2.slice();
      for (let n = 1; n <= 4; n++) {
        switch (this.st[n]) {
          case ST.IDLE:
            if (inp.cmd[n] !== 0) { ncmd[n] = inp.cmd[n]; nop1[n] = u(inp.data[n]); nst[n] = ST.OP2; }
            break;
          case ST.OP2: nop2[n] = u(inp.data[n]); nst[n] = ST.PEND; break;
          case ST.PEND: if (addWin === n || shfWin === n || invWin === n) nst[n] = ST.BUSY; break;
          default: break;
        }
      }
      if (drop4) nst[4] = ST.IDLE;

      const nap = [{ v: addWin !== 0, port: addWin, rsp: addRsp, dat: addDat }, this.ap[0], this.ap[1]];
      const nsp = [{ v: shfWin !== 0, port: shfWin, rsp: 1, dat: shfDat }, this.sp[0], this.sp[1]];

      const nresp = [0, 0, 0, 0, 0], ndout = [K(0), K(0), K(0), K(0), K(0)];
      const respond = (port, rsp, dat) => {
        if (!port) return;
        nresp[port] = rsp; ndout[port] = dat; nst[port] = ST.IDLE;
      };
      if (this.ap[2].v) respond(this.ap[2].port, this.ap[2].rsp, this.ap[2].dat);
      if (this.sp[2].v) respond(this.sp[2].port, this.sp[2].rsp, this.sp[2].dat);
      if (invWin && bug !== 7) respond(invWin, 2, K(0));
      if (invWin && bug === 7) nst[invWin] = ST.BUSY;

      this.st = nst; this.cmd = ncmd; this.op1 = nop1; this.op2 = nop2;
      this.ap = nap; this.sp = nsp; this.resp = nresp; this.dout = ndout;
      this.dbg = { addWin, shfWin, invWin, drop4 };
      return this.outputs();
    }

    outputs() {
      return { resp: this.resp.slice(), data: this.dout.slice() };
    }
  }

  // Verilog-style hex formatting of a 4-state word (x = all 4 bits unknown, X = some)
  function fmtHex(w) {
    let s = '';
    for (let d = 7; d >= 0; d--) {
      const xm = (w.x >>> (d * 4)) & 0xF, vm = (w.v >>> (d * 4)) & 0xF;
      s += xm === 0xF ? 'x' : xm ? 'X' : vm.toString(16);
    }
    return s;
  }

  // Transaction-level reference model (the spec) -- same as calc1_pkg::calc1_ref_model
  function predict(cmd, a, b) {
    a = u(a); b = u(b);
    switch (cmd) {
      case 1: { const s = a + b; return s > M32 ? { resp: 2, data: 0 } : { resp: 1, data: u(s) }; }
      case 2: return b > a ? { resp: 2, data: 0 } : { resp: 1, data: u(a - b) };
      case 5: return { resp: 1, data: u(a << (b & 31)) };
      case 6: return { resp: 1, data: u(a >>> (b & 31)) };
      default: return { resp: 2, data: 0 };
    }
  }

  const api = { Calc1, BUGS, CMD, CMD_NAME, ST, ST_NAME, fmtHex, predict, rippleAdd };
  root.Calc1Model = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
