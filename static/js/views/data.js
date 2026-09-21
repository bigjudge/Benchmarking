/* Ansicht „Datenpflege“: Banken verwalten, Kennzahlen manuell korrigieren. */

import {
  state, api, apiJson, el, clear, fmt, kpiDef, emptyState, toast, toastError,
  modal, confirmDialog, parseNumberInput, herkunftLabel, confidenceClass, fmtDate,
} from '../core.js';

let container = null;
let currentBankId = null;
let currentYear = null;
let metrics = null;
const dirty = new Map();

export function mount(host) {
  container = host;
  clear(host);
  host.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Datenpflege' }),
      el('p', {
        text: 'Banken anlegen, Stammdaten pflegen und einzelne Kennzahlen korrigieren. '
          + 'Manuell geänderte Werte überschreiben extrahierte und werden entsprechend '
          + 'gekennzeichnet.',
      })),
    el('section', { class: 'card', id: 'editorCard' }),
  );
}

export async function refresh() {
  if (!container) return;
  if (!currentBankId || !state.boot.banken.some((b) => b.id === currentBankId)) {
    currentBankId = state.boot.banken.find((b) => b.istZielbank)?.id
      || state.boot.banken[0]?.id || null;
  }
  if (!currentYear || !state.boot.jahre.includes(currentYear)) {
    currentYear = state.year || state.boot.jahre[0];
  }
  await loadMetrics();
  render();
}

async function loadMetrics() {
  if (!currentBankId) { metrics = null; return; }
  try {
    metrics = await api(`/api/banks/${currentBankId}/metrics`
      + `?years=${state.boot.jahre.join(',')}`);
  } catch (err) {
    toastError(err, 'Kennzahlen konnten nicht geladen werden');
    metrics = null;
  }
}

function render() {
  const host = document.getElementById('editorCard');
  if (!host) return;
  clear(host);

  host.append(el('div', { class: 'card-head' },
    el('div', {},
      el('h2', {}, 'Banken und Kennzahlen'),
      el('p', { class: 'card-desc' },
        'Links die Bank wählen, rechts die Werte bearbeiten. '
        + 'Berechnete Kennzahlen sind nicht editierbar – sie ergeben sich aus den '
        + 'berichteten Werten.')),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn sm primary', onClick: createBank }, '+ Bank anlegen'),
      el('button', { class: 'btn sm', onClick: importData }, 'Daten importieren'))));

  if (!state.boot.banken.length) {
    host.append(emptyState('Noch keine Banken',
      'Legen Sie eine Bank an oder laden Sie einen Geschäftsbericht hoch.'));
    return;
  }

  const grid = el('div', { class: 'editor-grid' });
  grid.append(bankListPane(), editorPane());
  host.append(grid);
}

/* ------------------------------------------------------- Bankenliste */
function bankListPane() {
  const pane = el('div');
  const list = el('div', { class: 'bank-list' });

  state.boot.banken.forEach((bank) => {
    list.append(el('button', {
      class: bank.id === currentBankId ? 'active' : '',
      onClick: async () => {
        if (dirty.size && !await confirmDiscard()) return;
        dirty.clear();
        currentBankId = bank.id;
        await loadMetrics();
        render();
      },
    },
    bank.name,
    el('span', { class: 'sub' },
      bank.istZielbank ? 'Zielbank · ' : '',
      bank.gruppe || 'ohne Gruppe',
      bank.jahre?.length ? ` · ${bank.jahre.join(', ')}` : ' · keine Daten')));
  });

  pane.append(list);
  return pane;
}

/* ---------------------------------------------------------- Editor */
function editorPane() {
  const pane = el('div');
  const bank = state.boot.banken.find((b) => b.id === currentBankId);
  if (!bank || !metrics) {
    pane.append(emptyState('Keine Bank ausgewählt', ''));
    return pane;
  }

  // Stammdaten
  const nameInput = el('input', { type: 'text', value: bank.name });
  const kurzInput = el('input', { type: 'text', value: bank.kuerzel || '' });
  const gruppeInput = el('input', { type: 'text', value: bank.gruppe || '' });
  const basisInput = el('input', { type: 'text', value: bank.basis || '' });
  const notizInput = el('textarea', { rows: 2 }, bank.notizen || '');

  const stamm = el('details', { open: false, style: { marginBottom: '16px' } });
  stamm.append(el('summary', {
    style: { cursor: 'pointer', fontSize: '0.86rem', fontWeight: '600', marginBottom: '10px' },
  }, `Stammdaten – ${bank.name}`));
  stamm.append(
    el('div', { class: 'upload-form', style: { marginTop: '12px' } },
      el('label', { class: 'field', style: { margin: 0 } },
        el('span', {}, 'Name'), nameInput),
      el('label', { class: 'field', style: { margin: 0 } },
        el('span', {}, 'Kürzel ', el('span', { class: 'hint' }, '– für Diagramme')), kurzInput),
      el('label', { class: 'field', style: { margin: 0 } },
        el('span', {}, 'Gruppe / Geschäftsmodell'), gruppeInput),
      el('label', { class: 'field', style: { margin: 0 } },
        el('span', {}, 'Konsolidierungsbasis'), basisInput)),
    el('label', { class: 'field' }, el('span', {}, 'Notizen'), notizInput),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary sm',
        onClick: async () => {
          try {
            await apiJson(`/api/banks/${bank.id}`, 'PATCH', {
              name: nameInput.value.trim(), kuerzel: kurzInput.value.trim(),
              gruppe: gruppeInput.value.trim(), basis: basisInput.value.trim(),
              notizen: notizInput.value.trim(),
            });
            toast('Stammdaten gespeichert', bank.name, 'success');
            window.dispatchEvent(new CustomEvent('data-changed'));
          } catch (err) { toastError(err, 'Speichern fehlgeschlagen'); }
        },
      }, 'Stammdaten speichern'),
      !bank.istZielbank ? el('button', {
        class: 'btn sm',
        onClick: async () => {
          await api(`/api/target/${bank.id}`, { method: 'POST' });
          toast('Zielbank geändert', bank.name, 'success');
          window.dispatchEvent(new CustomEvent('data-changed'));
        },
      }, 'Als Zielbank festlegen') : el('span', { class: 'badge accent' }, 'Zielbank'),
      el('button', {
        class: 'btn sm danger',
        onClick: () => deleteBank(bank),
      }, 'Bank löschen')));
  pane.append(stamm);

  // Jahreswahl
  const yearSeg = el('div', { class: 'seg' });
  state.boot.jahre.forEach((year) => {
    yearSeg.append(el('button', {
      class: year === currentYear ? 'active' : '',
      onClick: async () => {
        if (dirty.size && !await confirmDiscard()) return;
        dirty.clear();
        currentYear = year;
        render();
      },
    }, year));
  });

  pane.append(el('div', { class: 'flex-between', style: { marginBottom: '12px' } },
    el('div', { class: 'control-group' },
      el('div', { class: 'glabel' }, 'Berichtsjahr'), yearSeg),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn sm', onClick: addYear }, '+ Jahr hinzufügen'),
      el('button', {
        class: 'btn sm danger',
        onClick: () => deleteYear(bank),
      }, `${currentYear} leeren`))));

  // Kennzahlen
  const cells = metrics.jahre?.[currentYear] || {};
  const editor = el('div', { class: 'metric-editor' });
  const kategorien = state.boot.kategorien;
  let lastKat = null;

  [...state.boot.berichteteKpis, ...state.boot.abgeleiteteKpis].forEach((key) => {
    const def = kpiDef(key);
    if (!def) return;
    if (def.kategorie !== lastKat) {
      lastKat = def.kategorie;
      editor.append(el('div', { class: 'metric-cat' }, kategorien[lastKat] || lastKat));
    }

    const cell = cells[key] || {};
    const row = el('div', { class: `metric-row${def.berechnet ? ' calc' : ''}` });

    const nameCol = el('div', { class: 'metric-name' },
      def.label,
      el('span', { class: 'unit' }, def.unit),
      def.berechnet ? el('span', {
        class: 'badge calc', style: { marginLeft: '6px' },
        title: def.formel,
      }, 'ƒ') : null);

    if (def.berechnet) {
      row.append(nameCol,
        el('div', { class: 'right num secondary' },
          cell.value === null || cell.value === undefined ? 'n/a' : fmt(cell.value)),
        el('div', { class: 'small muted' }, 'berechnet'),
        el('div', { class: 'small muted', title: def.formel }, def.formel || ''));
      editor.append(row);
      return;
    }

    const valueInput = el('input', {
      type: 'text',
      value: cell.value === null || cell.value === undefined ? '' : fmt(cell.value),
      placeholder: 'n/a',
      dataset: { kpi: key },
    });
    const sourceInput = el('input', {
      type: 'text', value: cell.source || '', placeholder: 'Quelle, z. B. Bilanz S. 15',
      dataset: { kpi: key },
    });

    const markDirty = () => {
      dirty.set(key, {
        value: parseNumberInput(valueInput.value),
        source: sourceInput.value,
      });
      row.classList.add('dirty');
      updateSaveBar();
    };
    valueInput.addEventListener('input', markDirty);
    sourceInput.addEventListener('input', markDirty);

    row.append(nameCol, valueInput,
      el('div', { class: 'small muted nowrap', title: cell.geaendertAm ? fmtDate(cell.geaendertAm) : '' },
        cell.confidence !== null && cell.confidence !== undefined
          ? el('span', {
            class: `conf-dot ${confidenceClass(cell.confidence)}`,
            title: `Konfidenz ${Math.round(cell.confidence * 100)} %`,
          }) : null,
        herkunftLabel(cell.herkunft)),
      sourceInput);
    editor.append(row);
  });

  pane.append(editor);

  const saveBar = el('div', { class: 'sticky-actions', id: 'saveBar' },
    el('button', { class: 'btn primary', onClick: saveMetrics }, 'Änderungen speichern'),
    el('button', {
      class: 'btn',
      onClick: async () => { dirty.clear(); await loadMetrics(); render(); },
    }, 'Verwerfen'),
    el('span', { class: 'small muted grow', id: 'dirtyCount' },
      'Keine ungespeicherten Änderungen'));
  pane.append(saveBar);

  return pane;
}

function updateSaveBar() {
  const label = document.getElementById('dirtyCount');
  if (label) {
    label.textContent = dirty.size
      ? `${dirty.size} Feld(er) geändert – noch nicht gespeichert`
      : 'Keine ungespeicherten Änderungen';
    label.style.color = dirty.size ? 'var(--serious)' : '';
  }
}

async function saveMetrics() {
  if (!dirty.size) {
    toast('Nichts zu speichern', 'Es wurden keine Werte geändert.', 'warn');
    return;
  }
  const werte = {};
  dirty.forEach((entry, key) => {
    werte[key] = { value: entry.value, source: entry.source, herkunft: 'manuell' };
  });
  try {
    const res = await apiJson(`/api/banks/${currentBankId}/metrics/${currentYear}`,
      'PUT', { werte });
    toast('Gespeichert', `${res.geaendert} Wert(e) aktualisiert.`, 'success');
    dirty.clear();
    await loadMetrics();
    render();
    window.dispatchEvent(new CustomEvent('data-changed'));
  } catch (err) {
    toastError(err, 'Speichern fehlgeschlagen');
  }
}

function confirmDiscard() {
  return confirmDialog('Ungespeicherte Änderungen',
    `${dirty.size} Feld(er) wurden geändert, aber nicht gespeichert. Verwerfen?`,
    'Verwerfen');
}

/* ------------------------------------------------------- Bank-Aktionen */
async function createBank() {
  const nameInput = el('input', { type: 'text', placeholder: 'z. B. Musterbank AG' });
  const kurzInput = el('input', { type: 'text', placeholder: 'Musterbank' });
  const gruppeInput = el('input', { type: 'text', placeholder: 'Privatbank / Vermögensverwaltung' });

  const ok = await modal({
    title: 'Neue Bank anlegen',
    subtitle: 'Sie können danach Kennzahlen manuell erfassen oder einen '
      + 'Geschäftsbericht hochladen.',
    content: el('div', {},
      el('label', { class: 'field' }, el('span', {}, 'Name'), nameInput),
      el('label', { class: 'field' }, el('span', {}, 'Kürzel für Diagramme'), kurzInput),
      el('label', { class: 'field' }, el('span', {}, 'Gruppe / Geschäftsmodell'), gruppeInput)),
    confirmText: 'Anlegen',
    onConfirm: () => {
      if (!nameInput.value.trim()) {
        nameInput.focus();
        toast('Name fehlt', 'Geben Sie einen Namen ein.', 'warn');
        return false;
      }
      return true;
    },
  });
  if (!ok) return;

  try {
    const bank = await apiJson('/api/banks', 'POST', {
      name: nameInput.value.trim(),
      kuerzel: kurzInput.value.trim() || nameInput.value.trim(),
      gruppe: gruppeInput.value.trim(),
    });
    toast('Bank angelegt', bank.name, 'success');
    currentBankId = bank.id;
    window.dispatchEvent(new CustomEvent('data-changed'));
  } catch (err) {
    toastError(err, 'Anlegen fehlgeschlagen');
  }
}

async function deleteBank(bank) {
  const ok = await confirmDialog('Bank löschen?',
    `„${bank.name}“ wird mit allen Kennzahlen entfernt. Das lässt sich nur über einen `
    + 'Sicherungspunkt rückgängig machen.');
  if (!ok) return;
  try {
    await api(`/api/banks/${bank.id}`, { method: 'DELETE' });
    toast('Bank gelöscht', bank.name, 'success');
    currentBankId = null;
    window.dispatchEvent(new CustomEvent('data-changed'));
  } catch (err) {
    toastError(err, 'Löschen fehlgeschlagen');
  }
}

async function addYear() {
  const input = el('input', {
    type: 'text', placeholder: 'z. B. 2023', value: String(new Date().getFullYear() - 1),
  });
  const ok = await modal({
    title: 'Berichtsjahr hinzufügen',
    subtitle: 'Das Jahr wird angelegt, sobald Sie den ersten Wert speichern.',
    content: el('label', { class: 'field' }, el('span', {}, 'Jahr'), input),
    confirmText: 'Hinzufügen',
  });
  if (!ok) return;
  const year = input.value.trim();
  if (!/^\d{4}$/.test(year)) {
    toast('Ungültiges Jahr', 'Bitte eine vierstellige Jahreszahl eingeben.', 'warn');
    return;
  }
  try {
    await apiJson(`/api/banks/${currentBankId}/metrics/${year}`, 'PUT', {
      werte: { bilanzsumme: { value: null, source: '', herkunft: 'leer' } },
    });
    currentYear = year;
    window.dispatchEvent(new CustomEvent('data-changed'));
    toast('Jahr angelegt', year, 'success');
  } catch (err) {
    toastError(err, 'Jahr konnte nicht angelegt werden');
  }
}

async function deleteYear(bank) {
  const ok = await confirmDialog(`Jahr ${currentYear} leeren?`,
    `Alle Kennzahlen von „${bank.name}“ für ${currentYear} werden gelöscht.`);
  if (!ok) return;
  try {
    await api(`/api/banks/${bank.id}/metrics/${currentYear}`, { method: 'DELETE' });
    toast('Jahr geleert', `${bank.name} · ${currentYear}`, 'success');
    dirty.clear();
    window.dispatchEvent(new CustomEvent('data-changed'));
  } catch (err) {
    toastError(err, 'Löschen fehlgeschlagen');
  }
}

async function importData() {
  const input = el('input', { type: 'file', accept: '.json,application/json' });
  const ok = await modal({
    title: 'Daten importieren',
    subtitle: 'Eine zuvor exportierte JSON-Datei einlesen. Der aktuelle Bestand wird '
      + 'ersetzt; vorher wird automatisch ein Sicherungspunkt angelegt.',
    content: el('label', { class: 'field' }, el('span', {}, 'JSON-Datei'), input),
    confirmText: 'Importieren',
    danger: true,
    onConfirm: () => {
      if (!input.files?.length) {
        toast('Keine Datei', 'Wählen Sie eine JSON-Datei aus.', 'warn');
        return false;
      }
      return true;
    },
  });
  if (!ok) return;

  const form = new FormData();
  form.append('datei', input.files[0]);
  try {
    const res = await api('/api/import/json', { method: 'POST', body: form });
    toast('Import abgeschlossen', `${res.banken} Banken übernommen.`, 'success');
    window.dispatchEvent(new CustomEvent('data-changed'));
  } catch (err) {
    toastError(err, 'Import fehlgeschlagen');
  }
}
