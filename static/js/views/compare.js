/* Ansicht „Vergleich“: Kennzahlmatrix, Scorecard, Ertragsmix, Streudiagramm. */

import {
  state, api, query, el, clear, fmt, unitShort, kpiDef, kpiKeys,
  visibleBankIds, emptyState, toastError, escapeHtml, showTip, hideTip, download,
} from '../core.js';
import { renderScatter, renderMix, heatColor } from '../charts.js';

let container = null;
let matrixCache = null;

export function mount(host) {
  container = host;
  clear(host);
  host.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Vergleich' }),
      el('p', {
        text: 'Alle Kennzahlen aller ausgewählten Banken nebeneinander, '
          + 'inklusive Gesamtbewertung und Ertragsstruktur.',
      })),
    el('section', { class: 'card', id: 'scorecardCard' }),
    el('section', { class: 'card', id: 'matrixCard' }),
    el('section', { class: 'card', id: 'mixCard' }),
    el('section', { class: 'card', id: 'scatterCard' }),
  );
}

export async function refresh() {
  if (!container) return;
  try {
    const [mat, score, scatter] = await Promise.all([
      api(`/api/analysis/matrix${query({ years: state.boot.jahre.join(',') })}`),
      api(`/api/analysis/scorecard${query()}`),
      api(`/api/analysis/scatter${query({ x: state.scatterX, y: state.scatterY })}`),
    ]);
    matrixCache = mat;
    renderScorecard(score);
    renderMatrix(mat);
    renderMixCard(mat);
    renderScatterCard(scatter);
  } catch (err) {
    toastError(err, 'Vergleich konnte nicht geladen werden');
  }
}

/* --------------------------------------------------------- Scorecard */
function renderScorecard(payload) {
  const host = document.getElementById('scorecardCard');
  clear(host);
  host.append(el('div', { class: 'card-head' },
    el('div', {},
      el('h2', {}, `Gesamtbewertung ${payload.year}`),
      el('p', { class: 'card-desc' },
        'Durchschnittlicher Perzentilrang über alle wertbaren Kennzahlen, bei denen '
        + 'eine Richtung definiert ist. 100 bedeutet bester Wert der Gruppe. '
        + 'Kennzahlen ohne klare Richtung, etwa absolute Aufwandspositionen, bleiben aussen vor.'))));

  const rows = payload.banken || [];
  if (!rows.length) {
    host.append(emptyState('Keine Bewertung möglich',
      'Für die Auswahl liegen zu wenige vergleichbare Kennzahlen vor.'));
    return;
  }

  const kats = Object.entries(payload.kategorien || {})
    .filter(([key]) => rows.some((r) => r.kategorien[key] !== undefined));

  const table = el('table', { class: 'data' });
  const thead = el('thead');
  const headRow = el('tr');
  headRow.append(el('th', { style: { cursor: 'default' } }, 'Bank'));
  headRow.append(el('th', { style: { cursor: 'default' } }, 'Gesamt',
    el('span', { class: 'sub' }, 'Perzentil')));
  kats.forEach(([, label]) => {
    headRow.append(el('th', { style: { cursor: 'default', whiteSpace: 'normal',
      minWidth: '104px' } }, label));
  });
  headRow.append(el('th', { style: { cursor: 'default' } }, 'Kennzahlen'));
  thead.append(headRow);
  table.append(thead);

  const tbody = el('tbody');
  rows.forEach((row) => {
    const tr = el('tr', { class: row.istZielbank ? 'target' : '' });
    tr.append(el('td', {}, row.name, row.istZielbank
      ? el('span', { class: 'badge accent', style: { marginLeft: '7px' } }, 'Zielbank') : null));
    tr.append(scoreCell(row.gesamt, true));
    kats.forEach(([key]) => tr.append(scoreCell(row.kategorien[key], false)));
    tr.append(el('td', { class: 'num muted' }, String(row.abgedeckteKpis)));
    tbody.append(tr);
  });
  table.append(tbody);
  host.append(el('div', { class: 'table-scroll' }, table));
}

function scoreCell(value, bold) {
  if (value === null || value === undefined) {
    return el('td', { class: 'na' }, 'n/a');
  }
  const td = el('td', { class: 'num heat' });
  td.style.setProperty('--heat-bg', heatColor(value));
  td.append(el('span', { style: bold ? { fontWeight: '700' } : {} }, fmt(value, 0)));
  return td;
}

/* ------------------------------------------------------------ Matrix */
function renderMatrix(mat) {
  const host = document.getElementById('matrixCard');
  clear(host);

  const banks = mat.banken || [];
  host.append(el('div', { class: 'card-head' },
    el('div', {},
      el('h2', {}, `Kennzahlenmatrix ${state.year}`),
      el('p', { class: 'card-desc' },
        'Spaltenkopf anklicken zum Sortieren. Die Einfärbung zeigt die Position '
        + 'innerhalb der Gruppe; je kräftiger, desto besser der Rang. '
        + 'Zeigen Sie auf einen Wert, um Quelle und Herkunft zu sehen.')),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn sm',
        onClick: () => download(`/api/export/csv-wide${query()}`),
      }, 'Matrix als CSV'),
      el('button', {
        class: 'btn sm',
        onClick: () => download(`/api/export/xlsx${query({ years: state.boot.jahre.join(',') })}`),
      }, 'Excel-Mappe'))));

  if (!banks.length) {
    host.append(emptyState('Keine Banken ausgewählt',
      'Wählen Sie oben mindestens eine Vergleichsbank aus.'));
    return;
  }

  const keys = kpiKeys().filter((key) => banks.some(
    (b) => cellOf(mat, b.id, key)?.value !== null && cellOf(mat, b.id, key)?.value !== undefined));

  if (!keys.length) {
    host.append(emptyState('Keine Werte', `Für ${state.year} liegen keine Kennzahlen vor.`));
    return;
  }

  // Sortierung der Bankspalten
  const sorted = [...banks];
  const { col, dir } = state.compareSort;
  if (col === 'name') {
    sorted.sort((a, b) => (dir === 'asc' ? 1 : -1) * a.name.localeCompare(b.name, 'de'));
  } else if (keys.includes(col)) {
    sorted.sort((a, b) => {
      const av = cellOf(mat, a.id, col)?.value;
      const bv = cellOf(mat, b.id, col)?.value;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return dir === 'asc' ? av - bv : bv - av;
    });
  }

  const table = el('table', { class: 'data' });
  const thead = el('thead');
  const headRow = el('tr');
  headRow.append(el('th', {
    class: col === 'name' ? 'sorted' : '',
    onClick: () => toggleSort('name'),
  }, 'Kennzahl'));
  sorted.forEach((bank) => {
    headRow.append(el('th', {
      style: { whiteSpace: 'normal', minWidth: '112px' },
      title: `${bank.name}\n${bank.gruppe || ''}\n${bank.basis || ''}`,
    }, bank.kuerzel,
    bank.id === state.boot.zielbankId
      ? el('span', { class: 'sub', style: { color: 'var(--accent)' } }, 'Zielbank')
      : el('span', { class: 'sub' }, bank.gruppe || '')));
  });
  thead.append(headRow);
  table.append(thead);

  const tbody = el('tbody');
  const kategorien = state.boot.kategorien;
  let lastKat = null;

  keys.forEach((key) => {
    const def = kpiDef(key);
    if (def.kategorie !== lastKat) {
      lastKat = def.kategorie;
      const gr = el('tr', { class: 'group-row' });
      gr.append(el('td', { colspan: sorted.length + 1 },
        kategorien[lastKat] || lastKat));
      tbody.append(gr);
    }

    const values = sorted
      .map((b) => cellOf(mat, b.id, key)?.value)
      .filter((v) => typeof v === 'number');
    const ranked = [...values].sort((a, b) => a - b);

    const tr = el('tr', {
      class: key === state.kpi ? 'target' : '',
      style: { cursor: 'pointer' },
      onClick: () => { state.kpi = key; window.dispatchEvent(new CustomEvent('kpi-selected')); },
    });
    tr.append(el('td', { title: def.beschreibung + (def.formel ? `\n\nFormel: ${def.formel}` : '') },
      def.label,
      el('span', { class: 'sub muted', style: { display: 'block', fontSize: '0.72rem' } },
        unitShort(def.unit) + (def.berechnet ? ' · berechnet' : ''))));

    sorted.forEach((bank) => {
      const cell = cellOf(mat, bank.id, key);
      const value = cell?.value;
      if (value === null || value === undefined) {
        tr.append(el('td', { class: 'na' }, 'n/a'));
        return;
      }
      const td = el('td', { class: 'num heat' });
      if (def.hoeherIstBesser !== null && ranked.length > 2) {
        const below = ranked.filter((v) => v < value).length;
        const equal = ranked.filter((v) => v === value).length;
        let pct = ((below + 0.5 * equal) / ranked.length) * 100;
        if (!def.hoeherIstBesser) pct = 100 - pct;
        td.style.setProperty('--heat-bg', heatColor(pct));
      }
      td.append(el('span', {}, fmt(value)));
      td.addEventListener('mousemove', (e) => showTip(
        `<div class="tt-title">${escapeHtml(bank.name)}</div>`
        + `<div class="tt-row"><span>${escapeHtml(def.label)}</span>`
        + `<span class="v">${fmt(value)} ${escapeHtml(unitShort(def.unit))}</span></div>`
        + (cell.source
          ? `<div class="tt-src">${cell.berechnet ? 'Formel' : 'Quelle'}: ${escapeHtml(cell.source)}</div>`
          : ''),
        e.clientX, e.clientY));
      td.addEventListener('mouseleave', hideTip);
      tr.append(td);
    });
    tbody.append(tr);
  });

  table.append(tbody);
  host.append(el('div', { class: 'table-scroll', style: { maxHeight: '70vh' } }, table));
}

function cellOf(mat, bankId, key) {
  return mat.zellen?.[bankId]?.[state.year]?.[key] || null;
}

function toggleSort(col) {
  if (state.compareSort.col === col) {
    state.compareSort.dir = state.compareSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.compareSort = { col, dir: col === 'name' ? 'asc' : 'desc' };
  }
  if (matrixCache) renderMatrix(matrixCache);
}

/* ------------------------------------------------------- Ertragsmix */
function renderMixCard(mat) {
  const host = document.getElementById('mixCard');
  clear(host);
  host.append(
    el('h2', {}, `Ertragsstruktur ${state.year}`),
    el('p', { class: 'card-desc' },
      'Zusammensetzung des Bruttoertrags aus Zins-, Kommissions- und Handelsgeschäft. '
      + 'Nur positive Beiträge werden dargestellt; die Balkenlänge entspricht 100 Prozent.'));

  const rows = (mat.banken || []).map((bank) => {
    const get = (k) => {
      const v = cellOf(mat, bank.id, k)?.value;
      return typeof v === 'number' ? v : 0;
    };
    const zins = get('zinserfolg');
    const kommission = get('kommissionserfolg');
    const handel = get('handelserfolg');
    return {
      name: bank.name,
      istZielbank: bank.id === state.boot.zielbankId,
      zins: Math.max(zins, 0),
      kommission: Math.max(kommission, 0),
      handel: Math.max(handel, 0),
      total: Math.max(zins, 0) + Math.max(kommission, 0) + Math.max(handel, 0),
    };
  }).sort((a, b) => b.total - a.total);

  const chart = el('div');
  host.append(chart);
  renderMix(chart, rows, 'Balkenlänge = 100 % des Bruttoertrags, Zahl rechts = Absolutbetrag');
}

/* ---------------------------------------------------- Streudiagramm */
function renderScatterCard(payload) {
  const host = document.getElementById('scatterCard');
  clear(host);

  const options = kpiKeys().map((key) => ({ key, def: kpiDef(key) }));
  const makeSelect = (value, onChange) => {
    const sel = el('select', { onChange: (e) => onChange(e.target.value) });
    const kategorien = state.boot.kategorien;
    const groups = {};
    options.forEach((o) => { (groups[o.def.kategorie] ||= []).push(o); });
    Object.entries(groups).forEach(([kat, items]) => {
      const og = el('optgroup', { label: kategorien[kat] || kat });
      items.forEach((o) => {
        og.append(el('option', { value: o.key, selected: o.key === value }, o.def.label));
      });
      sel.append(og);
    });
    return sel;
  };

  host.append(el('div', { class: 'card-head' },
    el('div', {},
      el('h2', {}, 'Zusammenhänge'),
      el('p', { class: 'card-desc' },
        'Zwei Kennzahlen gegeneinander. Die gestrichelte Linie erscheint nur, wenn ein '
        + 'Zusammenhang erkennbar ist. Korrelation belegt keine Ursache.')),
    el('div', { class: 'btn-row' },
      el('label', { class: 'field', style: { margin: 0, minWidth: '210px' } },
        el('span', {}, 'X-Achse'),
        makeSelect(state.scatterX, (v) => { state.scatterX = v; refresh(); })),
      el('label', { class: 'field', style: { margin: 0, minWidth: '210px' } },
        el('span', {}, 'Y-Achse'),
        makeSelect(state.scatterY, (v) => { state.scatterY = v; refresh(); })))));

  const chart = el('div');
  host.append(chart);
  renderScatter(chart, payload);
}
