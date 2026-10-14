/**
 * SunuÉcole — Graphiques SVG maison.
 *
 * Pourquoi pas une librairie ? Pour le bas débit : Chart.js pèse ~200 Ko.
 * Ici, 6 Ko de code couvrent les 6 visualisations utiles à une école,
 * sans aucune dépendance, avec rendu immédiat et tooltips accessibles.
 */
import { icon } from './icons.js';

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function svgEl(w, h, cls = 'chart') {
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" style="height:${h}px;width:100%">`;
}

/** Tooltip partagé, positionné à la souris. */
let tip;
function tooltip(html, evt) {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    document.body.appendChild(tip);
  }
  tip.innerHTML = html;
  tip.classList.add('show');
  const pad = 12;
  const x = Math.min(evt.clientX + pad, window.innerWidth - tip.offsetWidth - pad);
  const y = Math.max(pad, evt.clientY - tip.offsetHeight - pad);
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
const hideTip = () => tip && tip.classList.remove('show');
document.addEventListener('scroll', hideTip, { passive: true });

/** Nice ticks : arrondit l'échelle à des valeurs lisibles. */
function niceMax(v) {
  if (v <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

/* ================================================================== */
/* Courbe (avec aire dégradée optionnelle)                             */
/* ================================================================== */
export function lineChart(data, opts = {}) {
  const {
    labels, series, height = 190, yFormat = (v) => Math.round(v), area = true,
    showDots = true, gridLines = 4, xEvery = null,
  } = opts;
  const W = 720;
  const H = height;
  const padL = 46;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const all = series.flatMap((s) => s.data.map(Number).filter((v) => !Number.isNaN(v)));
  const maxV = niceMax(Math.max(1, ...all));
  const n = labels.length;
  const x = (i) => padL + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => padT + ih - (Math.max(0, Number(v) || 0) / maxV) * ih;

  let out = svgEl(W, H);
  // Grille + axe Y
  for (let g = 0; g <= gridLines; g += 1) {
    const val = (maxV / gridLines) * g;
    const yy = y(val);
    out += `<line class="grid-line" x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}"/>`;
    out += `<text x="${padL - 7}" y="${yy + 3.5}" text-anchor="end">${esc(yFormat(val))}</text>`;
  }
  // Axe X
  const step = xEvery || Math.max(1, Math.ceil(n / 9));
  labels.forEach((l, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    out += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`;
  });

  series.forEach((s, si) => {
    const color = s.color || ['#0e7c66', '#1d4ed8', '#b45309', '#be123c'][si % 4];
    const pts = s.data.map((v, i) => `${x(i)},${y(v)}`);
    if (area && pts.length > 1) {
      out += `<defs><linearGradient id="g${si}${Math.random().toString(36).slice(2, 6)}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".26"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>`;
      const gid = out.match(/id="(g\d+\w+)"/)[1];
      out += `<path d="M${pts.join(' L')} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#${gid})"/>`;
    }
    out += `<polyline class="line-path" points="${pts.join(' ')}" stroke="${color}"/>`;
    if (showDots && n <= 40) {
      s.data.forEach((v, i) => {
        out += `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="3.2" fill="${color}" stroke="var(--surface)" stroke-width="1.6"
          data-tip="<b>${esc(labels[i])}</b>${esc(s.name)} : ${esc(s.format ? s.format(v) : v)}"/>`;
      });
    }
  });
  out += '</svg>';
  return wire(out, opts.legend);
}

/* ================================================================== */
/* Barres (verticales, empilables)                                     */
/* ================================================================== */
export function barChart(data, opts = {}) {
  const { labels, series, height = 200, yFormat = (v) => Math.round(v), stacked = false, horizontal = false, gridLines = 4 } = opts;
  const W = 720;
  const H = height;
  const padL = horizontal ? 108 : 46;
  const padR = 14;
  const padT = 12;
  const padB = horizontal ? 12 : 30;
  const iw = W - padL - padR;
  const ih = H - padT - padB;
  const n = labels.length;
  if (!n) return emptyChart('Aucune donnée à afficher', H);

  const totals = stacked
    ? labels.map((_, i) => series.reduce((a, s) => a + (Number(s.data[i]) || 0), 0))
    : labels.map((_, i) => Math.max(...series.map((s) => Number(s.data[i]) || 0)));
  const maxV = niceMax(Math.max(1, ...totals));

  let out = svgEl(W, H);
  if (horizontal) {
    for (let g = 0; g <= gridLines; g += 1) {
      const xx = padL + (iw / gridLines) * g;
      out += `<line class="grid-line" x1="${xx}" y1="${padT}" x2="${xx}" y2="${H - padB}"/>`;
      out += `<text x="${xx}" y="${H - 1}" text-anchor="middle">${esc(yFormat((maxV / gridLines) * g))}</text>`;
    }
    const rowH = ih / n;
    const barH = Math.min(20, rowH * 0.62);
    labels.forEach((l, i) => {
      const cy = padT + rowH * i + rowH / 2;
      out += `<text x="${padL - 8}" y="${cy + 4}" text-anchor="end" style="font-size:11px">${esc(l)}</text>`;
      let acc = 0;
      series.forEach((s, si) => {
        const v = Number(s.data[i]) || 0;
        const w = (v / maxV) * iw;
        const color = s.color || ['#0e7c66', '#1d4ed8', '#b45309'][si % 3];
        out += `<rect class="bar" x="${padL + acc}" y="${cy - barH / 2}" width="${Math.max(0, w)}" height="${barH}" rx="3" fill="${color}"
          data-tip="<b>${esc(l)}</b>${esc(s.name)} : ${esc(s.format ? s.format(v) : v)}"/>`;
        acc += stacked ? w : 0;
      });
      if (!stacked && series.length > 1) {
        const bw = Math.min(18, (rowH * 0.62) / series.length);
        series.forEach((s, si) => {
          const v = Number(s.data[i]) || 0;
          const w = (v / maxV) * iw;
          const color = s.color || ['#0e7c66', '#1d4ed8', '#b45309'][si % 3];
          const yy = cy - (series.length * bw) / 2 + si * bw;
          out += `<rect class="bar" x="${padL}" y="${yy}" width="${Math.max(0, w)}" height="${bw - 1.5}" rx="2.5" fill="${color}"
            data-tip="<b>${esc(l)}</b>${esc(s.name)} : ${esc(s.format ? s.format(v) : v)}"/>`;
        });
      }
    });
  } else {
    for (let g = 0; g <= gridLines; g += 1) {
      const val = (maxV / gridLines) * g;
      const yy = padT + ih - (val / maxV) * ih;
      out += `<line class="grid-line" x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}"/>`;
      out += `<text x="${padL - 7}" y="${yy + 3.5}" text-anchor="end">${esc(yFormat(val))}</text>`;
    }
    const groupW = iw / n;
    const gap = Math.min(14, groupW * 0.24);
    const bw = stacked ? groupW - gap : (groupW - gap) / series.length;
    labels.forEach((l, i) => {
      const gx = padL + groupW * i + gap / 2;
      let acc = 0;
      series.forEach((s, si) => {
        const v = Number(s.data[i]) || 0;
        const h = (v / maxV) * ih;
        const color = s.color || ['#0e7c66', '#1d4ed8', '#b45309', '#be123c'][si % 4];
        const xx = stacked ? gx : gx + si * bw;
        const yy = stacked ? padT + ih - h - acc : padT + ih - h;
        out += `<rect class="bar" x="${xx}" y="${yy}" width="${Math.max(1, bw - (stacked ? 0 : 2))}" height="${Math.max(0, h)}" rx="3" fill="${color}"
          data-tip="<b>${esc(l)}</b>${esc(s.name)} : ${esc(s.format ? s.format(v) : v)}"/>`;
        if (stacked) acc += h;
      });
      const every = Math.ceil(n / 12);
      if (i % every === 0 || i === n - 1) {
        out += `<text x="${gx + (stacked ? bw : bw * series.length) / 2}" y="${H - 9}" text-anchor="middle" style="font-size:10px">${esc(l)}</text>`;
      }
    });
  }
  out += '</svg>';
  return wire(out, opts.legend);
}

/* ================================================================== */
/* Anneau (répartition)                                                */
/* ================================================================== */
export function donutChart(data, opts = {}) {
  const { height = 190, thickness = 26, total, centerLabel, format = (v) => v } = opts;
  const size = height;
  const R = size / 2 - 8;
  const r = R - thickness;
  const cx = size / 2;
  const cy = size / 2;
  const sum = data.reduce((a, d) => a + (Number(d.value) || 0), 0);
  if (!sum) return emptyChart('Aucune donnée', height);

  let angle = -90;
  let paths = '';
  data.forEach((d) => {
    const v = Number(d.value) || 0;
    if (!v) return;
    const sweep = (v / sum) * 360;
    const large = sweep > 180 ? 1 : 0;
    const a1 = (angle * Math.PI) / 180;
    const a2 = ((angle + sweep) * Math.PI) / 180;
    const x1 = cx + R * Math.cos(a1);
    const y1 = cy + R * Math.sin(a1);
    const x2 = cx + R * Math.cos(a2);
    const y2 = cy + R * Math.sin(a2);
    const x3 = cx + r * Math.cos(a2);
    const y3 = cy + r * Math.sin(a2);
    const x4 = cx + r * Math.cos(a1);
    const y4 = cy + r * Math.sin(a1);
    paths += `<path class="bar" d="M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${large} 0 ${x4},${y4} Z"
      fill="${d.color || '#0e7c66'}" stroke="var(--surface)" stroke-width="2"
      data-tip="<b>${esc(d.label)}</b>${esc(format(v))} · ${((v / sum) * 100).toFixed(1)} %"/>`;
    angle += sweep;
  });

  const label = centerLabel ?? (total != null ? format(total) : '');
  const html = `<div class="donut-wrap" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
    <svg class="chart" viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px;flex-shrink:0" role="img">
      ${paths}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" style="font-size:19px;font-weight:700;fill:var(--text);letter-spacing:-.02em">${esc(label)}</text>
      ${opts.centerSub ? `<text x="${cx}" y="${cy + 15}" text-anchor="middle" style="font-size:10.5px;fill:var(--text-3)">${esc(opts.centerSub)}</text>` : ''}
    </svg>
    <div class="chart-legend" style="flex-direction:column;gap:7px;align-items:flex-start;padding-top:0">
      ${data.map((d) => `<span style="width:100%"><i style="background:${d.color || '#0e7c66'}"></i>${esc(d.label)}
        <b class="num" style="margin-left:auto;padding-left:14px">${esc(format(d.value))}</b>
        <em style="color:var(--text-3);font-style:normal;font-size:11px"> ${sum ? ((d.value / sum) * 100).toFixed(0) : 0}%</em></span>`).join('')}
    </div>
  </div>`;
  return wire(html, false);
}

/* ================================================================== */
/* Jauge / progression radiale                                         */
/* ================================================================== */
export function gauge(value, opts = {}) {
  const { size = 118, thickness = 11, label, color, suffix = '%', max = 100 } = opts;
  const v = Math.max(0, Math.min(max, Number(value) || 0));
  const pctv = (v / max) * 100;
  const R = (size - thickness) / 2;
  const C = 2 * Math.PI * R;
  const col = color || (pctv >= 85 ? 'var(--ok)' : pctv >= 60 ? 'var(--brand-600)' : pctv >= 35 ? 'var(--warn)' : 'var(--danger)');
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label || '')} : ${v}${suffix}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="${thickness}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${R}" fill="none" stroke="${col}" stroke-width="${thickness}"
        stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C - (C * pctv) / 100}"
        transform="rotate(-90 ${size / 2} ${size / 2})" style="transition:stroke-dashoffset .8s cubic-bezier(.16,1,.3,1)"/>
      <text x="${size / 2}" y="${size / 2 + 1}" text-anchor="middle" dominant-baseline="middle"
        style="font-size:${size / 5.4}px;font-weight:700;fill:var(--text);letter-spacing:-.03em">${esc(v % 1 ? v.toFixed(1) : v)}${esc(suffix)}</text>
    </svg>
    ${label ? `<div style="font-size:11.5px;color:var(--text-3);font-weight:600;text-align:center">${esc(label)}</div>` : ''}
  </div>`;
}

/* ================================================================== */
/* Radar (profil par matière)                                          */
/* ================================================================== */
export function radarChart(data, opts = {}) {
  const { size = 250, max = 20, color = '#0e7c66', compare = null } = opts;
  const n = data.length;
  if (n < 3) return emptyChart('Au moins 3 matières nécessaires', size);
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 42;
  const pt = (i, v) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rr = (Math.max(0, Number(v) || 0) / max) * R;
    return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  };
  let rings = '';
  for (let g = 1; g <= 4; g += 1) {
    const pts = data.map((_, i) => pt(i, (max / 4) * g).join(',')).join(' ');
    rings += `<polygon points="${pts}" fill="none" stroke="var(--border-subtle)" stroke-width="1"/>`;
  }
  let axes = '';
  let labels = '';
  data.forEach((d, i) => {
    const [x2, y2] = pt(i, max);
    axes += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="var(--border-subtle)" stroke-width="1"/>`;
    const [lx, ly] = pt(i, max * 1.19);
    labels += `<text x="${lx}" y="${ly + 3.5}" text-anchor="${Math.abs(lx - cx) < 6 ? 'middle' : lx > cx ? 'start' : 'end'}" style="font-size:9.5px">${esc(d.label.length > 12 ? `${d.label.slice(0, 11)}…` : d.label)}</text>`;
  });
  const poly = (vals, col, fill) => {
    const pts = vals.map((v, i) => pt(i, v).join(',')).join(' ');
    return `<polygon points="${pts}" fill="${fill}" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>`;
  };
  const values = data.map((d) => d.value);
  let html = `<svg class="chart" viewBox="0 0 ${size} ${size}" style="width:100%;max-width:${size}px;height:auto;margin:0 auto" role="img">
    ${rings}${axes}
    ${compare ? poly(compare.map((c) => c.value), '#94a3b8', 'rgba(148,163,184,.16)') : ''}
    ${poly(values, color, `${color}26`)}
    ${values.map((v, i) => { const [x, y] = pt(i, v); return `<circle class="dot" cx="${x}" cy="${y}" r="3" fill="${color}" data-tip="<b>${esc(data[i].label)}</b>Moyenne : ${v.toFixed(2)}/${max}${compare ? `<br>Classe : ${compare[i].value.toFixed(2)}` : ''}"/>`; }).join('')}
    ${labels}
  </svg>`;
  if (compare) {
    html += `<div class="chart-legend" style="justify-content:center">
      <span><i style="background:${color}"></i>Élève</span><span><i style="background:#94a3b8"></i>Moyenne de classe</span></div>`;
  }
  return wire(html, false);
}

/* ================================================================== */
/* Sparkline (mini-courbe dans une tuile KPI)                          */
/* ================================================================== */
export function sparkline(values, opts = {}) {
  const { color = 'var(--brand-600)', height = 30, width = 120 } = opts;
  const vals = values.map(Number).filter((v) => !Number.isNaN(v));
  if (vals.length < 2) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => (i * width) / (vals.length - 1);
  const y = (v) => height - 3 - ((v - min) / span) * (height - 6);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" style="height:${height}px;width:100%" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(vals.length - 1)}" cy="${y(vals[vals.length - 1])}" r="2.6" fill="${color}"/>
  </svg>`;
}

function emptyChart(msg, height = 160) {
  return `<div style="height:${height}px;display:grid;place-items:center;color:var(--text-3);font-size:12.5px">
    ${icon('chart', { size: 18 })}<span style="margin-left:7px">${esc(msg)}</span></div>`;
}

/** Attache les tooltips sur les éléments portant data-tip. */
function wire(html, legend) {
  const legendHtml = legend && Array.isArray(legend)
    ? `<div class="chart-legend">${legend.map((l) => `<span><i style="background:${l.color}"></i>${esc(l.label)}</span>`).join('')}</div>`
    : '';
  const wrap = document.createElement('div');
  wrap.innerHTML = html + legendHtml;
  wrap.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('mouseenter', (e) => tooltip(el.getAttribute('data-tip'), e));
    el.addEventListener('mousemove', (e) => tooltip(el.getAttribute('data-tip'), e));
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('focus', (e) => tooltip(el.getAttribute('data-tip'), e));
    el.addEventListener('blur', hideTip);
    el.setAttribute('tabindex', '0');
  });
  return wrap;
}

export const charts = { lineChart, barChart, donutChart, gauge, radarChart, sparkline };
export default charts;
