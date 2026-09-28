/* ui_findings.js -- charts built from the 2024 Questa logs (Nitish Sundarraj) */
(function (root) {
  'use strict';
  const M1 = root.Calc1Model;
  const $ = s => document.querySelector(s);
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const tip = () => $('#tip');
  const showTip = (ev, html) => { const t = tip(); t.innerHTML = html; t.style.display = 'block'; t.style.left = Math.min(ev.clientX + 14, innerWidth - 330) + 'px'; t.style.top = ev.clientY + 14 + 'px'; };
  const hideTip = () => { tip().style.display = 'none'; };

  // 4-state reproduction of the faulty port-1 adder (bug 1) -- same as the RTL
  function faultyAdd(a, b) {
    const b4 = (b >>> 4) & 1, b5 = (b >>> 5) & 1;
    const op2 = b4 !== b5 ? { v: (b & ~16) >>> 0, x: 16 } : { v: b >>> 0, x: 0 };
    return M1.rippleAdd({ v: a >>> 0, x: 0 }, op2, 0);
  }
  const fmtLog = w => M1.fmtHex(w).replace(/x/g, 'X');       // Questa prints X for any unknown digit

  let F = null;

  // ------------------------------------------------------------ finding 1
  function heat() {
    const cv = $('#f1heat'), rows = F.calc1_add.grid;
    const W = 1001, RH = 16;
    cv.width = W; cv.height = rows.length * RH;
    const ctx = cv.getContext('2d');
    const cx = css('--crit'), cg = css('--grid'), cp = css('--surface');
    ctx.fillStyle = cp; ctx.fillRect(0, 0, W, cv.height);
    rows.forEach((r, i) => {
      for (let k = 0; k < r.bits.length; k++) {
        const ch = r.bits[k];
        if (ch === '9') continue;
        ctx.fillStyle = ch === '1' ? cx : cg;
        ctx.fillRect(r.b0 + k, i * RH + 1, 1, RH - 2);
      }
    });
    cv.onmousemove = ev => {
      const rc = cv.getBoundingClientRect();
      const b = Math.floor((ev.clientX - rc.left) * W / rc.width), i = Math.floor((ev.clientY - rc.top) * cv.height / rc.height / RH);
      const r = rows[i]; if (!r) return hideTip();
      const k = b - r.b0, ch = r.bits[k];
      if (ch == null || ch === '9') return showTip(ev, `a = ${r.a}, b = ${b}<br><span class="muted">not in the saved log excerpt</span>`);
      const res = faultyAdd(r.a, b);
      showTip(ev, `<b>${r.a} + ${b}</b> (b bits 5,4 = ${(b >> 5) & 1}${(b >> 4) & 1})<br>log: <span class="mono">${fmtLog(res.sum)}</span><br><span class="muted">true sum 0x${(r.a + b).toString(16).padStart(8, '0')} · ${ch === '1' ? 'X result' : 'correct'}</span>`);
    };
    cv.onmouseleave = hideTip;
    cv.onclick = ev => {
      const rc = cv.getBoundingClientRect();
      const b = Math.floor((ev.clientX - rc.left) * W / rc.width), i = Math.floor((ev.clientY - rc.top) * cv.height / rc.height / RH);
      if (rows[i]) { $('#f1b').value = b; setA(rows[i].a); bits(); }
    };
  }
  let curA = 997;
  function setA(a) { curA = a; document.querySelectorAll('#f1a button').forEach(x => x.classList.toggle('active', +x.dataset.v === a)); }
  function bits() {
    const b = +$('#f1b').value, a = curA;
    $('#f1bv').textContent = b;
    const res = faultyAdd(a, b);
    const N = 12;
    const cell = (val, hl) => `<div class="b ${val === 'x' ? 'x' : val === 1 ? 'one' : ''} ${hl ? 'hl' : ''}">${val === 'x' ? 'X' : val}</div>`;
    const bitOf = (w, i) => ((w.x >>> i) & 1) ? 'x' : ((w.v >>> i) & 1);
    let h = '<span></span>';
    for (let i = N - 1; i >= 0; i--) h += `<div class="idx">${i}</div>`;
    const row = (lab, w) => { let s = `<span class="lab">${lab}</span>`; for (let i = N - 1; i >= 0; i--) s += cell(bitOf(w, i), i === 4 || i === 5); return s; };
    const b4 = (b >>> 4) & 1, b5 = (b >>> 5) & 1;
    const seen = b4 !== b5 ? { v: (b & ~16) >>> 0, x: 16 } : { v: b, x: 0 };
    h += row('op1 = a', { v: a, x: 0 });
    h += row('op2 = b', { v: b, x: 0 });
    h += row('adder sees', seen);
    h += row('sum', res.sum);
    $('#f1bits').innerHTML = h;
    const logged = fmtLog(res.sum);
    const inLog = F.calc1_add.grid.find(r => r.a === a);
    const present = inLog && b >= inLog.b0 && b < inLog.b0 + inLog.bits.length && inLog.bits[b - inLog.b0] !== '9';
    $('#f1line').innerHTML = (b4 !== b5
      ? `<span class="pill fail">X</span> bit 4 (${b4}) ≠ bit 5 (${b5}): the shorted nets fight, bit 4 is unknown, and the carry chain spreads it until both operand bits agree.`
      : `<span class="pill pass">OK</span> bit 4 = bit 5 = ${b4}: both drivers agree, so the short is invisible and the sum is correct.`) +
      `<div class="mono small" style="margin-top:6px">ADD operation result: ${a.toString(16).padStart(8, '0')} + ${b.toString(16).padStart(8, '0')} = ${logged}</div>` +
      `<div class="tiny muted">${present ? 'This exact line is in the 2024 log.' : 'Not in the saved excerpt; the model predicts this line.'}</div>`;
  }

  // ------------------------------------------------------------ SVG grid helper
  function grid(el, nx, ny, cellFn, opt) {
    const cs = opt.cs || 18, L = 34, T = 8, W = L + nx * cs + 4, H = T + ny * cs + 26;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${opt.label}">`;
    for (let y = 0; y < ny; y++) {
      if (y % (opt.yStep || 1) === 0) s += `<text x="${L - 6}" y="${T + y * cs + cs * 0.7}" text-anchor="end">${opt.yLab(y)}</text>`;
      for (let x = 0; x < nx; x++) {
        const c = cellFn(x, y);
        if (!c) continue;
        s += `<rect data-x="${x}" data-y="${y}" x="${L + x * cs + 1}" y="${T + y * cs + 1}" width="${cs - 2}" height="${cs - 2}" rx="3" fill="${c.fill}"/>`;
      }
    }
    for (let x = 0; x < nx; x += (opt.xStep || 1)) s += `<text x="${L + x * cs + cs / 2}" y="${H - 10}" text-anchor="middle">${opt.xLab(x)}</text>`;
    el.innerHTML = s + '</svg>';
    el.querySelector('svg').addEventListener('mousemove', ev => {
      const r = ev.target.closest('rect'); if (!r || r.dataset.x == null) return hideTip();
      showTip(ev, opt.tip(+r.dataset.x, +r.dataset.y));
    });
    el.querySelector('svg').addEventListener('mouseleave', hideTip);
  }

  function subGrid() {
    const cells = F.calc1_sub.cells, map = {};
    cells.forEach(c => { map[c.a + ',' + c.b] = c; });
    grid($('#f2grid'), 11, 11, (x, y) => {
      const c = map[y + ',' + x]; if (!c) return null;
      return { fill: c.ok ? 'var(--good)' : c.got === 'x' ? 'var(--s4)' : 'var(--crit)' };
    }, {
      label: 'SUB results grid', cs: 20, xLab: x => x, yLab: y => y,
      tip: (x, y) => { const c = map[y + ',' + x]; return `<b>${y} − ${x}</b><br>expected ${c.b > c.a ? 'underflow (resp 2)' : c.exp}<br>calculator: ${c.got}${c.ok ? ' ✓' : ' ✗'}`; }
    });
  }

  let shiftOp = 'SLL';
  function shiftGrid() {
    const map = {};
    F.calc1_shift.cells.filter(c => c.op === shiftOp).forEach(c => { map[c.a + ',' + c.s] = c; });
    grid($('#f3grid'), 32, 21, (x, y) => {
      const c = map[y + ',' + x]; if (!c) return null;
      return { fill: c.ok ? 'var(--good)' : 'var(--crit)' };
    }, {
      label: 'Shift results grid', cs: 15, xStep: 4, yStep: 5, xLab: x => x, yLab: y => y,
      tip: (x, y) => { const c = map[y + ',' + x]; return `<b>${y} ${shiftOp === 'SLL' ? '&lt;&lt;' : '&gt;&gt;'} ${x}</b><br>expected ${c.exp}<br>calculator: ${c.got}${c.ok ? ' ✓' : ' ✗'}`; }
    });
  }

  function mismatchBars() {
    const k = F.calc3.mismatch_kinds_in_excerpt;
    const items = Object.entries(k).sort((a, b) => b[1] - a[1]);
    const max = Math.max(...items.map(i => i[1]));
    const W = 460, rowH = 30, L = 90, H = items.length * rowH + 10;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="2024 Calc3 mismatch kinds">`;
    items.forEach(([name, v], i) => {
      const y = 6 + i * rowH, w = (W - L - 50) * v / max;
      s += `<text x="${L - 8}" y="${y + 16}" text-anchor="end" style="fill:var(--ink2)">${name.replace(/\+/g, ' + ')}</text>`;
      s += `<rect x="${L}" y="${y + 4}" width="${Math.max(2, w)}" height="16" rx="4" fill="var(--s1)"><title>${name}: ${v}</title></rect>`;
      s += `<text x="${L + w + 6}" y="${y + 16}" style="fill:var(--ink)">${v}</text>`;
    });
    $('#f5bars').innerHTML = s + '</svg>';
  }

  function init(data) {
    F = data;
    const a = F.calc1_add;
    $('#f1agree').textContent = `${a.hypothesis_agreement[0].toLocaleString()} / ${a.hypothesis_agreement[1].toLocaleString()}`;
    $('#f5c').textContent = F.calc3.final_counters.correct.toLocaleString();
    $('#f5e').textContent = F.calc3.final_counters.errors.toLocaleString();
    $('#f5s').textContent = F.calc3.stale_port_matches.toLocaleString();
    $('#f3stat').textContent = F.calc1_shift.totals.error;
    heat(); bits(); subGrid(); shiftGrid(); mismatchBars();
    $('#f1b').addEventListener('input', bits);
    $('#f1a').addEventListener('click', e => { if (e.target.dataset.v) { setA(+e.target.dataset.v); bits(); } });
    $('#f3op').addEventListener('click', e => {
      if (!e.target.dataset.v) return;
      shiftOp = e.target.dataset.v;
      document.querySelectorAll('#f3op button').forEach(x => x.classList.toggle('active', x === e.target));
      shiftGrid();
    });
    // repaint the canvas when the theme changes
    new MutationObserver(heat).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', heat);
  }

  root.FindingsUI = { init, faultyAdd };
})(window);
