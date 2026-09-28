/* ui_sim.js -- interactive Calc1 / Calc3 simulators (Nitish Sundarraj) */
(function (root) {
  'use strict';
  const M1 = root.Calc1Model, M3 = root.Calc3Model, B = root.Bench;
  const $ = s => document.querySelector(s);
  const u = n => n >>> 0;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const shx = v => '0x' + u(v).toString(16);
  const shx4 = w => { if (!w.x) return shx(w.v); const s = M1.fmtHex(w).replace(/^0+(?=.)/, ''); return '0x' + s; };
  const parseNum = s => {
    s = String(s).trim().replace(/_/g, '');
    if (!s) return 0;
    const n = /^0x/i.test(s) ? parseInt(s, 16) : /^0b/i.test(s) ? parseInt(s.slice(2), 2) : parseInt(s, 10);
    return isNaN(n) ? 0 : u(n);
  };
  const bugOptions = (sel, bugs) => {
    sel.innerHTML = bugs.map(b => `<option value="${b.id}">${b.id === 0 ? '✓ ' : 'Bug ' + b.id + ': '}${esc(b.name)}${b.origin === '2024' ? '  (2024 finding)' : b.origin === 'teaching' ? '  (teaching)' : b.origin ? '  (' + b.origin + ')' : ''}</option>`).join('');
  };

  // ======================================================================
  //  Calc1 micro-architecture SVG
  // ======================================================================
  const ST_COL = ['var(--muted)', 'var(--s4)', 'var(--s2)', 'var(--s1)'];
  function archCalc1(h, cmdOf) {
    const st = h ? h.st : [0, 0, 0, 0, 0];
    const ap = h ? h.ap : [{}, {}, {}], sp = h ? h.sp : [{}, {}, {}];
    const dbg = h ? h.dbg : { addWin: 0, shfWin: 0, invWin: 0 };
    const out = h ? h.out : { resp: [0, 0, 0, 0, 0], data: [0, 0, 0, 0, 0].map(() => ({ v: 0, x: 0 })) };
    let s = `<svg viewBox="0 0 830 330" role="img" aria-label="Calc1 micro-architecture">`;
    s += `<defs><marker id="ar1" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--axis)"/></marker></defs>`;
    for (let p = 1; p <= 4; p++) {
      const y = 12 + (p - 1) * 78, busy = st[p] !== 0, c = cmdOf ? cmdOf(p) : null;
      s += `<rect x="8" y="${y}" width="210" height="64" rx="8" fill="var(--card)" stroke="${busy ? ST_COL[st[p]] : 'var(--border-strong)'}" stroke-width="${busy ? 2 : 1}"/>`;
      s += `<text x="20" y="${y + 21}" font-weight="700" font-size="13" fill="var(--ink)">Port ${p}</text>`;
      s += `<rect x="140" y="${y + 8}" width="68" height="20" rx="10" fill="${ST_COL[st[p]]}" opacity="${busy ? 1 : 0.25}"/>`;
      s += `<text x="174" y="${y + 22}" text-anchor="middle" font-size="11" font-weight="700" fill="${busy ? '#fff' : 'var(--ink2)'}">${M1.ST_NAME[st[p]]}</text>`;
      if (c && busy) {
        s += `<text x="20" y="${y + 41}" font-size="11.5" fill="var(--ink2)" font-family="var(--mono)">${M1.CMD_NAME(c.cmd)}  op1=${shx(c.op1)}</text>`;
        s += `<text x="20" y="${y + 56}" font-size="11.5" fill="var(--ink2)" font-family="var(--mono)">${st[p] >= 2 ? 'op2=' + shx(c.op2) : 'op2 next cycle…'}</text>`;
      } else s += `<text x="20" y="${y + 46}" font-size="11.5" fill="var(--muted)">waiting for a command</text>`;
      s += `<line x1="218" y1="${y + 32}" x2="250" y2="${y + 32}" stroke="var(--axis)" stroke-width="1.5" marker-end="url(#ar1)"/>`;
    }
    // arbiter
    s += `<rect x="252" y="12" width="92" height="298" rx="8" fill="var(--surface)" stroke="var(--border-strong)"/>`;
    s += `<text x="298" y="34" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)">priority</text>`;
    s += `<text x="298" y="49" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)">arbiter</text>`;
    s += `<text x="298" y="68" text-anchor="middle" font-size="10" fill="var(--muted)">port 1 first</text>`;
    const win = (lbl, w, y) => `<text x="298" y="${y}" text-anchor="middle" font-size="11.5" font-family="var(--mono)" fill="${w ? 'var(--s1)' : 'var(--muted)'}" font-weight="${w ? 700 : 400}">${lbl} ← ${w ? 'P' + w : '–'}</text>`;
    s += win('ADD', dbg.addWin, 120) + win('SHF', dbg.shfWin, 250) + win('INV', dbg.invWin, 295);
    if (dbg.drop4) s += `<text x="298" y="160" text-anchor="middle" font-size="10.5" fill="var(--crit)" font-weight="700">P4 dropped!</text>`;
    // pipelines
    const pipe = (label, arr, y0) => {
      let t = `<text x="372" y="${y0 - 8}" font-size="12" font-weight="700" fill="var(--ink)">${label}</text>`;
      for (let k = 0; k < 3; k++) {
        const x = 372 + k * 100, e = arr[k] || {};
        t += `<rect x="${x}" y="${y0}" width="88" height="66" rx="8" fill="var(--card)" stroke="${e.v ? 'var(--s1)' : 'var(--border-strong)'}" stroke-width="${e.v ? 2 : 1}"/>`;
        t += `<text x="${x + 44}" y="${y0 + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">stage ${k}</text>`;
        if (e.v) {
          t += `<text x="${x + 44}" y="${y0 + 36}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--s1)">P${e.port} · r${e.rsp}</text>`;
          const dx = e.dat && e.dat.x;
          t += `<text x="${x + 44}" y="${y0 + 54}" text-anchor="middle" font-size="10.5" font-family="var(--mono)" fill="${dx ? 'var(--crit)' : 'var(--ink2)'}">${e.rsp === 1 ? esc(shx4(e.dat)) : 'error'}</text>`;
        }
        if (k < 2) t += `<line x1="${x + 88}" y1="${y0 + 33}" x2="${x + 100}" y2="${y0 + 33}" stroke="var(--axis)" stroke-width="1.5" marker-end="url(#ar1)"/>`;
      }
      return t;
    };
    s += `<line x1="344" y1="116" x2="370" y2="116" stroke="var(--axis)" stroke-width="1.5" marker-end="url(#ar1)"/>`;
    s += `<line x1="344" y1="246" x2="370" y2="246" stroke="var(--axis)" stroke-width="1.5" marker-end="url(#ar1)"/>`;
    s += pipe('ADD unit · add / sub', ap, 83) + pipe('SHIFT unit · shl / shr', sp, 213);
    // outputs
    s += `<line x1="660" y1="116" x2="676" y2="116" stroke="var(--axis)" stroke-width="1.5"/><line x1="660" y1="246" x2="676" y2="246" stroke="var(--axis)" stroke-width="1.5"/>`;
    s += `<line x1="676" y1="44" x2="676" y2="278" stroke="var(--axis)" stroke-width="1.5"/>`;
    for (let p = 1; p <= 4; p++) {
      const y = 12 + (p - 1) * 78, r = out.resp[p], d = out.data[p];
      s += `<line x1="676" y1="${y + 32}" x2="692" y2="${y + 32}" stroke="var(--axis)" stroke-width="1.5" marker-end="url(#ar1)"/>`;
      s += `<rect x="694" y="${y}" width="128" height="64" rx="8" fill="${r ? 'var(--accent-wash)' : 'var(--card)'}" stroke="${r ? 'var(--s3)' : 'var(--border-strong)'}" stroke-width="${r ? 2 : 1}"/>`;
      s += `<text x="706" y="${y + 20}" font-size="11" fill="var(--muted)">port ${p} output</text>`;
      s += `<text x="706" y="${y + 42}" font-size="13" font-weight="700" font-family="var(--mono)" fill="${r ? 'var(--ink)' : 'var(--muted)'}">${r}</text>`;
      s += `<text x="724" y="${y + 42}" font-size="11.5" font-family="var(--mono)" fill="${d.x ? 'var(--crit)' : 'var(--ink2)'}">${r ? esc(shx4(d)) : ''}</text>`;
      s += `<text x="706" y="${y + 57}" font-size="10" fill="var(--muted)">${r === 1 ? 'success' : r === 2 ? 'error / invalid' : ''}</text>`;
    }
    return s + '</svg>';
  }

  // ======================================================================
  //  Calc1 simulator
  // ======================================================================
  const C1_CMDS = [[1, 'ADD'], [2, 'SUB'], [5, 'SHL'], [6, 'SHR'], [3, 'INV 3'], [7, 'INV 7'], [12, 'INV 12']];
  const C1 = {
    bench: null, bug: 0, hidden: false, timer: null,
    init() {
      bugOptions($('#c1bug'), M1.BUGS);
      $('#c1bug').addEventListener('change', e => { this.hidden = false; this.rebuild(+e.target.value); });
      const ports = $('#c1ports');
      ports.innerHTML = [1, 2, 3, 4].map(p => `
        <div class="portrow"><span class="pn">P${p}</span>
          <div class="fields">
            <select id="c1cmd${p}" aria-label="Port ${p} command">${C1_CMDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
            <input type="text" id="c1a${p}" value="${[5, 10, 8, 16][p - 1]}" aria-label="Port ${p} operand 1">
            <input type="text" id="c1b${p}" value="${[3, 3, 2, 2][p - 1]}" aria-label="Port ${p} operand 2">
            <button class="btn sm" data-q="${p}" title="Queue on port ${p}">+</button>
          </div></div>`).join('');
      [1, 2, 3, 4].forEach(p => { $('#c1cmd' + p).value = [1, 2, 5, 6][p - 1]; });
      ports.addEventListener('click', e => {
        const p = +e.target.dataset.q; if (!p) return;
        this.bench.send(this.bench.make(p, +$('#c1cmd' + p).value, parseNum($('#c1a' + p).value), parseNum($('#c1b' + p).value)));
        this.render();
      });
      const presets = {
        'Test plan TC1–TC4': b => { b.send(b.make(1, 1, 5, 3)); b.send(b.make(2, 2, 10, 3)); b.send(b.make(3, 5, 8, 2)); b.send(b.make(4, 6, 16, 2)); },
        'All ports → adder': b => [1, 2, 3, 4].forEach(p => b.send(b.make(p, 1, 100 * p, p))),
        'Overflow / underflow': b => { b.send(b.make(1, 1, 0xFFFFFFFF, 1)); b.send(b.make(2, 2, 0, 1)); b.send(b.make(3, 1, 0x7FFFFFFF, 1)); b.send(b.make(4, 2, 5, 5)); },
        'Walking ones on op2': b => { for (let k = 0; k < 8; k++) b.send(b.make(1, 1, 0x100, 1 << k)); },
        'Shift by 0 / 1 / 2': b => { for (let s = 0; s < 3; s++) { b.send(b.make(1, 5, 0xF0, s)); b.send(b.make(2, 6, 0xF0, s)); } },
        'P1 vs P4 contention': b => { for (let k = 0; k < 3; k++) { b.send(b.make(1, 5, 1 + k, 1)); b.send(b.make(4, 5, 7 + k, 2)); } },
        'Invalid opcodes': b => [3, 7, 12, 15].forEach((c, i) => b.send(b.make(i + 1, c, 1, 1))),
        'Random ×20': b => { const r = B.rng(Date.now() & 0xFFFF); for (let i = 0; i < 20; i++) { const x = B.Calc1Tests.random(r); b.send(b.make(x.port, x.cmd, x.op1, x.op2, 0)); } }
      };
      $('#c1presets').innerHTML = Object.keys(presets).map(k => `<button class="btn" data-p="${esc(k)}">${esc(k)}</button>`).join('');
      $('#c1presets').addEventListener('click', e => { const k = e.target.dataset.p; if (k) { presets[k](this.bench); this.render(); } });
      $('#c1step').onclick = () => this.step(1);
      $('#c1step10').onclick = () => this.step(10);
      $('#c1reset').onclick = () => this.rebuild(this.bug);
      $('#c1run').onclick = () => this.toggleRun();
      this.rebuild(0);
    },
    rebuild(bug) {
      this.stop();
      this.bug = bug;
      this.bench = new B.Calc1Bench(bug);
      for (let i = 0; i < 9; i++) this.bench.tick();          // reset sequence
      this.render();
    },
    setHidden(bug) {
      this.hidden = true;
      const sel = $('#c1bug');
      let o = sel.querySelector('option[value="-1"]');
      if (!o) { o = document.createElement('option'); o.value = '-1'; sel.prepend(o); }
      o.textContent = '? Mystery DUT (bug hidden)';
      sel.value = '-1';
      this.rebuild(bug);
    },
    step(n) {
      for (let i = 0; i < n; i++) this.bench.tick();
      this.render();
    },
    toggleRun() { if (this.timer) this.stop(); else this.start(); },
    start() {
      $('#c1run').textContent = 'Pause ❚❚';
      const loop = () => {
        this.step(1);
        const ms = 1000 / +$('#c1speed').value;
        this.timer = setTimeout(loop, ms);
      };
      loop();
    },
    stop() { clearTimeout(this.timer); this.timer = null; const b = $('#c1run'); if (b) b.textContent = 'Run ▶'; },
    render() {
      const b = this.bench, h = b.hist[b.hist.length - 1];
      $('#c1cyc').textContent = `cycle ${b.cycle}`;
      $('#c1arch').innerHTML = archCalc1(h, p => b.drv[p].t);
      const q = [1, 2, 3, 4].map(p => b.q[p].length).reduce((a, x) => a + x, 0);
      $('#c1archnote').textContent = q ? `${q} queued in the driver` : '';
      // waveform: last 28 cycles
      const hs = b.hist.slice(-41);
      const cols = hs.slice(1).map((x, i) => ({ cycle: x.cycle, inp: x.inp, out: hs[i].out }));
      const sigs = [{ name: 'c_clk', kind: 'clock' }, { name: 'reset', kind: 'bit', get: c => c.inp.reset, color: 'var(--muted)' }];
      for (let p = 1; p <= 4; p++) {
        sigs.push({ name: `req${p}_cmd_in`, kind: 'bus', color: 'var(--s1)', get: c => c.inp.cmd[p] ? M1.CMD_NAME(c.inp.cmd[p]) : '' });
        sigs.push({ name: `req${p}_data_in`, kind: 'bus', color: 'var(--s1)', get: c => (c.inp.cmd[p] || c.inp.data[p]) ? shx(c.inp.data[p]) : '' });
        sigs.push({ name: `out_resp${p}`, kind: 'bus', color: 'var(--s3)', get: c => c.out.resp[p] ? String(c.out.resp[p]) : '' });
        sigs.push({ name: `out_data${p}`, kind: 'bus', color: 'var(--s3)', get: c => {
          if (!c.out.resp[p]) return '';
          const w = c.out.data[p];
          return w.x ? { text: shx4(w), x: true, title: 'bits unknown (X): ' + M1.fmtHex(w) } : shx(w.v);
        } });
      }
      root.Wave.render($('#c1wave'), { cols, signals: sigs, colW: 50, fit: true, id: 'c1' });
      // scoreboard
      const s = b.stats;
      $('#c1score').innerHTML = `<span class="pill neutral tnum">${s.checked} checked</span> <span class="pill pass tnum">✓ ${s.pass}</span> <span class="pill ${s.fail ? 'fail' : 'neutral'} tnum">✗ ${s.fail}</span>`;
      const lines = b.done.slice(-80).reverse().map(t => {
        const exp = `exp ${t.exp.resp}${t.exp.resp === 1 ? '/' + shx(t.exp.data) : ''}`;
        const got = t.timedOut ? 'got nothing (timeout)' : `got ${t.act.resp}${t.act.resp === 1 ? '/' + shx4(t.act.data) : ''}`;
        const ok = t.verdict === 'pass';
        return `<div class="ln ${ok ? '' : 'fail'}"><span class="muted">#${t.id}</span><span>${esc(B.Calc1Bench.describe(t))} → ${esc(exp)}, ${esc(got)}${ok ? '' : ' <b>[' + t.verdict + ']</b>'}</span><span class="pill ${ok ? 'pass' : 'fail'}">${ok ? '✓ PASS' : '✗ FAIL'}</span></div>`;
      });
      $('#c1log').innerHTML = lines.length ? lines.join('') : '<div class="empty">Queue a command (+) or pick a preset, then press Step.</div>';
    }
  };

  // ======================================================================
  //  Calc3 simulator
  // ======================================================================
  const C3_CMDS = [[9, 'STORE'], [10, 'FETCH'], [1, 'ADD'], [2, 'SUB'], [5, 'SHL'], [6, 'SHR'], [12, 'BZ'], [13, 'BE'], [3, 'INV 3']];
  const RESP3 = { 1: 'OK', 2: 'ERR', 3: 'SKIP' };
  const C3 = {
    bench: null, bug: 0, timer: null, hidden: false,
    init() {
      bugOptions($('#c3bug'), M3.BUGS);
      $('#c3bug').addEventListener('change', e => { this.hidden = false; this.rebuild(+e.target.value); });
      const defs = [[9, 0, 0, 1, '25'], [9, 0, 0, 2, '5'], [1, 1, 2, 3, '0'], [10, 3, 0, 0, '0']];
      $('#c3ports').innerHTML = [1, 2, 3, 4].map(p => `
        <div class="portrow c3"><span class="pn">P${p}</span>
          <div class="fields">
            <select id="c3cmd${p}" aria-label="Port ${p} command">${C3_CMDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>
            <input type="number" min="0" max="15" id="c3d1${p}" value="${defs[p - 1][1]}" title="d1" aria-label="Port ${p} d1">
            <input type="number" min="0" max="15" id="c3d2${p}" value="${defs[p - 1][2]}" title="d2" aria-label="Port ${p} d2">
            <input type="number" min="0" max="15" id="c3r1${p}" value="${defs[p - 1][3]}" title="r1" aria-label="Port ${p} r1">
            <input type="text" class="data" id="c3dt${p}" value="${defs[p - 1][4]}" title="data (store only)" aria-label="Port ${p} data">
            <button class="btn sm" data-q="${p}" title="Queue on port ${p}">+</button>
          </div></div>`).join('');
      [1, 2, 3, 4].forEach(p => { $('#c3cmd' + p).value = defs[p - 1][0]; });
      $('#c3ports').addEventListener('click', e => {
        const p = +e.target.dataset.q; if (!p) return;
        const cl = v => Math.max(0, Math.min(15, +v || 0));
        this.bench.send(this.bench.make(p, +$('#c3cmd' + p).value, cl($('#c3d1' + p).value), cl($('#c3d2' + p).value), cl($('#c3r1' + p).value), parseNum($('#c3dt' + p).value)));
        this.render();
      });
      const C = M3.C;
      const presets = {
        'Store → add → fetch': b => { [[C.STORE, 0, 0, 1, 25], [C.STORE, 0, 0, 2, 5], [C.ADD, 1, 2, 3, 0], [C.FETCH, 3, 0, 0, 0]].forEach(x => b.send(b.make(1, ...x))); },
        'Out-of-order tags': b => { [[C.STORE, 0, 0, 1, 3], [C.SHL, 1, 1, 2, 0], [C.FETCH, 1, 0, 0, 0], [C.FETCH, 2, 0, 0, 0]].forEach(x => b.send(b.make(1, ...x))); },
        'Branch skips next': b => { [[C.STORE, 0, 0, 0, 0], [C.STORE, 0, 0, 5, 0xAAAA], [C.BZ, 0, 0, 0, 0], [C.STORE, 0, 0, 5, 0xBAD], [C.FETCH, 5, 0, 0, 0]].forEach(x => b.send(b.make(2, ...x))); },
        'Skip + ADD side effect': b => { [[C.STORE, 0, 0, 0, 0], [C.STORE, 0, 0, 1, 1], [C.BZ, 0, 0, 0, 0], [C.ADD, 1, 1, 6, 0], [C.FETCH, 6, 0, 0, 0]].forEach(x => b.send(b.make(1, ...x))); },
        'Same-cycle cross-port': b => { b.send(b.make(1, C.STORE, 0, 0, 7, 0x1234)); b.send(b.make(2, C.FETCH, 7)); b.send(b.make(3, C.FETCH, 7)); },
        'Shift by register': b => { [[C.STORE, 0, 0, 1, 1], [C.STORE, 0, 0, 3, 4], [C.SHL, 1, 3, 4, 0], [C.FETCH, 4, 0, 0, 0]].forEach(x => b.send(b.make(3, ...x))); },
        'P4 underflow': b => { [[C.STORE, 0, 0, 1, 1], [C.STORE, 0, 0, 2, 2], [C.SUB, 1, 2, 3, 0], [C.FETCH, 3, 0, 0, 0]].forEach(x => b.send(b.make(4, ...x))); },
        'P3 writes R15': b => { [[C.STORE, 0, 0, 15, 0xF00D], [C.FETCH, 15, 0, 0, 0]].forEach(x => b.send(b.make(3, ...x))); },
        'BE low-16 trap': b => { [[C.STORE, 0, 0, 10, 0x11234], [C.STORE, 0, 0, 11, 0x21234], [C.BE, 10, 11, 0, 0], [C.STORE, 0, 0, 12, 0x600D], [C.FETCH, 12, 0, 0, 0]].forEach(x => b.send(b.make(1, ...x))); },
        '4 in flight': b => { for (let k = 0; k < 4; k++) b.send(b.make(1, C.SHR, k, 1, 8 + k, 0)); },
        'Random ×30': b => { const r = B.rng(Date.now() & 0xFFFF); for (let i = 0; i < 30; i++) { const x = B.Calc3Tests.random(r); b.send(b.make(x.port, x.cmd, x.d1, x.d2, x.r1, x.data, 0)); } }
      };
      $('#c3presets').innerHTML = Object.keys(presets).map(k => `<button class="btn" data-p="${esc(k)}">${esc(k)}</button>`).join('');
      $('#c3presets').addEventListener('click', e => { const k = e.target.dataset.p; if (k) { presets[k](this.bench); this.render(); } });
      $('#c3step').onclick = () => this.step(1);
      $('#c3step10').onclick = () => this.step(10);
      $('#c3reset').onclick = () => this.rebuild(this.bug);
      $('#c3run').onclick = () => (this.timer ? this.stop() : this.start());
      this.rebuild(0);
    },
    rebuild(bug) {
      this.stop(); this.bug = bug; this.bench = new B.Calc3Bench(bug);
      for (let i = 0; i < 9; i++) this.bench.tick();
      this.render();
    },
    setHidden(bug) {
      const sel = $('#c3bug');
      let o = sel.querySelector('option[value="-1"]');
      if (!o) { o = document.createElement('option'); o.value = '-1'; sel.prepend(o); }
      o.textContent = '? Mystery DUT (bug hidden)';
      sel.value = '-1';
      this.hidden = true;
      this.rebuild(bug);
    },
    step(n) { for (let i = 0; i < n; i++) this.bench.tick(); this.render(); },
    start() {
      $('#c3run').textContent = 'Pause ❚❚';
      const loop = () => { this.step(1); this.timer = setTimeout(loop, 1000 / +$('#c3speed').value); };
      loop();
    },
    stop() { clearTimeout(this.timer); this.timer = null; const b = $('#c3run'); if (b) b.textContent = 'Run ▶'; },
    render() {
      const b = this.bench, h = b.hist[b.hist.length - 1];
      $('#c3cyc').textContent = `cycle ${b.cycle}`;
      const written = new Set((h.events || []).filter(e => e.wr).map(e => e.r1));
      $('#c3rf').innerHTML = h.rf.map((v, i) => `<div class="reg ${written.has(i) ? 'hot' : ''}"><div class="rn">R${i}</div>${shx(v)}</div>`).join('');
      let sl = '<table class="small"><thead><tr><th>port</th><th>T0</th><th>T1</th><th>T2</th><th>T3</th></tr></thead><tbody>';
      for (let p = 1; p <= 4; p++) {
        sl += `<tr><td class="mono">P${p}${h.skip[p] ? ' <span class="pill info" title="next command will be skipped">skip</span>' : ''}</td>`;
        for (let t = 0; t < 4; t++) {
          const o = h.slots[p][t];
          sl += o.v ? `<td class="mono"><b>${M3.CMD_NAME(o.cmd)}</b> <span class="muted">${o.cnt}</span></td>` : '<td class="muted">·</td>';
        }
        sl += '</tr>';
      }
      $('#c3slots').innerHTML = sl + '</tbody></table>';
      const hs = b.hist.slice(-41);
      const cols = hs.slice(1).map((x, i) => ({ cycle: x.cycle, inp: x.inp, out: hs[i].out }));
      const sigs = [{ name: 'c_clk', kind: 'clock' }];
      const reqTxt = (c, p) => {
        const k = c.inp.cmd[p]; if (!k) return '';
        const n = { 9: 'ST', 10: 'FE', 1: 'ADD', 2: 'SUB', 5: 'SHL', 6: 'SHR', 12: 'BZ', 13: 'BE' }[k] || 'INV';
        return { text: `${n}·T${c.inp.tag[p]}`, title: `${M3.CMD_NAME(k)} d1=R${c.inp.d1[p]} d2=R${c.inp.d2[p]} r1=R${c.inp.r1[p]} tag=${c.inp.tag[p]} data=${shx(c.inp.data[p])}` };
      };
      for (let p = 1; p <= 4; p++) {
        sigs.push({ name: `req${p}_cmd/tag`, kind: 'bus', color: 'var(--s1)', get: c => reqTxt(c, p) });
        sigs.push({ name: `out${p}_resp/tag`, kind: 'bus', color: 'var(--s2)', get: c => c.out[p].resp ? `${RESP3[c.out[p].resp]}·T${c.out[p].tag}` : '' });
        sigs.push({ name: `out${p}_data`, kind: 'bus', color: 'var(--s3)', get: c => c.out[p].resp ? shx(c.out[p].data) : '' });
      }
      root.Wave.render($('#c3wave'), { cols, signals: sigs, colW: 56, fit: true, id: 'c3' });
      const s = b.stats;
      $('#c3score').innerHTML = `<span class="pill neutral tnum">${s.checked} checked</span> <span class="pill pass tnum">✓ ${s.pass}</span> <span class="pill ${s.fail ? 'fail' : 'neutral'} tnum">✗ ${s.fail}</span>`;
      const lines = b.done.slice(-80).reverse().map(t => {
        const e = t.exp, a = t.act;
        const exp = `exp ${RESP3[e.resp]}${t.cmd === 10 && e.resp === 1 ? ' ' + shx(e.data) : ''}`;
        const got = t.timedOut ? 'got nothing (timeout)' : `got ${RESP3[a.resp] || a.resp}${t.cmd === 10 && a.resp === 1 ? ' ' + shx(a.data) : ''}`;
        const ok = t.verdict === 'pass';
        const ooo = t.tResp && t.tAccept ? `<span class="muted"> · lat ${t.tResp - t.tAccept}</span>` : '';
        return `<div class="ln ${ok ? '' : 'fail'}"><span class="muted">#${t.id}</span><span>${esc(B.Calc3Bench.describe(t))} → ${esc(exp)}, ${esc(got)}${ooo}${ok ? '' : ' <b>[' + t.verdict + ']</b>'}</span><span class="pill ${ok ? 'pass' : 'fail'}">${ok ? '✓ PASS' : '✗ FAIL'}</span></div>`;
      });
      const unexpected = b.stats.kinds.unexpected_tag ? `<div class="ln fail"><span></span><span>${b.stats.kinds.unexpected_tag} response(s) carried a tag that was not outstanding</span><span class="pill fail">✗</span></div>` : '';
      $('#c3log').innerHTML = (unexpected + lines.join('')) || '<div class="empty">Queue a command (+) or pick a preset, then press Step.</div>';
    }
  };

  // ======================================================================
  //  Static diagrams in the "Designs" section
  // ======================================================================
  function renderProto() {
    const b = new B.Calc1Bench(0);
    for (let i = 0; i < 9; i++) b.tick();
    b.send(b.make(1, 1, 5, 3));
    for (let i = 0; i < 9; i++) b.tick();
    const hs = b.hist.slice(-10);
    const cols = hs.slice(1).map((x, i) => ({ cycle: x.cycle, label: 'T' + i, inp: x.inp, out: hs[i].out }));
    root.Wave.render($('#protoCalc1'), {
      id: 'pr', colW: 44, labW: 104, cols, signals: [
        { name: 'c_clk', kind: 'clock' },
        { name: 'req1_cmd_in', kind: 'bus', get: c => c.inp.cmd[1] ? 'ADD' : '' },
        { name: 'req1_data_in', kind: 'bus', get: c => (c.inp.cmd[1] || c.inp.data[1]) ? String(c.inp.data[1]) : '' },
        { name: 'out_resp1', kind: 'bus', color: 'var(--s3)', get: c => c.out.resp[1] ? String(c.out.resp[1]) : '' },
        { name: 'out_data1', kind: 'bus', color: 'var(--s3)', get: c => c.out.resp[1] ? String(c.out.data[1].v) : '' }
      ]
    });
  }

  function renderArch3() {
    const box = (x, y, w, h, t1, t2, col) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="var(--card)" stroke="${col || 'var(--border-strong)'}" stroke-width="${col ? 2 : 1}"/>
      <text x="${x + w / 2}" y="${y + h / 2 - (t2 ? 3 : -4)}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)">${t1}</text>
      ${t2 ? `<text x="${x + w / 2}" y="${y + h / 2 + 13}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${t2}</text>` : ''}`;
    const ar = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--axis)" stroke-width="1.5" marker-end="url(#ar3)"/>`;
    let s = `<svg viewBox="0 0 560 250" role="img" aria-label="Calc3 data flow"><defs><marker id="ar3" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--axis)"/></marker></defs>`;
    for (let p = 0; p < 4; p++) { s += box(6, 8 + p * 60, 84, 48, 'Port ' + (p + 1), 'cmd·regs·tag'); s += ar(90, 32 + p * 60, 128, 125); }
    s += box(130, 80, 120, 90, 'execute', 'port order 1→4', 'var(--s1)');
    s += box(130, 196, 120, 46, 'R0 … R15', '16 × 32 bit');
    s += `<line x1="190" y1="170" x2="190" y2="196" stroke="var(--s1)" stroke-width="1.5" stroke-dasharray="3 3"/>`;
    s += ar(250, 105, 300, 50) + ar(250, 125, 300, 125) + ar(250, 145, 300, 200);
    s += box(302, 26, 108, 46, '1 cycle', 'store · fetch · branch');
    s += box(302, 102, 108, 46, '3 cycles', 'add · sub');
    s += box(302, 178, 108, 46, '4 cycles', 'shl · shr');
    s += ar(410, 50, 444, 118) + ar(410, 125, 444, 125) + ar(410, 200, 444, 132);
    s += box(446, 84, 108, 84, 'per-port', 'lowest ready tag', 'var(--s3)');
    s += `<text x="500" y="186" text-anchor="middle" font-size="10.5" fill="var(--muted)">→ outN_resp/tag/data</text>`;
    $('#archCalc3Static').innerHTML = s + '</svg>';
    $('#archCalc1Static').innerHTML = archCalc1(null, null);
  }

  root.SimUI = { C1, C3, renderProto, renderArch3, archCalc1 };
})(window);
