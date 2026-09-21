/* Ansicht „Dashboard“: Kennzahlauswahl, Positionierung, Ranking, Verlauf. */

import {
  state, api, query, el, clear, fmt, fmtWithUnit, fmtPct, unitShort, kpiDef,
  kpiKeys, targetBank, visibleBankIds, emptyState, toastError, herkunftLabel,
} from '../core.js';
import {
  renderRanking, renderTimeseries, renderDistribution, spreadIsExtreme,
} from '../charts.js';

let container = null;
let cachedGrowth = null;
let logScale = null; // null = automatisch entscheiden

export function mount(host) {
  container = host;
  clear(host);
  host.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Dashboard' }),
      el('p', {
        text: 'Positionierung der Zielbank gegenüber der Vergleichsgruppe. '
          + 'Kennzahl und Berichtsjahr oben wählen; die Auswahl gilt für alle Ansichten.',
      })),
    el('section', { class: 'card', id: 'kpiPicker' }),
    el('section', { class: 'card', id: 'tilesCard' }),
    el('section', { class: 'card', id: 'rankCard' }),
    el('div', { class: 'grid-2' },
      el('section', { class: 'card', id: 'distCard' }),
      el('section', { class: 'card', id: 'growthCard' })),
    el('section', { class: 'card', id: 'tsCard' }),
  );
  renderPicker();
}

export async function refresh() {
  if (!container) return;
  renderPicker();
  try {
    const [kpiData, growthData] = await Promise.all([
      api(`/api/analysis/kpi/${state.kpi}${query()}`),
      api(`/api/analysis/growth/${state.kpi}${query()}`),
    ]);
    cachedGrowth = growthData;
    renderTiles(kpiData.stats);
    renderRank(kpiData.stats);
    renderDist(kpiData.stats);
    renderGrowth(growthData);
    renderSeries(kpiData.verlauf);
  } catch (err) {
    toastError(err, 'Auswertung konnte nicht geladen werden');
  }
}

/* -------------------------------------------------------- Kennzahlwahl */
function renderPicker() {
  const host = document.getElementById('kpiPicker');
  if (!host) return;
  clear(host);

  const kategorien = state.boot.kategorien;
  const groups = {};
  kpiKeys().forEach((key) => {
    const def = kpiDef(key);
    if (!def) return;
    (groups[def.kategorie] ||= []).push([key, def]);
  });

  const pills = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
  Object.entries(groups).forEach(([kat, entries]) => {
    const row = el('div', { class: 'pill-row' });
    entries.forEach(([key, def]) => {
      const btn = el('button', {
        class: `pill${key === state.kpi ? ' active' : ''}${def.berechnet ? ' calc' : ''}`,
        title: def.beschreibung + (def.formel ? `\n\nFormel: ${def.formel}` : ''),
        onClick: () => { state.kpi = key; logScale = null; refresh(); },
      }, def.label);
      row.append(btn);
    });
    pills.append(el('div', {},
      el('div', {
        class: 'glabel',
        style: { marginBottom: '5px', fontSize: '0.7rem', textTransform: 'uppercase',
          letterSpacing: '.04em', color: 'var(--text-muted)', fontWeight: '650' },
        text: kategorien[kat] || kat,
      }),
      row));
  });

  host.append(
    el('div', { class: 'card-head' },
      el('div', {},
        el('h2', {}, 'Kennzahl & Berichtsjahr'),
        el('p', { class: 'card-desc' },
          'Mit ƒ markierte Kennzahlen werden aus berichteten Werten berechnet, '
          + 'nicht aus dem Bericht übernommen.')),
      el('div', { class: 'btn-row' },
        el('label', { class: 'chip' },
          el('input', {
            type: 'checkbox', checked: state.showDerived,
            onChange: (e) => { state.showDerived = e.target.checked; refresh(); },
          }),
          el('span', { class: 'label-text' }, 'Berechnete Kennzahlen')),
        yearToggle())),
    pills,
  );
}

function yearToggle() {
  const seg = el('div', { class: 'seg' });
  (state.boot.jahre || []).forEach((year) => {
    seg.append(el('button', {
      class: year === state.year ? 'active' : '',
      onClick: () => { state.year = year; refresh(); },
    }, year));
  });
  return seg;
}

/* --------------------------------------------------------- Positionierung */
function renderTiles(stats) {
  const host = document.getElementById('tilesCard');
  clear(host);
  const def = stats.definition || kpiDef(state.kpi);
  const unit = def?.unit || '';
  const target = targetBank();

  host.append(el('div', { class: 'card-head' },
    el('div', {},
      el('h2', {},
        `Positionierung – ${def?.label || ''}`,
        def?.berechnet ? el('span', { class: 'badge calc' }, 'berechnet') : null,
        el('span', { class: 'badge neutral' }, state.year)),
      el('p', { class: 'card-desc' },
        stats.available
          ? `${stats.n} von ${visibleBankIds().length} ausgewählten Banken weisen diesen Wert aus.`
          + (def?.formel ? ` Formel: ${def.formel}` : '')
          : 'Für diese Kennzahl liegen im gewählten Jahr keine Werte vor.')),
  ));

  if (!stats.available) {
    host.append(emptyState('Keine Daten',
      `Keine ausgewählte Bank weist „${def?.label}“ für ${state.year} aus. `
      + 'Fehlende Werte werden bewusst nicht geschätzt.'));
    return;
  }

  const richtung = def?.hoeherIstBesser === true ? 'höher ist besser'
    : def?.hoeherIstBesser === false ? 'niedriger ist besser' : 'neutral bewertet';

  const tiles = [
    {
      label: target?.name || 'Zielbank',
      value: stats.target ? fmtWithUnit(stats.target.value, unit) : 'n/a',
      target: true,
      sub: stats.rang ? `Rang ${stats.rang} von ${stats.n} · ${richtung}` : richtung,
    },
    { label: 'Peer-Durchschnitt', value: fmtWithUnit(stats.peerAvg, unit),
      sub: `${stats.peerN} Vergleichsbanken` },
    { label: 'Peer-Median', value: fmtWithUnit(stats.peerMedian, unit) },
    { label: 'Spannweite Peers',
      value: stats.peerMin !== null
        ? `${fmt(stats.peerMin)} – ${fmt(stats.peerMax)}` : 'n/a',
      sub: unitShort(unit) },
  ];

  if (stats.abweichungAvgPct !== null && stats.abweichungAvgPct !== undefined) {
    const good = stats.bewertung === 'staerke';
    tiles.push({
      label: 'Abweichung vom Peer-Ø',
      value: fmtPct(stats.abweichungAvgPct),
      valueClass: def?.hoeherIstBesser === null ? 'flat' : (good ? 'up' : 'down'),
      sub: stats.zScore !== null && stats.zScore !== undefined
        ? `z-Wert ${fmt(stats.zScore, 2)}` : '',
    });
  }
  if (stats.perzentil !== null && stats.perzentil !== undefined) {
    tiles.push({
      label: 'Perzentil',
      value: `${fmt(stats.perzentil, 0)}.`,
      sub: 'Position in der Gruppe, 100 = bester Wert',
    });
  }

  const row = el('div', { class: 'tiles' });
  tiles.forEach((t) => {
    row.append(el('div', { class: `tile${t.target ? ' target' : ''}` },
      el('div', { class: 'tlabel', text: t.label }),
      el('div', { class: `tvalue${t.valueClass ? ` delta ${t.valueClass}` : ''}`, text: t.value }),
      t.sub ? el('div', { class: 'tsub', text: t.sub }) : null));
  });
  host.append(row);

  if (stats.target?.source) {
    host.append(el('div', { class: 'small muted', style: { marginTop: '12px' } },
      `${stats.target.berechnet ? 'Formel' : 'Quelle Zielbank'}: ${stats.target.source}`
      + (stats.target.herkunft ? ` · ${herkunftLabel(stats.target.herkunft)}` : '')));
  }
}

/* ---------------------------------------------------------- Ranking */
function renderRank(stats) {
  const host = document.getElementById('rankCard');
  clear(host);

  const extrem = spreadIsExtreme(stats.rows);
  const useLog = logScale === null ? extrem : logScale;

  host.append(el('div', { class: 'card-head' },
    el('div', {},
      el('h2', {}, `Ranking ${state.year}`),
      el('p', { class: 'card-desc' },
        'Zielbank in Akzentfarbe, Vergleichsbanken neutral. '
        + 'Senkrechte Linien markieren Peer-Durchschnitt und -Median.'
        + (extrem
          ? ' Die Werte liegen um mehr als das Fünfzigfache auseinander, daher ist '
            + 'die Skala logarithmisch – sonst wären die kleinen Institute nicht lesbar.'
          : ''))),
    extrem || logScale !== null
      ? el('div', { class: 'seg' },
        el('button', {
          class: useLog ? '' : 'active',
          onClick: () => { logScale = false; renderRank(stats); },
        }, 'Linear'),
        el('button', {
          class: useLog ? 'active' : '',
          onClick: () => { logScale = true; renderRank(stats); },
        }, 'Logarithmisch'))
      : null));

  const chart = el('div');
  host.append(chart);
  renderRanking(chart, stats, { log: useLog });
}

function renderDist(stats) {
  const host = document.getElementById('distCard');
  clear(host);
  host.append(
    el('h2', {}, 'Verteilung in der Gruppe'),
    el('p', { class: 'card-desc' },
      'Jede Bank ein Punkt auf der Wertachse. Das graue Band zeigt die Peer-Spannweite.'));
  const chart = el('div');
  host.append(chart);
  renderDistribution(chart, stats);
}

/* --------------------------------------------------------- Veränderung */
function renderGrowth(payload) {
  const host = document.getElementById('growthCard');
  clear(host);
  const def = kpiDef(state.kpi);
  const rows = (payload.zeilen || []).filter((r) => r.deltaPct !== null);

  host.append(
    el('h2', {}, `Veränderung ${payload.von || ''} → ${payload.bis || ''}`),
    el('p', { class: 'card-desc' },
      'Relative Veränderung je Bank. Die Farbe folgt der Wirkungsrichtung der Kennzahl.'));

  if (!rows.length) {
    host.append(emptyState('Kein Vorjahresvergleich',
      payload.hinweis || 'Für diese Kennzahl fehlen Werte in einem der beiden Jahre.'));
    return;
  }

  rows.sort((a, b) => b.deltaPct - a.deltaPct);
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.deltaPct)), 1);
  const list = el('div');

  rows.forEach((row) => {
    const gut = def?.hoeherIstBesser === null ? null
      : def?.hoeherIstBesser ? row.deltaPct > 0 : row.deltaPct < 0;
    const cls = gut === null ? 'flat' : gut ? 'up' : 'down';
    const color = gut === null ? 'var(--peer)'
      : gut ? 'var(--good)' : 'var(--critical)';

    list.append(el('div', { class: 'insight-item' },
      el('div', { class: 'insight-body' },
        el('div', { class: 'flex-between' },
          el('div', {
            class: 'insight-title',
            style: row.istZielbank ? { color: 'var(--accent)' } : {},
            text: row.name + (row.istZielbank ? ' · Zielbank' : ''),
          }),
          el('div', { class: `delta ${cls}`, text: fmtPct(row.deltaPct) })),
        el('div', { class: 'insight-meta' },
          `${fmtWithUnit(row.von, def?.unit)} → ${fmtWithUnit(row.bis, def?.unit)}`),
        el('div', { class: 'insight-bar' },
          el('i', {
            style: {
              width: `${(Math.abs(row.deltaPct) / maxAbs) * 100}%`,
              background: row.istZielbank ? 'var(--accent)' : color,
            },
          })))));
  });
  host.append(list);
}

/* ------------------------------------------------------- Zeitverlauf */
function renderSeries(payload) {
  const host = document.getElementById('tsCard');
  clear(host);
  host.append(
    el('h2', {}, `Zeitverlauf – ${payload.definition?.label || ''}`),
    el('p', { class: 'card-desc' },
      'Zielbank hervorgehoben, Vergleichsbanken neutral. '
      + 'Zeigen Sie auf eine Jahresspalte, um alle Werte zu sehen.'));
  const chart = el('div');
  host.append(chart);
  renderTimeseries(chart, payload);
}
