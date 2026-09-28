/* wave.js -- tiny SVG waveform viewer (Nitish Sundarraj)
 * Wave.render(el, { cols, signals, colW, marker })
 *   cols    : array of column objects (one per clock cycle)
 *   signals : [{ name, kind: 'clock'|'bit'|'bus', get(col, i) -> value, color, fmt }]
 *             a bus value may be a string, a number, or { text, x: true } for unknown
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, text) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  };

  function render(container, opt) {
    let cols = opt.cols;
    const sigs = opt.signals;
    const colW = opt.colW || 58, rowH = 26, labW = opt.labW || 124, top = 22;
    if (opt.fit) {                       // show only the newest cycles that fit
      const n = Math.max(6, Math.floor(((container.clientWidth || 800) - labW - 10) / colW));
      cols = cols.slice(-n);
      opt = Object.assign({}, opt, { minCols: n });
    }
    const W = labW + Math.max(cols.length, opt.minCols || 0) * colW + 8, H = top + sigs.length * rowH + 6;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opt.label || 'waveform' });

    // hatch pattern for X
    const defs = el('defs');
    const pat = el('pattern', { id: 'xhatch' + (opt.id || ''), width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.appendChild(el('rect', { width: 6, height: 6, fill: 'var(--crit-wash)' }));
    pat.appendChild(el('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--crit)', 'stroke-width': 1.5 }));
    defs.appendChild(pat); svg.appendChild(defs);

    // cycle grid + numbers
    cols.forEach((c, i) => {
      const x = labW + i * colW;
      svg.appendChild(el('line', { x1: x, y1: top - 6, x2: x, y2: H - 4, stroke: 'var(--grid)', 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: x + colW / 2, y: 13, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 10 }, c.label != null ? c.label : String(c.cycle)));
    });
    if (opt.marker != null && opt.marker >= 0 && opt.marker < cols.length) {
      svg.appendChild(el('rect', { x: labW + opt.marker * colW, y: top - 6, width: colW, height: H - top + 2, fill: 'var(--accent-wash)' }));
    }

    sigs.forEach((s, r) => {
      const y0 = top + r * rowH, yT = y0 + 4, yB = y0 + rowH - 6, yM = (yT + yB) / 2;
      svg.appendChild(el('text', { x: 6, y: yM + 4, fill: 'var(--ink2)', 'font-size': 11 }, s.name));
      const color = s.color || 'var(--s1)';
      if (s.kind === 'clock') {
        let d = '';
        cols.forEach((c, i) => {
          const x = labW + i * colW;
          d += `M${x},${yB} L${x},${yT} L${x + colW / 2},${yT} L${x + colW / 2},${yB} L${x + colW},${yB} `;
        });
        svg.appendChild(el('path', { d, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 1.5 }));
        return;
      }
      if (s.kind === 'bit') {
        let d = '', prev = null;
        cols.forEach((c, i) => {
          const v = s.get(c, i) ? 1 : 0, x = labW + i * colW, y = v ? yT : yB;
          if (prev === null) d += `M${x},${y} `; else if (prev !== v) d += `L${x},${y} `;
          d += `L${x + colW},${y} `; prev = v;
        });
        svg.appendChild(el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2 }));
        return;
      }
      // bus: merge equal consecutive values into segments
      const segs = [];
      cols.forEach((c, i) => {
        let v = s.get(c, i);
        const isX = v && typeof v === 'object' && v.x;
        const text = v && typeof v === 'object' ? v.text : (v == null ? '' : String(v));
        const idle = !isX && (text === '' || text === s.idle);
        const last = segs[segs.length - 1];
        if (last && last.text === text && last.isX === isX) last.n++;
        else segs.push({ i, n: 1, text, isX, idle, title: v && v.title });
      });
      segs.forEach(g => {
        const x0 = labW + g.i * colW, x1 = x0 + g.n * colW, k = 4;
        if (g.idle) {
          svg.appendChild(el('line', { x1: x0, y1: yM, x2: x1, y2: yM, stroke: 'var(--axis)', 'stroke-width': 1.5 }));
          return;
        }
        const d = `M${x0},${yM} L${x0 + k},${yT} L${x1 - k},${yT} L${x1},${yM} L${x1 - k},${yB} L${x0 + k},${yB} Z`;
        const p = el('path', { d, fill: g.isX ? `url(#xhatch${opt.id || ''})` : 'var(--card)', stroke: g.isX ? 'var(--crit)' : color, 'stroke-width': 1.5 });
        if (g.title) p.appendChild(el('title', {}, g.title));
        svg.appendChild(p);
        const room = (x1 - x0 - 2 * k) / 6.6;
        let t = g.text;
        if (t.length > room) t = room >= 3 ? t.slice(0, Math.max(1, Math.floor(room) - 1)) + '…' : '';
        if (t) svg.appendChild(el('text', { x: (x0 + x1) / 2, y: yM + 4, 'text-anchor': 'middle', fill: g.isX ? 'var(--crit)' : 'var(--ink)', 'font-size': 11 }, t));
      });
    });

    container.innerHTML = '';
    container.appendChild(svg);
    if (opt.scrollEnd) container.scrollLeft = container.scrollWidth;
  }

  root.Wave = { render, el };
})(window);
