/* ui_method.js -- testbench diagram + in-browser regression (Nitish Sundarraj) */
(function (root) {
  'use strict';
  const B = root.Bench, M1 = root.Calc1Model, M3 = root.Calc3Model;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => n.toLocaleString('en-US');

  // ------------------------------------------------------------ diagram
  function diagram() {
    const box = (id, x, y, w, h, t, sub, col) => `
      <g id="${id}">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="var(--card)" stroke="${col || 'var(--border-strong)'}" stroke-width="${col ? 2 : 1.2}"/>
        <text x="${x + w / 2}" y="${y + 24}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--ink)">${t}</text>
        <text x="${x + w / 2}" y="${y + 42}" text-anchor="middle" font-size="11" fill="var(--muted)">${sub}</text>
        <text id="${id}N" x="${x + w / 2}" y="${y + h - 12}" text-anchor="middle" font-size="12" font-weight="700" fill="${col || 'var(--s1)'}" font-family="var(--mono)"></text>
      </g>`;
    const path = (id, d) => `<path id="${id}" d="${d}" fill="none" stroke="var(--axis)" stroke-width="1.6" marker-end="url(#arT)"/>`;
    const dot = (pid, dur, delay) => `<circle r="4" class="flowdot"><animateMotion dur="${dur}s" begin="${delay}s" repeatCount="indefinite"><mpath href="#${pid}"/></animateMotion></circle>`;
    let s = `<svg viewBox="0 0 1000 295" role="img" aria-label="Layered testbench architecture">
      <defs><marker id="arT" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--axis)"/></marker></defs>`;
    s += box('dGen', 10, 30, 150, 80, 'Generator', 'random + directed');
    s += box('dDrv', 220, 30, 160, 80, 'Drivers ×4', 'clocking blocks');
    s += box('dDut', 440, 30, 150, 80, 'DUT', 'RTL or netlist', 'var(--s7)');
    s += box('dMon', 650, 30, 150, 80, 'Monitor', 'samples every edge');
    s += box('dSb', 650, 200, 150, 80, 'Scoreboard', 'expected vs actual', 'var(--s3)');
    s += box('dRef', 440, 200, 150, 80, 'Reference model', 'the spec as code');
    s += box('dCov', 850, 115, 140, 80, 'Coverage', 'plan items hit', 'var(--s4)');
    s += path('pa', 'M160,70 L218,70') + path('pb', 'M380,70 L438,70') + path('pc', 'M590,70 L648,70');
    s += path('pd', 'M725,110 L725,198') + path('pe', 'M300,110 L300,240 L438,240') + path('pf', 'M590,240 L648,240');
    s += path('pg', 'M800,70 L920,70 L920,113') + path('ph', 'M800,240 L920,240 L920,197');
    s += `<text x="189" y="62" text-anchor="middle" font-size="10" fill="var(--muted)">mailbox</text>`;
    s += `<text x="306" y="160" font-size="10" fill="var(--muted)">issued txn</text>`;
    s += `<text x="734" y="160" font-size="10" fill="var(--muted)">observed</text>`;
    s += `<text x="619" y="232" text-anchor="middle" font-size="10" fill="var(--muted)">predict</text>`;
    s += dot('pa', 1.6, 0) + dot('pb', 1.6, .4) + dot('pc', 1.6, .8) + dot('pd', 1.6, 1.2) + dot('pe', 2.4, .6) + dot('pf', 1.6, 1.4);
    s += '</svg>';
    $('#tbDiagram').innerHTML = s;
  }
  function setDiag(vals) {
    for (const k in vals) { const n = document.getElementById(k + 'N'); if (n) n.textContent = vals[k]; }
  }

  // ------------------------------------------------------------ coverage bars
  function covBars(el, groups) {
    el.innerHTML = groups.map(g => {
      const pct = Math.min(100, 100 * g.hit / g.total);
      return `<div class="covrow" title="${esc(g.plan)}"><span>${esc(g.name)}</span><div class="covbar ${pct >= 100 ? 'full' : ''}"><i style="width:${pct}%"></i></div><span class="mono tiny tnum" style="text-align:right">${Math.min(g.hit, g.total)}/${g.total}</span></div>`;
    }).join('');
  }

  // ------------------------------------------------------------ closure curve
  function curve(el, pts, nMax) {
    const W = 520, H = 190, L = 40, R = 12, T = 10, Bm = 28;
    const xmax = Math.max(nMax || 1, pts.length ? pts[pts.length - 1][0] : 1);
    const X = v => L + (W - L - R) * v / xmax, Y = v => T + (H - T - Bm) * (1 - v / 100);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Coverage closure curve">`;
    for (const g of [0, 25, 50, 75, 100]) {
      s += `<line x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}" stroke="var(--grid)"/>`;
      s += `<text x="${L - 6}" y="${Y(g) + 4}" text-anchor="end">${g}%</text>`;
    }
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = Math.round(xmax * i / ticks);
      s += `<text x="${X(v)}" y="${H - 8}" text-anchor="middle">${fmt(v)}</text>`;
    }
    s += `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--axis)"/>`;
    if (pts.length) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
      s += `<path d="${d}" fill="none" stroke="var(--s1)" stroke-width="2" stroke-linejoin="round"/>`;
      const last = pts[pts.length - 1];
      s += `<circle cx="${X(last[0])}" cy="${Y(last[1])}" r="4" fill="var(--s1)" stroke="var(--card)" stroke-width="2"/>`;
    }
    s += `<rect id="curveHit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - Bm}" fill="transparent"/>`;
    s += `<line id="curveX" x1="0" x2="0" y1="${T}" y2="${Y(0)}" stroke="var(--ink2)" stroke-dasharray="3 3" visibility="hidden"/>`;
    el.innerHTML = s + '</svg>';
    const svg = el.querySelector('svg'), hit = el.querySelector('#curveHit'), cx = el.querySelector('#curveX'), tip = $('#tip');
    hit.addEventListener('mousemove', ev => {
      if (!pts.length) return;
      const r = svg.getBoundingClientRect(), vx = (ev.clientX - r.left) * W / r.width;
      const n = (vx - L) / (W - L - R) * xmax;
      let best = pts[0];
      for (const p of pts) if (Math.abs(p[0] - n) < Math.abs(best[0] - n)) best = p;
      cx.setAttribute('x1', X(best[0])); cx.setAttribute('x2', X(best[0])); cx.setAttribute('visibility', 'visible');
      tip.style.display = 'block'; tip.style.left = ev.clientX + 14 + 'px'; tip.style.top = ev.clientY + 14 + 'px';
      tip.innerHTML = `<b>${best[1].toFixed(1)}%</b> of plan covered<br><span class="muted">after ${fmt(best[0])} checked transactions</span>`;
    });
    hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; cx.setAttribute('visibility', 'hidden'); });
  }

  // ------------------------------------------------------------ runner UI
  const R = {
    run: null,
    init() {
      diagram();
      const fill = () => {
        const bugs = $('#rDesign').value === 'calc1' ? M1.BUGS : M3.BUGS;
        $('#rBug').innerHTML = bugs.map(b => `<option value="${b.id}">${b.id ? 'Bug ' + b.id + ': ' : '✓ '}${esc(b.name)}</option>`).join('');
        $('#rN').value = $('#rDesign').value === 'calc1' ? 2000 : 3000;
        const cov = $('#rDesign').value === 'calc1' ? new B.Calc1Coverage() : new B.Calc3Coverage();
        covBars($('#rCov'), cov.groups());
        curve($('#rCurve'), [], 100);
      };
      $('#rDesign').addEventListener('change', fill);
      fill();
      $('#rRun').addEventListener('click', () => this.start($('#rDesign').value, +$('#rBug').value, +$('#rN').value, +$('#rSeed').value));
    },
    start(design, bug, n, seed, onDone) {
      if (this.run) this.run.stopped = true;
      const run = this.run = new B.Runner(design, bug, Math.max(0, Math.min(50000, n)), seed || 1);
      const t0 = performance.now();
      $('#rRun').disabled = true;
      $('#rVerdict').innerHTML = '<span class="muted">running…</span>';
      const est = run.b.pending() + n + (design === 'calc1' ? 160 : 520);
      const frame = () => {
        if (run.stopped) return;
        const done = run.runSlice(4000);
        this.show(run, est, done, performance.now() - t0);
        if (!done) requestAnimationFrame(frame);
        else { $('#rRun').disabled = false; if (onDone) onDone(run); }
      };
      requestAnimationFrame(frame);
      return run;
    },
    show(run, est, done, ms) {
      const b = run.b, s = b.stats;
      covBars($('#rCov'), b.cov.groups());
      curve($('#rCurve'), run.curve.concat([[s.checked, b.cov.percent()]]), est);
      setDiag({ dGen: fmt(b.nextId), dDrv: fmt(b.nextId - b.pending()), dMon: fmt(s.checked), dSb: `${fmt(s.pass)} ✓  ${fmt(s.fail)} ✗`, dCov: b.cov.percent().toFixed(1) + '%', dDut: 'cycle ' + fmt(b.cycle), dRef: fmt(s.checked) + ' predictions' });
      const golden = run.bug === 0;
      let verdict;
      if (!done) verdict = `<span class="pill info">running</span> <span class="tnum">${fmt(s.checked)}</span> checked, <span class="tnum">${fmt(s.fail)}</span> failing`;
      else if (golden) verdict = s.fail === 0
        ? `<div class="explain good"><b>PASS</b>: ${fmt(s.checked)} transactions, 0 mismatches, ${b.cov.percent().toFixed(1)}% plan coverage in ${fmt(b.cycle)} cycles (${(ms / 1000).toFixed(2)} s in your browser).</div>`
        : `<div class="explain crit"><b>FALSE FAIL</b> on the golden design. This should never happen.</div>`;
      else verdict = s.fail > 0
        ? `<div class="explain crit"><b>BUG CAUGHT</b>: ${fmt(s.fail)} of ${fmt(s.checked)} checks failed. Kinds: ${Object.entries(s.kinds).map(([k, v]) => `<code>${k}</code> ×${fmt(v)}`).join(', ')}. Coverage ${b.cov.percent().toFixed(1)}%.</div>`
        : `<div class="explain"><b>ESCAPED</b>: the bug was not detected with this seed and length.</div>`;
      $('#rVerdict').innerHTML = verdict;
      const f = run.failures.slice(0, 40);
      $('#rFails').innerHTML = f.length ? f.map(t => {
        const d = run.design === 'calc1' ? B.Calc1Bench.describe(t) : B.Calc3Bench.describe(t);
        return `<div class="ln fail"><span class="muted">#${t.id}</span><span>${esc(d)}</span><span class="pill fail">${esc(t.verdict)}</span></div>`;
      }).join('') : `<div class="empty">${done ? 'No failures.' : '…'}</div>`;
    }
  };

  root.MethodUI = R;
})(window);
