/* Ansicht „Einstellungen“: API-Key, Modellwahl, Export, Sicherungspunkte, Protokoll. */

import {
  state, api, apiJson, el, clear, fmtBytes, fmtDate, relTime, query,
  toast, toastError, confirmDialog, download, emptyState,
} from '../core.js';

let container = null;

export function mount(host) {
  container = host;
  clear(host);
  host.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Einstellungen' }),
      el('p', {
        text: 'Zugang zur Gemini-API, Verarbeitungsparameter, Export der Auswertung '
          + 'und Sicherungspunkte des Datenbestands.',
      })),
    el('div', { class: 'grid-2' },
      el('section', { class: 'card', id: 'apiCard' }),
      el('section', { class: 'card', id: 'paramCard' })),
    el('section', { class: 'card', id: 'exportCard' }),
    el('section', { class: 'card', id: 'methodikCard' }),
    el('div', { class: 'grid-2' },
      el('section', { class: 'card', id: 'backupCard' }),
      el('section', { class: 'card', id: 'auditCard' })),
  );
}

export async function refresh() {
  if (!container) return;
  renderApi();
  renderParams();
  renderExport();
  try {
    const [meth, backups, audit] = await Promise.all([
      api('/api/methodik', { quiet: true }),
      api('/api/backups', { quiet: true }),
      api('/api/audit?limit=60', { quiet: true }),
    ]);
    renderMethodik(meth);
    renderBackups(backups);
    renderAudit(audit);
  } catch (err) {
    toastError(err, 'Einstellungen konnten nicht vollständig geladen werden');
  }
}

/* ---------------------------------------------------------- API-Key */
function renderApi() {
  const host = document.getElementById('apiCard');
  clear(host);
  const s = state.boot.einstellungen || {};

  const keyInput = el('input', {
    type: 'password', placeholder: s.geminiKeyConfigured ? s.geminiKeyHint : 'AIza…',
    autocomplete: 'off',
  });
  const status = el('div', { class: 'small', style: { marginTop: '10px' } });

  host.append(
    el('h2', {}, 'Gemini-API',
      s.geminiKeyConfigured
        ? el('span', { class: 'badge good' }, 'Schlüssel hinterlegt')
        : el('span', { class: 'badge critical' }, 'kein Schlüssel')),
    el('p', { class: 'card-desc' },
      'Der Schlüssel wird lokal in der Datei .env abgelegt und nur für Aufrufe an '
      + 'die Gemini-API verwendet. Einen Schlüssel erhalten Sie unter '
      + 'aistudio.google.com/apikey.'),
    el('label', { class: 'field' },
      el('span', {}, 'API-Schlüssel',
        s.geminiKeySource
          ? el('span', { class: 'hint' }, ` – aktiv aus ${s.geminiKeySource}`) : null),
      keyInput),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary sm',
        onClick: async () => {
          if (!keyInput.value.trim()) {
            toast('Kein Schlüssel', 'Bitte einen Schlüssel eingeben.', 'warn');
            return;
          }
          try {
            await apiJson('/api/settings', 'PATCH', { geminiApiKey: keyInput.value.trim() });
            keyInput.value = '';
            toast('Schlüssel gespeichert', 'Verbindung wird getestet …', 'success');
            await testKey(status);
            window.dispatchEvent(new CustomEvent('settings-changed'));
          } catch (err) { toastError(err, 'Speichern fehlgeschlagen'); }
        },
      }, 'Speichern'),
      el('button', {
        class: 'btn sm',
        onClick: () => testKey(status),
      }, 'Verbindung testen'),
      s.geminiKeyConfigured ? el('button', {
        class: 'btn sm danger',
        onClick: async () => {
          const ok = await confirmDialog('Schlüssel entfernen?',
            'Ohne Schlüssel funktionieren OCR und Extraktion nicht mehr.', 'Entfernen');
          if (!ok) return;
          await apiJson('/api/settings', 'PATCH', { geminiApiKey: '' });
          toast('Schlüssel entfernt', '', 'success');
          window.dispatchEvent(new CustomEvent('settings-changed'));
        },
      }, 'Entfernen') : null),
    status);
}

async function testKey(statusNode) {
  statusNode.replaceChildren(el('span', { class: 'spinner' }), ' Verbindung wird geprüft …');
  try {
    const res = await api('/api/settings/test', { method: 'POST' });
    if (res.ok) {
      statusNode.replaceChildren(
        el('span', { class: 'badge good' }, 'Verbindung steht'),
        el('div', { class: 'muted', style: { marginTop: '6px' } },
          `${res.modelle} Modelle verfügbar, darunter ${res.beispiele.slice(0, 4).join(', ')}.`));
      toast('Verbindung erfolgreich', `${res.modelle} Modelle erreichbar.`, 'success');
    } else {
      statusNode.replaceChildren(
        el('span', { class: 'badge critical' }, 'Fehler'),
        el('div', { class: 'muted', style: { marginTop: '6px' } }, res.fehler || ''));
    }
  } catch (err) {
    statusNode.replaceChildren(
      el('span', { class: 'badge critical' }, 'Fehler'),
      el('div', { class: 'muted', style: { marginTop: '6px' } }, err.message));
  }
}

/* ------------------------------------------------------- Parameter */
function renderParams() {
  const host = document.getElementById('paramCard');
  clear(host);
  const s = state.boot.einstellungen || {};

  const modelInput = el('input', { type: 'text', value: s.geminiModel || '' });
  const ocrModelInput = el('input', { type: 'text', value: s.geminiOcrModel || '' });
  const maxPages = el('input', { type: 'number', min: 4, max: 200, value: s.maxPages });
  const dpi = el('input', { type: 'number', min: 100, max: 400, step: 25, value: s.ocrDpi });
  const batch = el('input', { type: 'number', min: 1, max: 16, value: s.ocrBatchSize });
  const timeout = el('input', { type: 'number', min: 30, max: 900, value: s.requestTimeout });

  host.append(
    el('h2', {}, 'Verarbeitung'),
    el('p', { class: 'card-desc' },
      'Steuert, wie viel eines Berichts ausgewertet wird. Mehr Seiten bedeuten '
      + 'höhere Trefferquote, aber längere Laufzeit und mehr Tokenverbrauch.'),
    el('div', { class: 'upload-form', style: { marginTop: 0 } },
      el('label', { class: 'field', style: { margin: 0 } },
        el('span', {}, 'Modell für die Extraktion'), modelInput),
      el('label', { class: 'field', style: { margin: 0 } },
        el('span', {}, 'Modell für OCR'), ocrModelInput),
      el('label', { class: 'field', style: { margin: 0 } },
        el('span', {}, 'Seiten je Bericht ', el('span', { class: 'hint' }, '– Auswahl nach Relevanz')),
        maxPages),
      el('label', { class: 'field', style: { margin: 0 } },
        el('span', {}, 'OCR-Auflösung ', el('span', { class: 'hint' }, '– dpi')), dpi),
      el('label', { class: 'field', style: { margin: 0 } },
        el('span', {}, 'Seiten je OCR-Anfrage'), batch),
      el('label', { class: 'field', style: { margin: 0 } },
        el('span', {}, 'Zeitlimit ', el('span', { class: 'hint' }, '– Sekunden')), timeout)),
    el('div', { class: 'btn-row', style: { marginTop: '12px' } },
      el('button', {
        class: 'btn primary sm',
        onClick: async () => {
          try {
            await apiJson('/api/settings', 'PATCH', {
              geminiModel: modelInput.value.trim(),
              geminiOcrModel: ocrModelInput.value.trim(),
              maxPages: Number(maxPages.value),
              ocrDpi: Number(dpi.value),
              ocrBatchSize: Number(batch.value),
              requestTimeout: Number(timeout.value),
            });
            toast('Einstellungen gespeichert', '', 'success');
            window.dispatchEvent(new CustomEvent('settings-changed'));
          } catch (err) { toastError(err, 'Speichern fehlgeschlagen'); }
        },
      }, 'Speichern'),
      el('button', {
        class: 'btn sm',
        onClick: async () => {
          try {
            const res = await api('/api/settings/models');
            const names = res.modelle.map((m) => m.name);
            toast('Verfügbare Modelle', names.slice(0, 12).join(', '), 'info', 12000);
          } catch (err) { toastError(err, 'Modelle konnten nicht geladen werden'); }
        },
      }, 'Modelle abrufen')));
}

/* ---------------------------------------------------------- Export */
function renderExport() {
  const host = document.getElementById('exportCard');
  clear(host);
  host.append(
    el('h2', {}, 'Export'),
    el('p', { class: 'card-desc' },
      'Exportiert die aktuell ausgewählten Banken und Jahre. Die Excel-Mappe enthält '
      + 'Kennzahlenmatrix, Einzelwerte mit Quellenangabe, Scorecard, Stärken und '
      + 'Schwächen, Methodik sowie alle Kennzahlendefinitionen.'),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary',
        onClick: () => download(`/api/export/xlsx${query({ years: state.boot.jahre.join(',') })}`),
      }, 'Excel-Mappe'),
      el('button', {
        class: 'btn',
        onClick: () => download(`/api/export/markdown${query()}`),
      }, 'Report (Markdown)'),
      el('button', {
        class: 'btn',
        onClick: () => download(`/api/export/csv${query({ years: state.boot.jahre.join(',') })}`),
      }, 'CSV (Einzelwerte)'),
      el('button', {
        class: 'btn',
        onClick: () => download(`/api/export/csv-wide${query()}`),
      }, 'CSV (Matrix)'),
      el('button', {
        class: 'btn',
        onClick: () => download(`/api/export/json${query()}`),
      }, 'JSON-Sicherung')));
}

/* -------------------------------------------------------- Methodik */
function renderMethodik(meth) {
  const host = document.getElementById('methodikCard');
  clear(host);

  const limits = el('textarea', {
    rows: 10,
    style: { fontSize: '0.8rem', lineHeight: '1.6' },
  }, (meth.einschraenkungen || []).join('\n'));
  const files = el('textarea', {
    rows: 6, style: { fontSize: '0.8rem', lineHeight: '1.6' },
  }, (meth.verwendeteDateien || []).join('\n'));

  host.append(
    el('h2', {}, 'Methodik und Einschränkungen'),
    el('p', { class: 'card-desc' },
      'Diese Hinweise erscheinen im Markdown-Report und in der Excel-Mappe. '
      + 'Eine Zeile je Punkt. Sie dokumentieren, was die Zahlen nicht hergeben – '
      + 'das ist für die Belastbarkeit des Vergleichs genauso wichtig wie die Werte selbst.'),
    el('div', { class: 'grid-2' },
      el('label', { class: 'field' },
        el('span', {}, 'Einschränkungen ',
          el('span', { class: 'hint' }, `– ${(meth.einschraenkungen || []).length} Punkte`)),
        limits),
      el('label', { class: 'field' },
        el('span', {}, 'Verwendete Quelldateien ',
          el('span', { class: 'hint' }, `– ${(meth.verwendeteDateien || []).length} Dateien`)),
        files)),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn primary sm',
        onClick: async () => {
          try {
            await apiJson('/api/methodik', 'PUT', {
              einschraenkungen: limits.value.split('\n').map((l) => l.trim()).filter(Boolean),
              verwendeteDateien: files.value.split('\n').map((l) => l.trim()).filter(Boolean),
            });
            toast('Methodik gespeichert', '', 'success');
          } catch (err) { toastError(err, 'Speichern fehlgeschlagen'); }
        },
      }, 'Speichern')));
}

/* --------------------------------------------------- Sicherungspunkte */
function renderBackups(backups) {
  const host = document.getElementById('backupCard');
  clear(host);
  host.append(
    el('h2', {}, 'Sicherungspunkte'),
    el('p', { class: 'card-desc' },
      'Vor jeder Änderung legt der Server automatisch eine Kopie des Datenbestands an. '
      + 'Die jüngsten 30 werden aufbewahrt.'));

  if (!backups.length) {
    host.append(emptyState('Noch keine Sicherungspunkte',
      'Sie entstehen automatisch, sobald Daten geändert werden.'));
    return;
  }

  const list = el('div', { style: { maxHeight: '340px', overflowY: 'auto' } });
  backups.forEach((b) => {
    list.append(el('div', { class: 'kv-row' },
      el('span', { class: 'k' },
        el('div', {}, fmtDate(b.erstellt)),
        el('div', { class: 'small muted' }, `${relTime(b.erstellt)} · ${fmtBytes(b.groesse)}`)),
      el('span', { class: 'v' },
        el('button', {
          class: 'btn sm',
          onClick: async () => {
            const ok = await confirmDialog('Sicherungspunkt zurückspielen?',
              `Der aktuelle Datenbestand wird durch den Stand vom ${fmtDate(b.erstellt)} `
              + 'ersetzt. Der jetzige Stand wird vorher gesichert.', 'Zurückspielen');
            if (!ok) return;
            try {
              await api(`/api/backups/${encodeURIComponent(b.datei)}/restore`,
                { method: 'POST' });
              toast('Zurückgespielt', fmtDate(b.erstellt), 'success');
              window.dispatchEvent(new CustomEvent('data-changed'));
            } catch (err) { toastError(err, 'Zurückspielen fehlgeschlagen'); }
          },
        }, 'Zurückspielen'))));
  });
  host.append(list);
}

/* -------------------------------------------------------- Protokoll */
function renderAudit(entries) {
  const host = document.getElementById('auditCard');
  clear(host);
  host.append(
    el('h2', {}, 'Änderungsprotokoll'),
    el('p', { class: 'card-desc' },
      'Alle Änderungen am Datenbestand, jüngste zuerst.'));

  if (!entries.length) {
    host.append(emptyState('Keine Einträge', 'Es wurden noch keine Änderungen vorgenommen.'));
    return;
  }

  const list = el('div', { style: { maxHeight: '340px', overflowY: 'auto' } });
  entries.forEach((entry) => {
    const details = entry.details
      ? Object.entries(entry.details)
        .filter(([k]) => k !== 'felder')
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join(' · ')
      : '';
    list.append(el('div', { class: 'audit-row' },
      el('span', { class: 'ts' }, relTime(entry.ts)),
      el('span', { class: 'act' }, entry.action),
      el('span', { class: 'det' }, details)));
  });
  host.append(list);
}
