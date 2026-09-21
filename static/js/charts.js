/* SVG-Diagramme: Ranking, Zeitverlauf, Verteilung, Streudiagramm, Ertragsmix.
   Zielbank trägt die Akzentfarbe, Peers bleiben neutral — Farbe folgt der
   Bank, nicht ihrem Rang. */

import { el, fmt, fmtWithUnit, unitShort, showTip, hideTip, escapeHtml } from './core.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  return node;
}

function niceTicks(min, max, count = 5) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(raw) || 1));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

const CSS = (name) => getComputedStyle(document.documentElement)
  .getPropertyValue(name).trim();

/* ================================================================ Ranking */
export function renderRanking(host, stats, { onBarClick, log = false } = {}) {
  host.replaceChildren();
  const rows = stats.rows || [];
  if (!rows.length) {
    host.append(el('div', { class: 'empty-state' },
      el('strong', { text: 'Keine Daten für diese Kennzahl' }),
      el('div', {
        text: 'Keine der ausgewählten Banken weist diesen Wert für das '
          + `Berichtsjahr ${stats.year} aus.`,
      })));
    return;
  }

  const unit = stats.definition?.unit || '';
  const values = rows.map((r) => r.value);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);

  // Logarithmisch nur sinnvoll, wenn alle Werte echt positiv sind
  const logOk = log && dataMin > 0 && dataMax > dataMin;
  let pos;
  if (logOk) {
    const lo = Math.log10(dataMin);
    const hi = Math.log10(dataMax);
    const range = (hi - lo) || 1;
    pos = (v) => (v <= 0 ? 0 : ((Math.log10(v) - lo) / range) * 94 + 3);
  } else {
    const base = Math.min(dataMin, 0);
    const span = (Math.max(dataMax, 0) - base) || 1;
    pos = (v) => ((v - base) / span) * 100;
  }

  const list = el('div', { class: 'rank-list' });
  rows.forEach((row, index) => {
    const isTarget = row.istZielbank;
    const rowEl = el('div', { class: `rank-row${isTarget ? ' target' : ''}` });
    const track = el('div', { class: 'rank-track' });

    const zero = logOk ? 0 : pos(0);
    const val = pos(row.value);
    const left = Math.min(zero, val);
    const width = Math.max(Math.abs(val - zero), 0.8);

    const fill = el('div', {
      class: 'rank-fill',
      style: { left: `${left}%`, width: `${width}%` },
    });
    if (onBarClick) {
      fill.style.cursor = 'pointer';
      fill.addEventListener('click', () => onBarClick(row));
    }
    fill.addEventListener('mousemove', (e) => {
      const parts = [
        `<div class="tt-title">${escapeHtml(row.name)}${isTarget ? ' · Zielbank' : ''}</div>`,
        `<div class="tt-row${isTarget ? ' target' : ''}"><span>${escapeHtml(stats.definition?.label || '')}</span>`
        + `<span class="v">${fmtWithUnit(row.value, unit)}</span></div>`,
      ];
      if (stats.peerAvg !== null && stats.peerAvg !== undefined) {
        parts.push(`<div class="tt-row"><span>Peer-Durchschnitt</span>`
          + `<span class="v">${fmtWithUnit(stats.peerAvg, unit)}</span></div>`);
      }
      if (row.rang) {
        parts.push(`<div class="tt-row"><span>Rang</span><span class="v">${row.rang} von ${stats.n}</span></div>`);
      }
      if (row.source) {
        parts.push(`<div class="tt-src">${row.berechnet ? 'Formel' : 'Quelle'}: ${escapeHtml(row.source)}</div>`);
      }
      showTip(parts.join(''), e.clientX, e.clientY);
    });
    fill.addEventListener('mouseleave', hideTip);
    track.append(fill);

    if (stats.peerAvg !== null && stats.peerAvg !== undefined) {
      track.append(el('div', {
        class: 'rank-marker', title: 'Peer-Durchschnitt',
        style: { left: `${pos(stats.peerAvg)}%` },
      }));
    }
    if (stats.peerMedian !== null && stats.peerMedian !== undefined
        && stats.peerMedian !== stats.peerAvg) {
      track.append(el('div', {
        class: 'rank-marker median', title: 'Peer-Median',
        style: { left: `${pos(stats.peerMedian)}%` },
      }));
    }

    rowEl.append(
      el('div', { class: 'rank-pos', text: `${index + 1}.` }),
      el('div', { class: 'rank-label', title: row.name, text: row.name }),
      track,
      el('div', { class: 'rank-value', text: fmtWithUnit(row.value, unit) }),
    );
    list.append(rowEl);
  });

  host.append(list);

  const legend = el('div', { class: 'rank-legend' },
    el('span', {}, el('i', { style: { background: 'var(--accent)' } }), 'Zielbank'),
    el('span', {}, el('i', { style: { background: 'var(--peer)' } }), 'Vergleichsbank'),
    el('span', {}, el('i', { class: 'line', style: { background: 'var(--text-muted)' } }), 'Peer-Durchschnitt'),
    el('span', {}, el('i', { class: 'line', style: { background: 'var(--baseline)' } }), 'Peer-Median'));
  if (logOk) {
    legend.append(el('span', { class: 'muted' }, 'Logarithmische Skala'));
  }
  if (stats.missing?.length) {
    legend.append(el('span', { class: 'muted' },
      `Ohne Wert: ${stats.missing.map((m) => m.kuerzel).join(', ')}`));
  }
  host.append(legend);
}

/* Prüft, ob die Werte so weit auseinanderliegen, dass eine lineare Skala
   die kleinen Balken unlesbar macht. */
export function spreadIsExtreme(rows) {
  const values = (rows || []).map((r) => r.value).filter((v) => typeof v === 'number' && v > 0);
  if (values.length < 3) return false;
  return Math.max(...values) / Math.min(...values) >= 50;
}

/* ============================================================ Zeitverlauf */
export function renderTimeseries(host, payload) {
  host.replaceChildren();
  const { series = [], years = [], definition } = payload;
  if (!series.length || years.length < 2) {
    host.append(el('div', { class: 'empty-state' },
      el('strong', { text: 'Kein Zeitverlauf darstellbar' }),
      el('div', {
        text: years.length < 2
          ? 'Dafür sind mindestens zwei Berichtsjahre nötig.'
          : 'Für die ausgewählten Banken liegen keine Werte über die Jahre vor.',
      })));
    return;
  }

  const W = 900; const H = 330;
  const padL = 68; const padR = 130; const padT = 16; const padB = 38;
  const unit = definition?.unit || '';
  const all = series.flatMap((s) => s.points.map((p) => p.value)).filter((v) => v !== null);
  let vMin = Math.min(...all); let vMax = Math.max(...all);
  if (vMin === vMax) { vMin -= Math.abs(vMin || 1) * 0.1; vMax += Math.abs(vMax || 1) * 0.1; }
  const ticks = niceTicks(vMin, vMax, 5);
  vMin = Math.min(vMin, ticks[0]); vMax = Math.max(vMax, ticks[ticks.length - 1]);

  const xFor = (i) => padL + (i / Math.max(years.length - 1, 1)) * (W - padL - padR);
  const yFor = (v) => padT + (1 - (v - vMin) / (vMax - vMin)) * (H - padT - padB);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `Zeitverlauf ${definition?.label || ''}`,
  });
  svg.style.maxWidth = `${W}px`;
  svg.style.fontFamily = 'system-ui, sans-serif';

  ticks.forEach((t) => {
    const y = yFor(t);
    svg.append(svgEl('line', {
      x1: padL, y1: y, x2: W - padR, y2: y, stroke: CSS('--grid'), 'stroke-width': 1,
    }));
    const label = svgEl('text', {
      x: padL - 9, y: y + 4, 'text-anchor': 'end', 'font-size': 11,
      fill: CSS('--text-muted'),
    });
    label.textContent = fmt(t);
    svg.append(label);
  });

  years.forEach((year, i) => {
    const label = svgEl('text', {
      x: xFor(i), y: H - 12, 'text-anchor': 'middle', 'font-size': 12,
      fill: CSS('--text-secondary'),
    });
    label.textContent = year;
    svg.append(label);
  });
  svg.append(svgEl('line', {
    x1: padL, y1: H - padB, x2: W - padR, y2: H - padB,
    stroke: CSS('--baseline'), 'stroke-width': 1,
  }));

  const peers = series.filter((s) => !s.istZielbank);
  const targets = series.filter((s) => s.istZielbank);

  const drawSeries = (s, { color, width, radius }) => {
    const pts = s.points
      .map((p, i) => (p.value === null ? null : [xFor(i), yFor(p.value)]))
      .filter(Boolean);
    if (pts.length > 1) {
      svg.append(svgEl('path', {
        d: `M${pts.map((p) => `${p[0]},${p[1]}`).join(' L')}`,
        fill: 'none', stroke: color, 'stroke-width': width,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        opacity: s.istZielbank ? 1 : 0.8,
      }));
    }
    pts.forEach(([cx, cy]) => {
      svg.append(svgEl('circle', {
        cx, cy, r: radius, fill: color, stroke: CSS('--surface-1'), 'stroke-width': 2,
      }));
    });
    // Direktbeschriftung am rechten Rand
    const last = s.points.map((p, i) => ({ ...p, i })).filter((p) => p.value !== null).pop();
    if (last) {
      const label = svgEl('text', {
        x: xFor(last.i) + 10, y: yFor(last.value) + 4, 'font-size': 11,
        fill: s.istZielbank ? CSS('--accent') : CSS('--text-muted'),
        'font-weight': s.istZielbank ? 700 : 400,
      });
      label.textContent = s.kuerzel;
      svg.append(label);
    }
  };

  peers.forEach((s) => drawSeries(s, { color: CSS('--peer-line'), width: 2, radius: 4 }));
  targets.forEach((s) => drawSeries(s, { color: CSS('--accent'), width: 3, radius: 5.5 }));

  years.forEach((year, i) => {
    const colW = (W - padL - padR) / Math.max(years.length - 1, 1);
    const zone = svgEl('rect', {
      x: xFor(i) - colW / 2, y: padT, width: colW, height: H - padT - padB,
      fill: 'transparent',
    });
    zone.style.cursor = 'crosshair';
    zone.addEventListener('mousemove', (e) => {
      const rows = series
        .map((s) => ({ s, p: s.points[i] }))
        .filter((x) => x.p && x.p.value !== null)
        .sort((a, b) => b.p.value - a.p.value)
        .map((x) => `<div class="tt-row${x.s.istZielbank ? ' target' : ''}">`
          + `<span>${escapeHtml(x.s.name)}</span>`
          + `<span class="v">${fmtWithUnit(x.p.value, unit)}</span></div>`)
        .join('');
      showTip(`<div class="tt-title">${escapeHtml(definition?.label || '')} · ${year}</div>${rows}`,
        e.clientX, e.clientY);
    });
    zone.addEventListener('mouseleave', hideTip);
    svg.append(zone);
  });

  const wrap = el('div', { class: 'chart-wrap' });
  wrap.append(svg);
  host.append(wrap);
  host.append(el('div', { class: 'legend' },
    el('span', {}, el('i', { class: 'line', style: { background: 'var(--accent)' } }), 'Zielbank'),
    el('span', {}, el('i', { class: 'line', style: { background: 'var(--peer-line)' } }), 'Vergleichsbanken'),
    el('span', { class: 'muted' }, `Einheit: ${unitShort(unit) || '–'}`)));
}

/* ============================================================ Verteilung */
export function renderDistribution(host, stats) {
  host.replaceChildren();
  const rows = (stats.rows || []).filter((r) => typeof r.value === 'number');
  if (rows.length < 3) {
    host.append(el('div', { class: 'empty-state' },
      el('strong', { text: 'Zu wenig Werte' }),
      el('div', { text: 'Für eine Verteilung sind mindestens drei Banken mit Werten nötig.' })));
    return;
  }

  const W = 900; const H = 128;
  const padL = 28; const padR = 28; const axisY = 76;
  const values = rows.map((r) => r.value);
  let min = Math.min(...values); let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;
  const xFor = (v) => padL + ((v - min) / (max - min)) * (W - padL - padR);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  svg.style.fontFamily = 'system-ui, sans-serif';

  svg.append(svgEl('line', {
    x1: padL, y1: axisY, x2: W - padR, y2: axisY,
    stroke: CSS('--baseline'), 'stroke-width': 2, 'stroke-linecap': 'round',
  }));

  niceTicks(min, max, 5).forEach((t) => {
    if (t < min || t > max) return;
    const x = xFor(t);
    svg.append(svgEl('line', {
      x1: x, y1: axisY, x2: x, y2: axisY + 6, stroke: CSS('--baseline'), 'stroke-width': 1,
    }));
    const label = svgEl('text', {
      x, y: axisY + 20, 'text-anchor': 'middle', 'font-size': 10.5, fill: CSS('--text-muted'),
    });
    label.textContent = fmt(t);
    svg.append(label);
  });

  // Peer-Band zwischen Minimum und Maximum
  if (stats.peerMin !== null && stats.peerMax !== null) {
    svg.append(svgEl('rect', {
      x: xFor(stats.peerMin), y: axisY - 13,
      width: Math.max(xFor(stats.peerMax) - xFor(stats.peerMin), 2), height: 26,
      fill: CSS('--surface-2'), rx: 5,
    }));
  }
  if (stats.peerAvg !== null && stats.peerAvg !== undefined) {
    const x = xFor(stats.peerAvg);
    svg.append(svgEl('line', {
      x1: x, y1: axisY - 20, x2: x, y2: axisY + 20,
      stroke: CSS('--text-muted'), 'stroke-width': 2, 'stroke-dasharray': '4 3',
    }));
    const label = svgEl('text', {
      x, y: axisY - 26, 'text-anchor': 'middle', 'font-size': 10.5, fill: CSS('--text-muted'),
    });
    label.textContent = 'Peer-Ø';
    svg.append(label);
  }

  const unit = stats.definition?.unit || '';
  const placed = [];
  rows.forEach((row) => {
    const x = xFor(row.value);
    // leichte vertikale Staffelung, wenn Punkte sehr nah beieinander liegen
    let level = 0;
    while (placed.some((p) => Math.abs(p.x - x) < 16 && p.level === level)) level++;
    placed.push({ x, level });
    const cy = axisY - level * 15;

    const dot = svgEl('circle', {
      cx: x, cy, r: row.istZielbank ? 8 : 6,
      fill: row.istZielbank ? CSS('--accent') : CSS('--peer'),
      stroke: CSS('--surface-1'), 'stroke-width': 2,
    });
    dot.style.cursor = 'pointer';
    dot.addEventListener('mousemove', (e) => showTip(
      `<div class="tt-title">${escapeHtml(row.name)}</div>`
      + `<div class="tt-row${row.istZielbank ? ' target' : ''}">`
      + `<span>${escapeHtml(stats.definition?.label || '')}</span>`
      + `<span class="v">${fmtWithUnit(row.value, unit)}</span></div>`,
      e.clientX, e.clientY));
    dot.addEventListener('mouseleave', hideTip);
    svg.append(dot);

    if (row.istZielbank) {
      const label = svgEl('text', {
        x, y: cy - 14, 'text-anchor': 'middle', 'font-size': 11,
        'font-weight': 700, fill: CSS('--accent'),
      });
      label.textContent = row.kuerzel;
      svg.append(label);
    }
  });

  const wrap = el('div', { class: 'chart-wrap' });
  wrap.append(svg);
  host.append(wrap);
}

/* ========================================================= Streudiagramm */
export function renderScatter(host, payload) {
  host.replaceChildren();
  const points = payload.punkte || [];
  if (points.length < 3) {
    host.append(el('div', { class: 'empty-state' },
      el('strong', { text: 'Zu wenig Datenpunkte' }),
      el('div', { text: 'Für beide Kennzahlen müssen bei mindestens drei Banken Werte vorliegen.' })));
    return;
  }

  const W = 900; const H = 440;
  const padL = 72; const padR = 26; const padT = 18; const padB = 56;
  const xs = points.map((p) => p.x); const ys = points.map((p) => p.y);
  const xTicks = niceTicks(Math.min(...xs), Math.max(...xs), 5);
  const yTicks = niceTicks(Math.min(...ys), Math.max(...ys), 5);
  const xMin = Math.min(...xs, xTicks[0]); const xMax = Math.max(...xs, xTicks.at(-1));
  const yMin = Math.min(...ys, yTicks[0]); const yMax = Math.max(...ys, yTicks.at(-1));
  const xFor = (v) => padL + ((v - xMin) / ((xMax - xMin) || 1)) * (W - padL - padR);
  const yFor = (v) => padT + (1 - (v - yMin) / ((yMax - yMin) || 1)) * (H - padT - padB);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  svg.style.fontFamily = 'system-ui, sans-serif';

  yTicks.forEach((t) => {
    const y = yFor(t);
    svg.append(svgEl('line', {
      x1: padL, y1: y, x2: W - padR, y2: y, stroke: CSS('--grid'), 'stroke-width': 1,
    }));
    const label = svgEl('text', {
      x: padL - 9, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: CSS('--text-muted'),
    });
    label.textContent = fmt(t);
    svg.append(label);
  });
  xTicks.forEach((t) => {
    const x = xFor(t);
    svg.append(svgEl('line', {
      x1: x, y1: padT, x2: x, y2: H - padB, stroke: CSS('--grid'), 'stroke-width': 1,
    }));
    const label = svgEl('text', {
      x, y: H - padB + 17, 'text-anchor': 'middle', 'font-size': 11, fill: CSS('--text-muted'),
    });
    label.textContent = fmt(t);
    svg.append(label);
  });

  const xLabel = svgEl('text', {
    x: (padL + W - padR) / 2, y: H - 14, 'text-anchor': 'middle',
    'font-size': 12, fill: CSS('--text-secondary'),
  });
  xLabel.textContent = `${payload.x.definition?.label || ''} (${unitShort(payload.x.definition?.unit)})`;
  svg.append(xLabel);

  const yLabel = svgEl('text', {
    x: 16, y: (padT + H - padB) / 2, 'text-anchor': 'middle',
    'font-size': 12, fill: CSS('--text-secondary'),
    transform: `rotate(-90 16 ${(padT + H - padB) / 2})`,
  });
  yLabel.textContent = `${payload.y.definition?.label || ''} (${unitShort(payload.y.definition?.unit)})`;
  svg.append(yLabel);

  // Regressionsgerade, wenn ein Zusammenhang erkennbar ist
  if (payload.r !== null && Math.abs(payload.r) > 0.25) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const num = xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0);
    const den = xs.reduce((acc, x) => acc + (x - mx) ** 2, 0);
    if (den) {
      const slope = num / den;
      const at = (x) => my + slope * (x - mx);
      svg.append(svgEl('line', {
        x1: xFor(xMin), y1: yFor(at(xMin)), x2: xFor(xMax), y2: yFor(at(xMax)),
        stroke: CSS('--baseline'), 'stroke-width': 2, 'stroke-dasharray': '6 4',
      }));
    }
  }

  points.forEach((p) => {
    const cx = xFor(p.x); const cy = yFor(p.y);
    const dot = svgEl('circle', {
      cx, cy, r: p.istZielbank ? 9 : 6.5,
      fill: p.istZielbank ? CSS('--accent') : CSS('--peer'),
      stroke: CSS('--surface-1'), 'stroke-width': 2,
    });
    dot.style.cursor = 'pointer';
    dot.addEventListener('mousemove', (e) => showTip(
      `<div class="tt-title">${escapeHtml(p.name)}</div>`
      + `<div class="tt-row"><span>${escapeHtml(payload.x.definition?.label || 'X')}</span>`
      + `<span class="v">${fmtWithUnit(p.x, payload.x.definition?.unit)}</span></div>`
      + `<div class="tt-row"><span>${escapeHtml(payload.y.definition?.label || 'Y')}</span>`
      + `<span class="v">${fmtWithUnit(p.y, payload.y.definition?.unit)}</span></div>`,
      e.clientX, e.clientY));
    dot.addEventListener('mouseleave', hideTip);
    svg.append(dot);

    const label = svgEl('text', {
      x: cx, y: cy - (p.istZielbank ? 14 : 11), 'text-anchor': 'middle',
      'font-size': p.istZielbank ? 11.5 : 10.5,
      'font-weight': p.istZielbank ? 700 : 400,
      fill: p.istZielbank ? CSS('--accent') : CSS('--text-muted'),
    });
    label.textContent = p.kuerzel;
    svg.append(label);
  });

  const wrap = el('div', { class: 'chart-wrap' });
  wrap.append(svg);
  host.append(wrap);

  const strength = payload.r === null ? 'nicht berechenbar'
    : Math.abs(payload.r) > 0.7 ? 'starker Zusammenhang'
      : Math.abs(payload.r) > 0.4 ? 'mittlerer Zusammenhang'
        : 'schwacher Zusammenhang';
  host.append(el('div', { class: 'legend' },
    el('span', {}, el('i', { style: { background: 'var(--accent)' } }), 'Zielbank'),
    el('span', {}, el('i', { style: { background: 'var(--peer)' } }), 'Vergleichsbanken'),
    el('span', { class: 'muted' },
      `Korrelation r = ${payload.r ?? '–'} · ${strength} · ${points.length} Banken`)));
}

/* ========================================================== Ertragsmix */
export function renderMix(host, banks, title) {
  host.replaceChildren();
  const rows = banks.filter((b) => b.total > 0);
  if (!rows.length) {
    host.append(el('div', { class: 'empty-state' },
      el('strong', { text: 'Keine Ertragsdaten' }),
      el('div', { text: 'Zins-, Kommissions- und Handelserfolg sind für die Auswahl nicht belegt.' })));
    return;
  }

  const segments = [
    { key: 'zins', label: 'Zinsgeschäft', color: 'var(--series-1)' },
    { key: 'kommission', label: 'Kommissionsgeschäft', color: 'var(--series-2)' },
    { key: 'handel', label: 'Handelsgeschäft', color: 'var(--series-3)' },
  ];

  const list = el('div', { class: 'rank-list' });
  rows.forEach((bank) => {
    const rowEl = el('div', { class: `rank-row${bank.istZielbank ? ' target' : ''}` });
    const track = el('div', { class: 'rank-track', style: { overflow: 'hidden' } });
    let offset = 0;
    segments.forEach((seg) => {
      const value = bank[seg.key];
      if (!value || value <= 0) return;
      const pct = (value / bank.total) * 100;
      const bar = el('div', {
        class: 'rank-fill',
        style: {
          left: `${offset}%`, width: `${pct}%`, background: seg.color,
          borderRadius: '0', borderWidth: '2px',
        },
      });
      bar.addEventListener('mousemove', (e) => showTip(
        `<div class="tt-title">${escapeHtml(bank.name)}</div>`
        + `<div class="tt-row"><span>${seg.label}</span>`
        + `<span class="v">${fmt(value)} Mio. · ${fmt(pct, 1)} %</span></div>`
        + `<div class="tt-row"><span>Bruttoertrag gesamt</span>`
        + `<span class="v">${fmt(bank.total)} Mio.</span></div>`,
        e.clientX, e.clientY));
      bar.addEventListener('mouseleave', hideTip);
      track.append(bar);
      offset += pct;
    });

    rowEl.append(
      el('div', { class: 'rank-pos', text: '' }),
      el('div', { class: 'rank-label', title: bank.name, text: bank.name }),
      track,
      el('div', { class: 'rank-value', text: `${fmt(bank.total)} Mio.` }),
    );
    list.append(rowEl);
  });

  host.append(list);
  host.append(el('div', { class: 'legend' },
    ...segments.map((seg) => el('span', {},
      el('i', { style: { background: seg.color } }), seg.label)),
    el('span', { class: 'muted' }, title || 'Anteile am Bruttoertrag')));
}

/* ============================================ Heatmap-Farbe (sequenziell) */
export function heatColor(percentile) {
  if (percentile === null || percentile === undefined) return 'transparent';
  const steps = ['--seq-100', '--seq-200', '--seq-300', '--seq-400',
    '--seq-500', '--seq-600', '--seq-700'];
  const idx = Math.min(steps.length - 1, Math.max(0, Math.floor((percentile / 100) * steps.length)));
  const base = CSS(steps[idx]);
  // Gedeckt halten, damit der Text lesbar bleibt
  const alpha = 0.18 + (percentile / 100) * 0.42;
  return hexToRgba(base, alpha);
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}
