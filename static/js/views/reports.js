/* Ansicht „Berichte“: PDF-Upload, OCR-Lauf, Prüfung und Übernahme der Werte. */

import {
  state, api, apiJson, el, clear, fmt, fmtBytes, relTime, fmtDate, kpiDef,
  emptyState, toast, toastError, confirmDialog, confidenceClass,
  parseNumberInput, escapeHtml, download,
} from '../core.js';

let container = null;
let uploads = [];
let selectedUpload = null;
let detail = null;
let activePage = null;
let pollTimer = null;
const activeJobs = new Map();

export function mount(host) {
  container = host;
  clear(host);
  host.append(
    el('div', { class: 'page-head' },
      el('h1', { text: 'Berichte einlesen' }),
      el('p', {
        text: 'Geschäftsbericht als PDF hochladen. Der Server liest den Text aus, '
          + 'setzt bei gescannten Seiten OCR ein und extrahiert die Kennzahlen. '
          + 'Vor der Übernahme prüfen und korrigieren Sie jeden Wert.',
      })),
    el('section', { class: 'card', id: 'uploadCard' }),
    el('section', { class: 'card', id: 'jobsCard', hidden: true }),
    el('section', { class: 'card', id: 'listCard' }),
    el('section', { class: 'card', id: 'reviewCard', hidden: true }),
  );
  renderUploadCard();
  startPolling();
}

export function unmount() {
  stopPolling();
}

export async function refresh() {
  if (!container) return;
  renderUploadCard();
  try {
    uploads = await api('/api/uploads', { quiet: true });
    renderList();
    if (selectedUpload && !uploads.some((u) => u.id === selectedUpload)) {
      selectedUpload = null;
      detail = null;
      document.getElementById('reviewCard').hidden = true;
    }
  } catch (err) {
    toastError(err, 'Uploads konnten nicht geladen werden');
  }
}

/* ------------------------------------------------------------ Upload */
function renderUploadCard() {
  const host = document.getElementById('uploadCard');
  if (!host) return;
  clear(host);

  const keyOk = state.boot?.einstellungen?.geminiKeyConfigured;

  host.append(
    el('h2', {}, 'Neuen Bericht hochladen'),
    el('p', { class: 'card-desc' },
      'PDF hierher ziehen oder Feld anklicken. Danach Zielbank und Berichtsjahre '
      + 'festlegen und die Auswertung starten.'));

  if (!keyOk) {
    host.append(el('div', { class: 'empty-state', style: { borderColor: 'var(--serious)' } },
      el('strong', { text: 'Kein Gemini-API-Key hinterlegt' }),
      el('div', {}, 'OCR und Kennzahlenextraktion benötigen einen Schlüssel. '),
      el('button', {
        class: 'btn primary', style: { marginTop: '12px' },
        onClick: () => window.dispatchEvent(new CustomEvent('goto-view', { detail: 'settings' })),
      }, 'Zu den Einstellungen')));
    return;
  }

  const fileInput = el('input', {
    type: 'file', accept: 'application/pdf,.pdf', multiple: true,
    onChange: (e) => handleFiles([...e.target.files]),
  });

  const zone = el('label', { class: 'dropzone' },
    el('div', { class: 'dz-icon' }, '⬆'),
    el('div', { class: 'dz-title' }, 'Geschäftsbericht hierher ziehen'),
    el('div', { class: 'dz-sub' },
      `oder klicken, um eine PDF-Datei zu wählen · maximal `
      + `${state.boot?.einstellungen?.maxUploadMb || 80} MB je Datei`),
    fileInput);

  ['dragenter', 'dragover'].forEach((evt) => {
    zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('hover'); });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('hover'); });
  });
  zone.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])]
      .filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) {
      toast('Nur PDF-Dateien', 'Andere Dateiformate werden nicht unterstützt.', 'warn');
      return;
    }
    handleFiles(files);
  });

  const bankSelect = el('select', { id: 'upBank' },
    el('option', { value: '' }, 'Automatisch erkennen / neue Bank anlegen'),
    ...state.boot.banken.map((b) => el('option', { value: b.id }, b.name)));

  const yearInput = el('input', {
    type: 'text', id: 'upYears',
    value: (state.boot.jahre || []).slice(0, 2).join(', ') || String(new Date().getFullYear()),
    placeholder: 'z. B. 2025, 2024',
  });

  const ocrToggle = el('input', { type: 'checkbox', id: 'upForceOcr' });

  host.append(zone, el('div', { class: 'upload-form' },
    el('label', { class: 'field', style: { margin: 0 } },
      el('span', {}, 'Zielbank'), bankSelect),
    el('label', { class: 'field', style: { margin: 0 } },
      el('span', {}, 'Berichtsjahre ',
        el('span', { class: 'hint' }, '– durch Komma getrennt')), yearInput),
    el('label', { class: 'field', style: { margin: 0 } },
      el('span', {}, 'Verarbeitung'),
      el('label', { class: 'chip', style: { marginTop: '4px' } },
        ocrToggle, el('span', { class: 'label-text' }, 'OCR erzwingen'))),
  ));
  host.append(el('p', { class: 'small muted', style: { marginTop: '10px' } },
    'OCR läuft automatisch, sobald Seiten keine Textebene haben. '
    + 'Erzwingen Sie sie, wenn die Textebene fehlerhaft ist, etwa bei schlecht '
    + 'konvertierten Tabellen.'));
}

async function handleFiles(files) {
  const bankId = document.getElementById('upBank')?.value || '';
  const years = (document.getElementById('upYears')?.value || '')
    .split(',').map((y) => y.trim()).filter(Boolean);
  const forceOcr = document.getElementById('upForceOcr')?.checked ? '1' : '';

  if (!years.length) {
    toast('Berichtsjahre fehlen', 'Geben Sie mindestens ein Jahr an.', 'warn');
    return;
  }

  for (const file of files) {
    const form = new FormData();
    form.append('datei', file);
    form.append('jahre', years.join(','));
    if (bankId) form.append('bankId', bankId);
    if (forceOcr) form.append('forceOcr', '1');
    try {
      const res = await api('/api/uploads', { method: 'POST', body: form });
      toast('Auswertung gestartet', `${file.name} wird verarbeitet.`, 'success');
      activeJobs.set(res.jobId, { datei: file.name, uploadId: res.upload.id });
      document.getElementById('jobsCard').hidden = false;
      startPolling();
      await refresh();
    } catch (err) {
      toastError(err, `Upload von ${file.name} fehlgeschlagen`);
    }
  }
}

/* -------------------------------------------------------------- Jobs */
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollJobs, 1600);
  pollJobs();
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollJobs() {
  const host = document.getElementById('jobsCard');
  if (!host) { stopPolling(); return; }
  let jobs;
  try {
    jobs = await api('/api/jobs', { quiet: true });
  } catch {
    return;
  }

  const laufend = jobs.filter((j) => ['wartet', 'laeuft'].includes(j.status));
  const kuerzlich = jobs.filter((j) => j.endedAt
    && (Date.now() - new Date(j.endedAt).getTime()) < 45000);
  const zeigen = [...laufend, ...kuerzlich];

  if (!zeigen.length) {
    host.hidden = true;
    if (!laufend.length) stopPolling();
    return;
  }

  host.hidden = false;
  clear(host);
  host.append(el('h2', {},
    'Laufende Auswertungen',
    laufend.length ? el('span', { class: 'spinner', style: { marginLeft: '8px' } }) : null));

  zeigen.forEach((job) => {
    const card = el('div', { class: 'job-card' });
    const statusBadge = job.status === 'fehler'
      ? el('span', { class: 'badge critical' }, 'fehlgeschlagen')
      : job.status === 'fertig'
        ? el('span', { class: 'badge good' }, 'abgeschlossen')
        : el('span', { class: 'badge accent' }, `${job.fortschritt} %`);

    card.append(
      el('div', { class: 'job-head' },
        el('div', { class: 'job-title' }, job.label), statusBadge),
      el('div', {
        class: `progress${job.status === 'fertig' ? ' done' : ''}`
          + `${job.status === 'fehler' ? ' error' : ''}`,
      }, el('i', { style: { width: `${job.status === 'fehler' ? 100 : job.fortschritt}%` } })),
      el('div', { class: 'job-msg' }, job.nachricht || ''));

    if (job.verlauf?.length > 1) {
      const log = el('div', { class: 'job-log' });
      job.verlauf.slice(-8).forEach((entry) => {
        log.append(el('div', {}, `${new Date(entry.ts).toLocaleTimeString('de-CH')} · ${entry.text}`));
      });
      card.append(log);
    }

    if (job.status === 'fertig' && job.meta?.uploadId) {
      card.append(el('div', { class: 'btn-row', style: { marginTop: '10px' } },
        el('button', {
          class: 'btn primary sm',
          onClick: () => openReview(job.meta.uploadId),
        }, 'Ergebnis prüfen')));
    }
    host.append(card);
  });

  const fertig = jobs.filter((j) => j.status === 'fertig' && activeJobs.has(j.id));
  fertig.forEach((j) => {
    activeJobs.delete(j.id);
    toast('Auswertung fertig', `${j.label} – Ergebnis kann geprüft werden.`, 'success');
    refresh();
  });
  jobs.filter((j) => j.status === 'fehler' && activeJobs.has(j.id)).forEach((j) => {
    activeJobs.delete(j.id);
    toast('Auswertung fehlgeschlagen', j.fehler || '', 'error', 10000);
    refresh();
  });

  if (!laufend.length) stopPolling();
}

/* ------------------------------------------------------- Upload-Liste */
function renderList() {
  const host = document.getElementById('listCard');
  clear(host);
  host.append(
    el('h2', {}, `Hochgeladene Berichte (${uploads.length})`),
    el('p', { class: 'card-desc' },
      'Übersicht aller eingelesenen Dateien mit Stand der Verarbeitung.'));

  if (!uploads.length) {
    host.append(emptyState('Noch keine Berichte',
      'Laden Sie oben einen Geschäftsbericht hoch, um zu beginnen.'));
    return;
  }

  const list = el('div', { class: 'upload-list' });
  uploads.forEach((u) => {
    const bank = state.boot.banken.find((b) => b.id === u.bankId);
    const status = u.uebernommen
      ? el('span', { class: 'badge good' }, `übernommen · ${u.uebernommeneWerte || 0} Werte`)
      : u.status === 'extrahiert'
        ? el('span', { class: 'badge warning' }, `geprüft werden: ${u.gefundeneWerte || 0} Werte`)
        : ['wartet', 'laeuft'].includes(u.status)
          ? el('span', { class: 'badge accent' }, 'in Verarbeitung')
          : u.status === 'abgebrochen'
            ? el('span', { class: 'badge warning', title: u.fehler || '' }, 'abgebrochen')
            : el('span', { class: 'badge neutral' }, u.status || 'unbekannt');

    const meta = el('div', { class: 'upload-meta' },
      el('span', {}, fmtBytes(u.groesseBytes)),
      el('span', {}, relTime(u.hochgeladenAm)),
      u.analyse?.seitenGesamt ? el('span', {}, `${u.analyse.seitenGesamt} Seiten`) : null,
      u.ocrSeiten?.length
        ? el('span', {}, `OCR auf ${u.ocrSeiten.length} Seite(n)`)
        : (u.status === 'extrahiert' ? el('span', {}, 'Textebene genutzt') : null),
      bank ? el('span', {}, `→ ${bank.name}`)
        : (u.erkannteBank ? el('span', {}, `erkannt: ${u.erkannteBank}`) : null),
      u.modell ? el('span', { class: 'muted' }, u.modell) : null);

    const actions = el('div', { class: 'btn-row' },
      u.hatExtraktion
        ? el('button', {
          class: `btn sm${u.uebernommen ? '' : ' primary'}`,
          onClick: () => openReview(u.id),
        }, u.uebernommen ? 'Erneut prüfen' : 'Prüfen & übernehmen')
        : null,
      el('button', {
        class: 'btn sm', title: 'Erneut auswerten',
        onClick: () => rerun(u.id),
      }, 'Neu auswerten'),
      el('button', {
        class: 'btn sm ghost', title: 'PDF öffnen',
        onClick: () => download(`/api/uploads/${u.id}/file`),
      }, 'PDF'),
      el('button', {
        class: 'btn sm danger', onClick: () => remove(u),
      }, 'Löschen'));

    list.append(el('div', {
      class: `upload-item${selectedUpload === u.id ? ' selected' : ''}`,
    },
    el('div', { class: 'grow' },
      el('div', { class: 'upload-name' }, u.dateiname, ' ', status),
      meta),
    actions));
  });
  host.append(list);
}

async function rerun(uploadId) {
  const forceOcr = await confirmRerun();
  if (forceOcr === null) return;
  try {
    const res = await apiJson(`/api/uploads/${uploadId}/rerun`, 'POST', { forceOcr });
    activeJobs.set(res.jobId, { uploadId });
    document.getElementById('jobsCard').hidden = false;
    startPolling();
    toast('Neuauswertung gestartet', '', 'success');
  } catch (err) {
    toastError(err, 'Neuauswertung fehlgeschlagen');
  }
}

function confirmRerun() {
  return new Promise((resolve) => {
    import('../core.js').then(({ modal, el: e }) => {
      const check = e('input', { type: 'checkbox' });
      modal({
        title: 'Bericht erneut auswerten',
        subtitle: 'Die bisherige Extraktion wird durch das neue Ergebnis ersetzt. '
          + 'Bereits übernommene Werte im Datenbestand bleiben unverändert.',
        content: e('label', { class: 'chip' }, check,
          e('span', { class: 'label-text' }, 'OCR erzwingen, auch wenn Text vorhanden ist')),
        confirmText: 'Auswertung starten',
      }).then((ok) => resolve(ok ? check.checked : null));
    });
  });
}

async function remove(upload) {
  const ok = await confirmDialog('Bericht löschen?',
    `„${upload.dateiname}“ wird samt Extraktion entfernt. Bereits in den Datenbestand `
    + 'übernommene Kennzahlen bleiben erhalten.');
  if (!ok) return;
  try {
    await api(`/api/uploads/${upload.id}`, { method: 'DELETE' });
    toast('Bericht gelöscht', upload.dateiname, 'success');
    if (selectedUpload === upload.id) {
      selectedUpload = null;
      document.getElementById('reviewCard').hidden = true;
    }
    await refresh();
  } catch (err) {
    toastError(err, 'Löschen fehlgeschlagen');
  }
}

/* --------------------------------------------------------- Prüfdialog */
async function openReview(uploadId) {
  try {
    detail = await api(`/api/uploads/${uploadId}`);
    selectedUpload = uploadId;
    activePage = null;
    renderList();
    renderReview();
    document.getElementById('reviewCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toastError(err, 'Extraktion konnte nicht geladen werden');
  }
}

function renderReview() {
  const host = document.getElementById('reviewCard');
  host.hidden = false;
  clear(host);

  const ex = detail.extraktion;
  if (!ex) {
    host.append(emptyState('Keine Extraktion vorhanden',
      'Starten Sie die Auswertung für diesen Bericht.'));
    return;
  }

  host.append(el('div', { class: 'card-head' },
    el('div', {},
      el('h2', {}, `Extraktion prüfen – ${detail.dateiname}`),
      el('p', { class: 'card-desc' },
        'Links die erkannten Kennzahlen, rechts der zugrunde liegende Seitentext. '
        + 'Jeden Wert prüfen, bei Bedarf korrigieren und die Übernahme abwählen, '
        + 'wo Sie unsicher sind. Nichts wird ohne Ihre Bestätigung gespeichert.')),
    el('div', { class: 'btn-row' },
      el('button', {
        class: 'btn sm ghost',
        onClick: () => { host.hidden = true; selectedUpload = null; renderList(); },
      }, 'Schliessen'))));

  host.append(summaryStrip());

  const grid = el('div', { class: 'review-grid' });
  grid.append(reviewLeft(), reviewRight());
  host.append(grid);
}

function summaryStrip() {
  const ex = detail.extraktion;
  const analyse = detail.analyse || {};
  const tiles = el('div', { class: 'tiles', style: { marginBottom: '16px' } });

  const items = [
    { label: 'Erkannte Bank', value: ex.bankname || '–', sub: ex.basis || '' },
    { label: 'Seiten ausgewertet',
      value: String((detail.analyse?.ausgewaehlteSeiten || []).length),
      sub: `von ${analyse.seitenGesamt || '?'} Seiten insgesamt` },
    { label: 'OCR eingesetzt',
      value: detail.ocrSeiten?.length ? `${detail.ocrSeiten.length} Seiten` : 'nein',
      sub: analyse.istScan ? 'Dokument ist ein Scan' : 'Textebene vorhanden' },
    { label: 'Gefundene Werte',
      value: String(detail.gefundeneWerte ?? 0),
      sub: `Modell: ${detail.modell || '–'}` },
  ];
  if (ex.einheitHinweis) {
    items.push({ label: 'Einheit laut Bericht', value: '', sub: ex.einheitHinweis });
  }

  items.forEach((t) => {
    tiles.append(el('div', { class: 'tile' },
      el('div', { class: 'tlabel' }, t.label),
      t.value ? el('div', { class: 'tvalue', style: { fontSize: '1.02rem' } }, t.value) : null,
      t.sub ? el('div', { class: 'tsub' }, t.sub) : null));
  });

  const wrap = el('div', {}, tiles);

  const warnungen = [];
  Object.entries(ex.jahre || {}).forEach(([jahr, felder]) => {
    Object.entries(felder).forEach(([key, entry]) => {
      if (entry.warnung) warnungen.push({ jahr, key, text: entry.warnung });
    });
  });
  if (warnungen.length) {
    const box = el('div', {
      class: 'card',
      style: { borderColor: 'var(--warning)', background: 'var(--warning-bg)',
        marginBottom: '14px', boxShadow: 'none' },
    });
    box.append(
      el('h2', { style: { fontSize: '0.92rem' } },
        el('span', { class: 'badge warning' }, '⚠'),
        ` ${warnungen.length} Werte sollten Sie prüfen`),
      el('p', { class: 'card-desc', style: { marginBottom: '8px' } },
        'Diese Werte sind rechnerisch auffällig. Der häufigste Grund ist eine '
        + 'verwechselte Einheit, etwa Tausend statt Millionen. Die Werte wurden '
        + 'nicht verändert, nur markiert.'));
    const ul = el('ul', { class: 'mini-list' });
    warnungen.forEach((w) => {
      ul.append(el('li', {},
        el('strong', {}, `${kpiDef(w.key)?.label || w.key} (${w.jahr}): `), w.text));
    });
    box.append(ul);
    wrap.append(box);
  }

  if (ex.besonderheiten?.length) {
    const box = el('details', { style: { marginBottom: '14px' } });
    box.append(el('summary', {
      style: { cursor: 'pointer', fontSize: '0.84rem', color: 'var(--serious)',
        fontWeight: '600' },
    }, `${ex.besonderheiten.length} Hinweise des Modells zum Bericht`));
    const ul = el('ul', { class: 'mini-list', style: { marginTop: '8px' } });
    ex.besonderheiten.forEach((b) => ul.append(el('li', {}, b)));
    box.append(ul);
    wrap.append(box);
  }
  return wrap;
}

/* Linke Spalte: Wertetabelle je Jahr */
function reviewLeft() {
  const ex = detail.extraktion;
  const left = el('div');

  const bankSelect = el('select', { id: 'revBank' },
    el('option', { value: '' }, '— Bank wählen —'),
    ...state.boot.banken.map((b) => el('option', {
      value: b.id,
      selected: b.id === detail.bankId
        || (!detail.bankId && b.name.toLowerCase() === (ex.bankname || '').toLowerCase()),
    }, b.name)),
    el('option', { value: '__neu__' }, '+ Neue Bank anlegen'));

  const newBankInput = el('input', {
    type: 'text', id: 'revNewBank', value: ex.bankname || '',
    placeholder: 'Name der neuen Bank', hidden: true,
  });
  bankSelect.addEventListener('change', () => {
    newBankInput.hidden = bankSelect.value !== '__neu__';
  });
  if (bankSelect.value === '__neu__') newBankInput.hidden = false;

  left.append(el('div', { class: 'upload-form', style: { marginTop: 0, marginBottom: '14px' } },
    el('label', { class: 'field', style: { margin: 0 } },
      el('span', {}, 'Werte übernehmen in'), bankSelect),
    el('label', { class: 'field', style: { margin: 0 } },
      el('span', {}, 'Name der neuen Bank'), newBankInput)));

  const jahre = Object.keys(ex.jahre || {}).sort().reverse();
  if (!jahre.length) {
    left.append(emptyState('Keine Kennzahlen erkannt',
      'Das Modell konnte im Bericht keine der gesuchten Kennzahlen belegen. '
      + 'Versuchen Sie es mit erzwungener OCR oder einem anderen Modell.'));
    return left;
  }

  jahre.forEach((jahr) => {
    const felder = ex.jahre[jahr];
    const eintraege = Object.entries(felder)
      .sort((a, b) => {
        const da = kpiDef(a[0]); const db = kpiDef(b[0]);
        const ka = state.boot.berichteteKpis.indexOf(a[0]);
        const kb = state.boot.berichteteKpis.indexOf(b[0]);
        return ka - kb;
      });
    const mitWert = eintraege.filter(([, v]) => v.value !== null);
    const gewarnt = eintraege.filter(([, v]) => v.warnung);

    const section = el('div', { style: { marginBottom: '22px' } });
    section.append(el('div', { class: 'flex-between', style: { marginBottom: '8px' } },
      el('h3', { style: { fontSize: '0.9rem', margin: 0 } },
        `Berichtsjahr ${jahr}`,
        el('span', { class: 'badge neutral', style: { marginLeft: '8px' } },
          `${mitWert.length} Werte`),
        gewarnt.length
          ? el('span', { class: 'badge warning', style: { marginLeft: '6px' } },
            `${gewarnt.length} zu prüfen`)
          : null),
      el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn sm ghost',
          onClick: () => toggleAll(jahr, true),
        }, 'Alle wählen'),
        el('button', {
          class: 'btn sm ghost',
          onClick: () => toggleAll(jahr, false),
        }, 'Keine'))));

    const table = el('table', { class: 'review-table', dataset: { jahr } });
    table.append(el('thead', {}, el('tr', {},
      el('th', { style: { width: '32px' } }, '✓'),
      el('th', {}, 'Kennzahl'),
      el('th', { style: { textAlign: 'right' } }, 'Wert'),
      el('th', { style: { width: '54px' } }, 'Seite'),
      el('th', {}, 'Beleg im Bericht'))));

    const tbody = el('tbody');
    eintraege.forEach(([key, entry]) => {
      const def = kpiDef(key);
      if (!def) return;
      const hasValue = entry.value !== null && entry.value !== undefined;

      const check = el('input', {
        type: 'checkbox', checked: hasValue, dataset: { kpi: key },
      });
      const input = el('input', {
        type: 'text', value: hasValue ? fmt(entry.value) : '',
        placeholder: 'n/a', dataset: { kpi: key, original: hasValue ? entry.value : '' },
      });

      const tr = el('tr', {
        class: `${hasValue ? '' : 'off'}${entry.warnung ? ' warned' : ''}`,
      });
      input.addEventListener('input', () => {
        const parsed = parseNumberInput(input.value);
        const changed = String(parsed ?? '') !== String(entry.value ?? '');
        tr.classList.toggle('changed', changed);
        if (parsed !== null) { check.checked = true; tr.classList.remove('off'); }
      });
      check.addEventListener('change', () => tr.classList.toggle('off', !check.checked));

      tr.append(
        el('td', {}, check),
        el('td', { class: 'kpi-name' },
          def.label,
          el('span', { class: 'muted', style: { fontSize: '0.72rem', display: 'block' } },
            def.unit)),
        el('td', { style: { width: '128px' } }, input),
        el('td', { class: 'num muted' },
          entry.seite
            ? el('button', {
              class: 'btn sm ghost', style: { padding: '2px 6px' },
              onClick: () => showPage(entry.seite, entry.beleg),
            }, String(entry.seite))
            : '–'),
        el('td', { class: 'beleg' },
          entry.confidence !== null && entry.confidence !== undefined
            ? el('span', {
              class: `conf-dot ${confidenceClass(entry.confidence)}`,
              title: `Konfidenz ${Math.round(entry.confidence * 100)} %`,
            }) : null,
          entry.beleg || entry.hinweis || '–',
          entry.warnung
            ? el('div', { class: 'beleg-warn' },
              el('span', { class: 'badge warning' }, '⚠ Prüfen'), ' ', entry.warnung)
            : null),
      );
      tbody.append(tr);
    });
    table.append(tbody);
    section.append(el('div', { style: { overflowX: 'auto' } }, table));
    left.append(section);
  });

  if (ex.nichtGefunden?.length) {
    const box = el('details', { style: { marginBottom: '14px' } });
    box.append(el('summary', {
      style: { cursor: 'pointer', fontSize: '0.82rem', color: 'var(--text-secondary)' },
    }, `${ex.nichtGefunden.length} Kennzahlen laut Modell nicht im Bericht enthalten`));
    box.append(el('div', { class: 'small muted', style: { marginTop: '8px', lineHeight: '1.6' } },
      ex.nichtGefunden.join(' · ')));
    left.append(box);
  }

  const leereOption = el('input', { type: 'checkbox', id: 'revLeere' });
  left.append(el('div', { class: 'sticky-actions' },
    el('button', { class: 'btn primary', onClick: applyReview }, 'Ausgewählte Werte übernehmen'),
    el('label', { class: 'chip' }, leereOption,
      el('span', { class: 'label-text' }, 'Leere Felder als „nicht ausgewiesen“ speichern')),
    el('span', { class: 'small muted grow right' },
      'Übernommene Werte erscheinen sofort in Dashboard und Vergleich.')));

  return left;
}

function toggleAll(jahr, value) {
  const table = document.querySelector(`.review-table[data-jahr="${jahr}"]`);
  if (!table) return;
  table.querySelectorAll('tbody tr').forEach((tr) => {
    const check = tr.querySelector('input[type="checkbox"]');
    const input = tr.querySelector('input[type="text"]');
    if (!check) return;
    check.checked = value && (input.value.trim() !== '');
    tr.classList.toggle('off', !check.checked);
  });
}

/* Rechte Spalte: Seitentext */
function reviewRight() {
  const right = el('div');
  const seiten = Object.keys(detail.seitenText || {})
    .map(Number).sort((a, b) => a - b);

  right.append(el('h3', { style: { fontSize: '0.9rem', margin: '0 0 4px' } },
    'Ausgelesener Seitentext'),
    el('p', { class: 'small muted', style: { margin: '0 0 10px' } },
      'Genau dieser Text wurde analysiert. Seiten mit ◍ stammen aus der OCR.'));

  if (!seiten.length) {
    right.append(emptyState('Kein Text vorhanden', 'Die Auswertung lieferte keinen Seitentext.'));
    return right;
  }

  const tabs = el('div', { class: 'page-tabs' });
  const textBox = el('pre', { class: 'ocr-text', id: 'ocrTextBox' });

  const show = (nr, highlight) => {
    activePage = nr;
    tabs.querySelectorAll('.page-tab').forEach((t) => {
      t.classList.toggle('active', Number(t.dataset.seite) === nr);
    });
    const text = detail.seitenText[nr] || detail.seitenText[String(nr)] || '';
    if (highlight) {
      const needle = String(highlight).trim().slice(0, 60);
      const idx = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
      if (idx >= 0) {
        textBox.innerHTML = escapeHtml(text.slice(0, idx))
          + `<mark>${escapeHtml(text.slice(idx, idx + needle.length))}</mark>`
          + escapeHtml(text.slice(idx + needle.length));
        setTimeout(() => {
          const mark = textBox.querySelector('mark');
          if (mark) mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 40);
        return;
      }
    }
    textBox.textContent = text;
    textBox.scrollTop = 0;
  };

  seiten.forEach((nr) => {
    const isOcr = (detail.ocrSeiten || []).includes(nr);
    tabs.append(el('button', {
      class: `page-tab${isOcr ? ' ocr' : ''}`,
      dataset: { seite: nr },
      title: isOcr ? 'Per OCR gelesen' : 'Aus der Textebene gelesen',
      onClick: () => show(nr, null),
    }, String(nr)));
  });

  right.append(tabs, textBox);
  right.append(el('div', { class: 'btn-row', style: { marginTop: '10px' } },
    el('button', {
      class: 'btn sm ghost',
      onClick: () => download(`/api/uploads/${detail.id}/file`),
    }, 'Original-PDF öffnen'),
    el('span', { class: 'small muted' },
      `${(detail.textZeichen || 0).toLocaleString('de-CH')} Zeichen ausgewertet`)));

  show(seiten[0], null);
  window.__showPage = show;
  return right;
}

function showPage(nr, beleg) {
  if (window.__showPage) window.__showPage(Number(nr), beleg);
}

/* ------------------------------------------------------- Übernahme */
async function applyReview() {
  const bankSelect = document.getElementById('revBank');
  const newBank = document.getElementById('revNewBank');
  const leere = document.getElementById('revLeere')?.checked;

  const bankId = bankSelect?.value;
  if (!bankId) {
    toast('Zielbank fehlt', 'Wählen Sie, in welche Bank die Werte übernommen werden.', 'warn');
    bankSelect?.focus();
    return;
  }
  if (bankId === '__neu__' && !newBank?.value.trim()) {
    toast('Name fehlt', 'Geben Sie einen Namen für die neue Bank an.', 'warn');
    newBank?.focus();
    return;
  }

  const werte = {};
  let anzahl = 0;
  document.querySelectorAll('.review-table').forEach((table) => {
    const jahr = table.dataset.jahr;
    const felder = {};
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const check = tr.querySelector('input[type="checkbox"]');
      const input = tr.querySelector('input[type="text"]');
      if (!check?.checked) return;
      const key = check.dataset.kpi;
      const value = parseNumberInput(input.value);
      if (value === null && !leere) return;
      const original = detail.extraktion.jahre[jahr]?.[key] || {};
      const korrigiert = value !== null && value !== original.value;
      felder[key] = {
        value,
        seite: original.seite,
        beleg: korrigiert
          ? `${original.beleg || ''}${original.beleg ? ' · ' : ''}manuell korrigiert`
          : original.beleg,
        confidence: korrigiert ? 1.0 : original.confidence,
      };
      anzahl++;
    });
    if (Object.keys(felder).length) werte[jahr] = felder;
  });

  if (!anzahl) {
    toast('Nichts ausgewählt', 'Wählen Sie mindestens einen Wert zur Übernahme.', 'warn');
    return;
  }

  try {
    const payload = { werte, leereUebernehmen: !!leere };
    if (bankId === '__neu__') payload.neueBank = newBank.value.trim();
    else payload.bankId = bankId;

    const res = await apiJson(`/api/uploads/${detail.id}/apply`, 'POST', payload);
    toast('Werte übernommen',
      `${res.uebernommen} Kennzahlen für ${res.bankName} (${res.jahre.join(', ')}).`,
      'success');
    window.dispatchEvent(new CustomEvent('data-changed'));
    await refresh();
    await openReview(detail.id);
  } catch (err) {
    toastError(err, 'Übernahme fehlgeschlagen');
  }
}
