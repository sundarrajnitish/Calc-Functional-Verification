/* app.js -- page wiring: tabs, theme, data, results, bug hunt (Nitish Sundarraj) */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => Number(n).toLocaleString('en-US');
  const getJSON = p => fetch(p).then(r => { if (!r.ok) throw new Error(p); return r.json(); });

  // ---------------------------------------------------------------- theme
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
  });

  // ---------------------------------------------------------------- tabs
  document.addEventListener('click', e => {
    const t = e.target.closest('.tab'); if (!t) return;
    const g = t.dataset.tabgroup;
    $$(`.tab[data-tabgroup="${g}"]`).forEach(x => x.classList.toggle('active', x === t));
    $$(`.tab[data-tabgroup="${g}"]`).forEach(x => { const p = $(`[data-pane="${x.dataset.tab}"]`); if (p) p.hidden = x !== t; });
  });
  const openTab = id => { const t = $(`.tab[data-tab="${id}"]`); if (t) t.click(); };

  // ---------------------------------------------------------------- nav highlight
  const links = $$('.navlinks a');
  const io = new IntersectionObserver(ents => {
    ents.forEach(en => { if (en.isIntersecting) links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id)); });
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('section[id]').forEach(s => io.observe(s));

  // ---------------------------------------------------------------- components
  SimUI.renderProto();
  SimUI.renderArch3();
  SimUI.C1.init();
  SimUI.C3.init();
  MethodUI.init();

  getJSON('data/findings2024.json').then(FindingsUI.init).catch(err => {
    $('#findings .lede').insertAdjacentHTML('afterend', `<div class="explain crit small">Could not load data/findings2024.json (${esc(err.message)}). Serve the docs/ folder over HTTP.</div>`);
  });

  // ---------------------------------------------------------------- results
  let REG = null, resDesign = 'calc1';
  function resultsTable() {
    if (!REG) return;
    const rows = REG.filter(r => r.design === resDesign);
    const byBug = {};
    rows.forEach(r => { (byBug[r.bug] = byBug[r.bug] || []).push(r); });
    const seeds = [...new Set(rows.map(r => r.seed))].sort();
    let h = `<thead><tr><th>variant</th><th>verdict</th><th class="num">failures (seed ${seeds.join(' / ')})</th><th class="num">checked</th><th class="num">coverage</th><th>first failure reported by the scoreboard</th></tr></thead><tbody>`;
    Object.keys(byBug).sort((a, b) => a - b).forEach(bug => {
      const rs = byBug[bug].sort((a, b) => a.seed - b.seed), r0 = rs[0];
      const golden = +bug === 0, ok = rs.every(r => golden ? r.fail === 0 : r.fail > 0);
      const pill = golden ? (ok ? '<span class="pill pass">✓ PASS</span>' : '<span class="pill fail">✗ FALSE FAIL</span>')
                          : (ok ? '<span class="pill pass">✓ CAUGHT</span>' : '<span class="pill fail">✗ ESCAPED</span>');
      const ff = (r0.first_fail || '').replace(/^\[FAIL:[a-z_]+\]\s*/, '');
      const kind = (r0.first_fail || '').match(/^\[FAIL:([a-z_]+)\]/);
      h += `<tr><td><b>${golden ? 'golden' : 'bug ' + bug}</b><div class="small ink2">${esc(r0.description)}</div></td><td>${pill}</td>
        <td class="num mono">${rs.map(r => fmt(r.fail)).join(' / ')}</td><td class="num mono">${fmt(r0.checked)}</td>
        <td class="num mono">${Math.min(...rs.map(r => r.coverage)).toFixed(1)}%</td>
        <td class="mono tiny">${kind ? `<span class="pill fail">${kind[1]}</span> ` : '<span class="muted">none</span>'}${esc(ff.slice(0, 160))}</td></tr>`;
    });
    $('#resTable').innerHTML = h + '</tbody>';
    const secs = rows.map(r => r.seconds);
    $('#resMeta').textContent = `${rows.length} runs · Verilator 5.052 · ${seeds.length} seed${seeds.length > 1 ? 's' : ''}`;
    $('#timeStats').innerHTML = `<div class="kv"><b>SV runs</b><span class="tnum">${REG.length}</span><b>median</b><span class="tnum">${median(REG.map(r => r.seconds)).toFixed(0)} s / run</span><b>slowest</b><span class="tnum">${Math.max(...REG.map(r => r.seconds)).toFixed(0)} s</span></div>`;
    void secs;
  }
  const median = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
  $('#resDesign').addEventListener('click', e => {
    if (!e.target.dataset.v) return;
    resDesign = e.target.dataset.v;
    $$('#resDesign button').forEach(b => b.classList.toggle('active', b === e.target));
    resultsTable();
  });
  getJSON('data/regression.json').then(d => {
    REG = d; resultsTable();
    const bugs = d.filter(r => r.bug > 0), keys = new Set(bugs.map(r => r.design + r.bug));
    const caught = [...keys].filter(k => bugs.filter(r => r.design + r.bug === k).every(r => r.fail > 0)).length;
    $('#hs2').textContent = `${caught} / ${keys.size}`;
  }).catch(() => { $('#resTable').innerHTML = '<tr><td class="muted">data/regression.json not available.</td></tr>'; });
  getJSON('data/replay_2024.json').then(d => {
    const row = (lab, x) => `<b>${lab}</b><span class="tnum">${fmt(x.identical)} / ${fmt(x.compared)} identical</span>`;
    $('#replayStats').innerHTML = `<div class="kv">${row('ADD, bug 1', d.add_bridge_bug1)}${row('SHL, bug 3', d.sll_bug3)}${row('SHR, bug 4', d.srl_bug4)}</div>`;
    $('#hs1').textContent = `${fmt(d.add_bridge_bug1.identical)} / ${fmt(d.add_bridge_bug1.compared)}`;
  }).catch(() => {});
  getJSON('data/js_model_equivalence.json').then(d => {
    const ok = d.filter(r => r.mismatches === 0).length, cyc = d.reduce((a, r) => a + r.cycles, 0), rsp = d.reduce((a, r) => a + r.responses, 0);
    $('#equivStats').innerHTML = `<div class="kv"><b>runs</b><span class="tnum">${ok} / ${d.length} identical</span><b>cycles compared</b><span class="tnum">${fmt(cyc)}</span><b>responses</b><span class="tnum">${fmt(rsp)}</span><b>variants</b><span>2 designs × 8 (golden + 7 bugs)</span></div>`;
    $('#hs4').textContent = `${ok} / ${d.length}`;
  }).catch(() => {});

  // ---------------------------------------------------------------- bug hunt
  const H = { design: 'calc1', bug: 0, answered: false, right: 0, total: 0, last: 0 };
  const bugsOf = d => (d === 'calc1' ? Calc1Model : Calc3Model).BUGS.filter(b => b.id > 0);
  $('#huntDesign').addEventListener('click', e => {
    if (!e.target.dataset.v) return;
    H.design = e.target.dataset.v;
    $$('#huntDesign button').forEach(b => b.classList.toggle('active', b === e.target));
  });
  $('#huntNew').addEventListener('click', () => {
    let b; do { b = 1 + Math.floor(Math.random() * 7); } while (b === H.last);
    H.bug = H.last = b; H.answered = false;
    const sim = H.design === 'calc1' ? SimUI.C1 : SimUI.C3;
    sim.setHidden(b);
    $('#huntStatus').innerHTML = `A mystery <b>${H.design === 'calc1' ? 'Calc1' : 'Calc3'}</b> is loaded in the simulator. Its variant box reads “Mystery DUT”. Probe it with directed tests, or ask the random testbench for a hint.`;
    $('#huntSim').disabled = false; $('#huntReg').disabled = false;
    $('#huntRegOut').innerHTML = '';
    $('#huntReveal').innerHTML = '';
    $('#huntChoices').innerHTML = bugsOf(H.design).map(x => `<button data-b="${x.id}">${esc(x.name)}</button>`).join('');
  });
  $('#huntSim').addEventListener('click', () => {
    openTab(H.design === 'calc1' ? 'sim1' : 'sim3');
    $('#sim').scrollIntoView();
  });
  $('#huntReg').addEventListener('click', () => {
    const r = new Bench.Runner(H.design, H.bug, 500, 1 + Math.floor(Math.random() * 9999));
    r.phase = 'random'; r.batches = [];
    r.b.q.forEach((q, i) => { if (q) { r.b.pendingCount -= q.length; r.b.q[i] = []; } });
    while (!r.runSlice(50000));
    const s = r.b.stats;
    const byCmd = {};
    r.failures.forEach(t => { const n = (H.design === 'calc1' ? Calc1Model : Calc3Model).CMD_NAME(t.cmd); byCmd[n] = (byCmd[n] || 0) + 1; });
    const byPort = {};
    r.failures.forEach(t => { byPort['P' + t.port] = (byPort['P' + t.port] || 0) + 1; });
    $('#huntRegOut').innerHTML = s.fail
      ? `<div class="explain crit"><b>${fmt(s.fail)}</b> of ${fmt(s.checked)} random checks failed.<br>By kind: ${Object.entries(s.kinds).map(([k, v]) => `<code>${k}</code> ×${v}`).join(', ')}<br>By command: ${Object.entries(byCmd).map(([k, v]) => `${k} ×${v}`).join(', ')}<br>By port: ${Object.entries(byPort).sort().map(([k, v]) => `${k} ×${v}`).join(', ')}</div>`
      : `<div class="explain">No failures in 500 random transactions. This bug needs a directed test. Look at the presets.</div>`;
  });
  $('#huntChoices').addEventListener('click', e => {
    const btn = e.target.closest('button[data-b]'); if (!btn || H.answered) return;
    H.answered = true; H.total++;
    const ok = +btn.dataset.b === H.bug; if (ok) H.right++;
    $$('#huntChoices button').forEach(x => { if (+x.dataset.b === H.bug) x.classList.add('right'); else if (x === btn) x.classList.add('wrong'); });
    const info = bugsOf(H.design).find(x => x.id === H.bug);
    $('#huntReveal').innerHTML = `<div class="explain ${ok ? 'good' : 'crit'}"><b>${ok ? 'Correct!' : 'Not quite.'}</b> It was bug ${H.bug}: ${esc(info.name)}.<br>${esc(info.detail)}</div>`;
    $('#huntScore').textContent = `${H.right} / ${H.total}`;
    const sel = $(H.design === 'calc1' ? '#c1bug' : '#c3bug');
    const o = sel.querySelector('option[value="-1"]'); if (o) o.remove();
    sel.value = String(H.bug);
  });
})();
