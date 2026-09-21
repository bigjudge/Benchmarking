/* Ansicht „Analyse“: Stärken/Schwächen, Untersuchungsbereiche, Datenabdeckung. */

import {
  state, api, query, el, clear, fmt, fmtWithUnit, fmtPct, fmtAbweichung, kpiDef,
  emptyState, toastError, download,
} from '../core.js';

let container = null;
let showScale = false;

export function mount(host) {
  container = host;
  clear(host);
  host.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Analyse' }),
      el('p', {
        text: 'Automatisch abgeleitete Stärken und Schwächen der Zielbank, '
          + 'Abdeckung der sieben Untersuchungsbereiche und Datenqualität.',
      })),
    el('section', { class: 'card', id: 'insightCard' }),
    el('section', { class: 'card', id: 'bereicheCard' }),
    el('section', { class: 'card', id: 'coverageCard' }),
  );
}

export async function refresh() {
  if (!container) return;
  try {
    const [ins, bereiche, cov] = await Promise.all([
      api(`/api/analysis/insights${query({ skala: showScale ? '1' : '0' })}`),
      api(`/api/analysis/bereiche${query()}`),
      api(`/api/analysis/coverage${query({ years: state.boot.jahre.join(',') })}`),
    ]);
    renderInsights(ins);
    renderBereiche(bereiche);
    renderCoverage(cov);
  } catch (err) {
    toastError(err, 'Analyse konnte nicht geladen werden');
  }
}

/* -------------------------------------------------- Stärken & Schwächen */
function renderInsights(payload) {
  const host = document.getElementById('insightCard');
  clear(host);
  const target = state.boot.banken.find((b) => b.istZielbank);

  host.append(el('div', { class: 'card-head' },
    el('div', {},
      el('h2', {}, `Stärken und Schwächen – ${target?.name || 'Zielbank'} (${payload.year})`),
      el('p', { class: 'card-desc' },
        'Abweichung der Zielbank vom Durchschnitt der ausgewählten Vergleichsbanken, '
        + 'sortiert nach statistischer Auffälligkeit. Berücksichtigt werden nur Kennzahlen '
        + 'mit klarer Wirkungsrichtung und mindestens zwei Vergleichswerten. '
        + 'Absolute Grössenkennzahlen wie Bilanzsumme oder Kundenvermögen bleiben '
        + 'ausgeblendet: Sie messen, wie gross ein Institut ist, nicht wie gut es wirtschaftet.')),
    el('div', { class: 'btn-row' },
      el('label', { class: 'chip' },
        el('input', {
          type: 'checkbox', checked: showScale,
          onChange: (e) => { showScale = e.target.checked; refresh(); },
        }),
        el('span', { class: 'label-text' }, 'Grössenkennzahlen einbeziehen')),
      el('button', {
        class: 'btn sm',
        onClick: () => download(`/api/export/markdown${query()}`),
      }, 'Report als Markdown'))));

  const grid = el('div', { class: 'grid-2' });
  grid.append(
    column('Über dem Peer-Durchschnitt', payload.staerken, 'good'),
    column('Unter dem Peer-Durchschnitt', payload.schwaechen, 'critical'),
  );
  host.append(grid);

  if (payload.skala?.length) {
    host.append(foldout(
      `${payload.skala.length} Grössenkennzahlen anzeigen (nicht als Stärke oder Schwäche gewertet)`,
      payload.skala, 'var(--text-secondary)'));
  }
  if (payload.neutral?.length) {
    host.append(foldout(
      `${payload.neutral.length} Kennzahlen ohne Wertungsrichtung anzeigen`,
      payload.neutral, 'var(--text-secondary)'));
  }
}

function foldout(title, items, color) {
  const details = el('details', { style: { marginTop: '14px' } });
  details.append(el('summary', {
    style: { cursor: 'pointer', fontSize: '0.84rem', color },
  }, title));
  const list = el('div', { style: { marginTop: '10px' } });
  items.forEach((item) => {
    list.append(el('div', { class: 'kv-row' },
      el('span', { class: 'k' }, item.label,
        item.berechnet
          ? el('span', { class: 'badge calc', style: { marginLeft: '6px' } }, 'ƒ') : null),
      el('span', { class: 'v' },
        `${fmtWithUnit(item.wert, item.unit)} · Peer-Ø ${fmtWithUnit(item.peerAvg, item.unit)}`
        + (item.rang ? ` · Rang ${item.rang}/${item.n}` : ''))));
  });
  details.append(list);
  return details;
}

function column(title, items, kind) {
  const col = el('div', {},
    el('h3', { style: { fontSize: '0.87rem', margin: '0 0 8px' } }, title));

  if (!items?.length) {
    col.append(emptyState('Nichts auffällig',
      'Keine Kennzahl weicht in diese Richtung vom Peer-Durchschnitt ab.'));
    return col;
  }

  const maxScore = Math.max(...items.map((i) => i.score), 0.01);
  items.forEach((item) => {
    const def = kpiDef(item.kpi);
    col.append(el('div', { class: 'insight-item' },
      el('span', { class: `badge ${kind === 'good' ? 'good' : 'critical'}` },
        kind === 'good' ? '▲' : '▼',
        item.perzentil !== null && item.perzentil !== undefined
          ? `${fmt(item.perzentil, 0)}. Perzentil` : 'auffällig'),
      el('div', { class: 'insight-body' },
        el('div', { class: 'insight-title' }, item.label,
          item.berechnet
            ? el('span', { class: 'badge calc', style: { marginLeft: '6px' } }, 'berechnet')
            : null),
        el('div', { class: 'insight-meta' },
          `${fmtWithUnit(item.wert, item.unit)} gegenüber Peer-Ø `
          + `${fmtWithUnit(item.peerAvg, item.unit)} · `
          + `${fmtAbweichung(item.abweichungPct, item.faktor)}`
          + (item.rang ? ` · Rang ${item.rang} von ${item.n}` : '')
          + (item.n < 4 ? ' · schmale Vergleichsbasis' : '')),
        def?.formel
          ? el('div', { class: 'small muted', style: { marginTop: '2px' } }, `Formel: ${def.formel}`)
          : null,
        el('div', { class: 'insight-bar' },
          el('i', {
            style: {
              width: `${Math.min(100, (item.score / maxScore) * 100)}%`,
              background: kind === 'good' ? 'var(--good)' : 'var(--critical)',
            },
          })))));
  });
  return col;
}

/* ------------------------------------------------ Untersuchungsbereiche */
function renderBereiche(bereiche) {
  const host = document.getElementById('bereicheCard');
  clear(host);
  host.append(
    el('h2', {}, 'Die sieben Untersuchungsbereiche'),
    el('p', { class: 'card-desc' },
      'Ordnet die Untersuchungsbereiche des Vorgehensmodells den verfügbaren Kennzahlen zu '
      + 'und macht sichtbar, was aus öffentlichen Geschäftsberichten nicht ableitbar ist. '
      + 'Ein Klick auf eine Kennzahl öffnet sie im Dashboard.'));

  const grid = el('div', { class: 'ub-grid' });
  bereiche.forEach((ub, index) => {
    const card = el('div', { class: 'ub-card' },
      el('div', { class: 'ub-title' },
        el('span', { class: 'ub-num' }, String(index + 1)), ub.titel),
      el('div', { class: 'ub-desc' }, ub.beschreibung));

    if (ub.kpiStatus?.length) {
      card.append(el('div', { class: 'ub-cover' },
        el('span', {}, 'Datenabdeckung'),
        el('span', { class: 'bar' },
          el('i', { style: { width: `${ub.abdeckung}%` } })),
        el('span', { class: 'num' }, `${fmt(ub.abdeckung, 0)} %`)));

      const chips = el('div', { class: 'ub-chips' });
      ub.kpiStatus.forEach((k) => {
        chips.append(el('button', {
          class: `ub-chip${k.belegt === 0 ? ' empty' : ''}`,
          title: `${k.belegt} von ${k.vonBanken} Banken weisen diesen Wert aus`
            + (k.berechnet ? '\nBerechnete Kennzahl' : ''),
          onClick: () => {
            state.kpi = k.kpi;
            window.dispatchEvent(new CustomEvent('goto-kpi', { detail: k.kpi }));
          },
        }, k.label, el('span', { class: 'muted' }, ` ${k.belegt}/${k.vonBanken}`)));
      });
      card.append(chips);
    } else {
      card.append(el('div', { class: 'small muted', style: { fontStyle: 'italic' } },
        'Keine im Datenbestand abgedeckte Kennzahl – rein qualitativer Untersuchungsbereich.'));
    }

    card.append(el('div', { class: 'ub-gap' },
      el('strong', {}, 'Datenlücke: '), ub.luecke));
    grid.append(card);
  });
  host.append(grid);
}

/* ------------------------------------------------------ Datenabdeckung */
function renderCoverage(cov) {
  const host = document.getElementById('coverageCard');
  clear(host);
  host.append(
    el('h2', {}, 'Datenqualität und Abdeckung'),
    el('p', { class: 'card-desc' },
      'Wie viele der berichteten Kennzahlen je Bank und Jahr tatsächlich belegt sind. '
      + 'Lücken sind kein Fehler, sondern zeigen, was der jeweilige Bericht nicht ausweist.'));

  const grid = el('div', { class: 'grid-2' });

  // Abdeckung je Bank
  const left = el('div', {},
    el('h3', { style: { fontSize: '0.87rem', margin: '0 0 8px' } }, 'Je Bank'));
  const table = el('table', { class: 'data' });
  const head = el('tr');
  head.append(el('th', { style: { cursor: 'default' } }, 'Bank'));
  cov.years.forEach((y) => head.append(el('th', { style: { cursor: 'default' } }, y)));
  table.append(el('thead', {}, head));
  const tbody = el('tbody');
  const sortedBanks = [...cov.banken].sort((a, b) => {
    const ay = a.jahre[cov.years[0]]?.quote || 0;
    const by = b.jahre[cov.years[0]]?.quote || 0;
    return by - ay;
  });
  sortedBanks.forEach((bank) => {
    const tr = el('tr', {
      class: bank.bankId === state.boot.zielbankId ? 'target' : '',
    });
    tr.append(el('td', {}, bank.name));
    cov.years.forEach((y) => {
      const info = bank.jahre[y];
      tr.append(el('td', { class: 'num' },
        info ? `${fmt(info.quote, 0)} %` : '–',
        info ? el('span', { class: 'muted', style: { fontSize: '0.72rem' } },
          ` (${info.belegt}/${info.total})`) : null));
    });
    tbody.append(tr);
  });
  table.append(tbody);
  left.append(el('div', { class: 'table-scroll' }, table));

  // Am seltensten belegte Kennzahlen
  const right = el('div', {},
    el('h3', { style: { fontSize: '0.87rem', margin: '0 0 8px' } },
      'Am seltensten ausgewiesen'),
    el('p', { class: 'small muted', style: { margin: '0 0 10px' } },
      'Diese Kennzahlen fehlen in den Berichten am häufigsten – entsprechend '
      + 'eingeschränkt ist der Peer-Vergleich.'));
  const list = el('div');
  cov.kpis.slice(0, 14).forEach((k) => {
    list.append(el('div', { class: 'insight-item' },
      el('div', { class: 'insight-body' },
        el('div', { class: 'flex-between' },
          el('span', { class: 'insight-title' }, k.label),
          el('span', { class: 'num muted' }, `${fmt(k.quote, 0)} %`)),
        el('div', { class: 'insight-bar' },
          el('i', {
            style: {
              width: `${k.quote}%`,
              background: k.quote < 25 ? 'var(--critical)'
                : k.quote < 60 ? 'var(--serious)' : 'var(--good)',
            },
          })))));
  });
  right.append(list);

  grid.append(left, right);
  host.append(grid);
}
