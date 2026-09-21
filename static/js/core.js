/* Kernfunktionen: Zustand, API-Zugriff, Formatierung, DOM-Helfer, Toasts. */

export const state = {
  boot: null,
  kpi: 'bilanzsumme',
  year: null,
  hidden: new Set(),
  showDerived: true,
  compareSort: { col: 'name', dir: 'asc' },
  activeView: 'dashboard',
  scatterX: 'aumProFte',
  scatterY: 'cirBerechnet',
};

/* ---------------------------------------------------------------- API */
let pending = 0;
const bar = () => document.getElementById('loadingBar');

function startLoad() {
  pending++;
  const b = bar();
  if (b) { b.classList.add('on'); b.style.width = '35%'; }
}
function endLoad() {
  pending = Math.max(0, pending - 1);
  const b = bar();
  if (!b) return;
  if (pending === 0) {
    b.style.width = '100%';
    setTimeout(() => { b.classList.remove('on'); b.style.width = '0'; }, 280);
  }
}

export async function api(path, options = {}) {
  const { quiet = false, ...opts } = options;
  if (!quiet) startLoad();
  try {
    const res = await fetch(path, opts);
    const type = res.headers.get('content-type') || '';
    if (!type.includes('application/json')) {
      if (!res.ok) throw new Error(`Serverfehler ${res.status}`);
      return res;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.fehler || `Serverfehler ${res.status}`);
    return data;
  } finally {
    if (!quiet) endLoad();
  }
}

export const apiGet = (p, o) => api(p, o);
export const apiJson = (p, method, bodyObj, o = {}) => api(p, {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(bodyObj || {}),
  ...o,
});

/* Erzeugt den Query-String für die aktuelle Auswahl. */
export function query(extra = {}) {
  const params = new URLSearchParams();
  const ids = visibleBankIds();
  if (ids.length && ids.length !== (state.boot?.banken.length || 0)) {
    params.set('banks', ids.join(','));
  }
  if (state.year) params.set('year', state.year);
  params.set('derived', state.showDerived ? '1' : '0');
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null) params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function visibleBankIds() {
  const banks = state.boot?.banken || [];
  return banks.filter((b) => b.istZielbank || !state.hidden.has(b.id)).map((b) => b.id);
}

export function bankById(id) {
  return (state.boot?.banken || []).find((b) => b.id === id) || null;
}

export function targetBank() {
  return (state.boot?.banken || []).find((b) => b.istZielbank) || null;
}

export function kpiDef(key) {
  return state.boot?.kpiDefinitionen?.[key] || null;
}

export function kpiKeys() {
  const rep = state.boot?.berichteteKpis || [];
  const der = state.showDerived ? (state.boot?.abgeleiteteKpis || []) : [];
  return [...rep, ...der];
}

/* ------------------------------------------------------- Formatierung */
export function fmt(value, decimals) {
  if (value === null || value === undefined || typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }
  const abs = Math.abs(value);
  const d = decimals !== undefined ? decimals
    : abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  return value.toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtWithUnit(value, unit, decimals) {
  if (value === null || value === undefined || typeof value !== 'number') return 'n/a';
  return `${fmt(value, decimals)}${unit ? ` ${unitShort(unit)}` : ''}`;
}

export function unitShort(unit) {
  if (!unit) return '';
  if (unit === 'CHF Mio.') return 'Mio.';
  if (unit === 'CHF Mio./FTE') return 'Mio./FTE';
  if (unit === 'Basispunkte') return 'bp';
  return unit;
}

export function fmtPct(value, withSign = true) {
  if (value === null || value === undefined || typeof value !== 'number') return 'n/a';
  const sign = withSign && value >= 0 ? '+' : '';
  return `${sign}${fmt(value, Math.abs(value) >= 10 ? 0 : 1)} %`;
}

/* Bei extremen Abweichungen ist ein Vielfaches lesbarer als eine
   vierstellige Prozentzahl. */
export function fmtAbweichung(pct, faktor) {
  if (typeof faktor === 'number' && Number.isFinite(faktor)) {
    return faktor >= 1
      ? `Faktor ${fmt(faktor, 1)}×`
      : `Faktor ${fmt(1 / faktor, 1)}× kleiner`;
  }
  return fmtPct(pct);
}

export function fmtBytes(bytes) {
  if (!bytes) return '–';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('de-CH', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function relTime(iso) {
  if (!iso) return '–';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (Number.isNaN(diff)) return '–';
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  if (diff < 604800) return `vor ${Math.floor(diff / 86400)} Tg.`;
  return fmtDate(iso);
}

const NUM_TOKEN = /\d[\d'’.,   ]*\d|\d/;

/* Versteht 1'234.5, 1.234,5, (123), "12,3 %" und "CHF 28.7 Mio." */
export function parseNumberInput(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text || ['n/a', 'na', '-', '–', '—', 'k.a.'].includes(text.toLowerCase())) return null;

  const negative = (text.startsWith('(') && text.endsWith(')')) || /^\s*[-−]/.test(text);
  const match = NUM_TOKEN.exec(text);
  if (!match) return null;

  let core = match[0].replace(/['’   ]/g, '');
  if (core.includes(',') && core.includes('.')) {
    core = core.lastIndexOf(',') > core.lastIndexOf('.')
      ? core.replace(/\./g, '').replace(',', '.')
      : core.replace(/,/g, '');
  } else if (core.includes(',')) {
    const parts = core.split(',');
    core = (parts.length > 2 || parts[parts.length - 1].length === 3)
      ? core.replace(/,/g, '') : core.replace(',', '.');
  } else if ((core.match(/\./g) || []).length > 1) {
    core = core.replace(/\./g, '');
  }
  core = core.replace(/^\.+|\.+$/g, '');

  const n = Number.parseFloat(core);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

/* ------------------------------------------------------------ DOM */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat(3)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function emptyState(title, body) {
  return el('div', { class: 'empty-state' },
    el('strong', { text: title }),
    body ? el('div', { text: body }) : null);
}

/* --------------------------------------------------------- Tooltip */
let tipEl = null;
export function tooltip() {
  if (!tipEl) tipEl = document.getElementById('tooltip');
  return tipEl;
}

export function showTip(html, x, y) {
  const t = tooltip();
  if (!t) return;
  t.innerHTML = html;
  t.style.display = 'block';
  const { offsetWidth: w, offsetHeight: h } = t;
  let left = x + 15;
  let top = y + 15;
  if (left + w > window.innerWidth - 12) left = Math.max(8, x - w - 15);
  if (top + h > window.innerHeight - 12) top = Math.max(8, y - h - 15);
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
}

export function hideTip() {
  const t = tooltip();
  if (t) t.style.display = 'none';
}

export function attachTip(node, builder) {
  node.addEventListener('mousemove', (e) => showTip(builder(), e.clientX, e.clientY));
  node.addEventListener('mouseleave', hideTip);
}

/* ---------------------------------------------------------- Toasts */
export function toast(title, body = '', kind = 'info', ms = 4800) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = el('div', { class: `toast ${kind}` },
    el('div', { class: 't-title', text: title }),
    body ? el('div', { class: 't-body', text: body }) : null);
  host.append(node);
  const remove = () => {
    node.style.opacity = '0';
    node.style.transform = 'translateX(16px)';
    node.style.transition = 'all .2s';
    setTimeout(() => node.remove(), 220);
  };
  node.addEventListener('click', remove);
  setTimeout(remove, ms);
}

export const toastError = (err, context = 'Fehler') =>
  toast(context, err?.message || String(err), 'error', 8000);

/* ----------------------------------------------------------- Modal */
export function modal({ title, subtitle, content, confirmText = 'Bestätigen',
  cancelText = 'Abbrechen', onConfirm, danger = false, wide = false }) {
  return new Promise((resolve) => {
    const backdrop = el('div', { class: 'modal-backdrop' });
    const box = el('div', { class: 'modal' });
    if (wide) box.style.maxWidth = '820px';

    const close = (value) => { backdrop.remove(); resolve(value); };

    box.append(
      el('h3', { text: title }),
      subtitle ? el('p', { class: 'sub', text: subtitle }) : null,
      content || null,
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn', onClick: () => close(null) }, cancelText),
        el('button', {
          class: `btn ${danger ? 'danger' : 'primary'}`,
          onClick: async () => {
            const result = onConfirm ? await onConfirm(box) : true;
            if (result !== false) close(result ?? true);
          },
        }, confirmText)),
    );
    backdrop.append(box);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(null); }
    });
    document.body.append(backdrop);
    const firstInput = box.querySelector('input, select, textarea');
    if (firstInput) firstInput.focus();
  });
}

export const confirmDialog = (title, subtitle, confirmText = 'Löschen') =>
  modal({ title, subtitle, confirmText, danger: true });

/* ------------------------------------------------------ Sonstiges */
export function download(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}

export function debounce(fn, ms = 250) {
  let handle;
  return (...args) => { clearTimeout(handle); handle = setTimeout(() => fn(...args), ms); };
}

export function confidenceClass(c) {
  if (c === null || c === undefined) return '';
  if (c >= 0.85) return 'conf-hoch';
  if (c >= 0.6) return 'conf-mittel';
  return 'conf-niedrig';
}

export function herkunftLabel(h) {
  return {
    bericht: 'Geschäftsbericht', extrahiert: 'OCR-Extraktion', manuell: 'manuell erfasst',
    berechnet: 'berechnet', leer: 'kein Wert',
  }[h] || h || '–';
}
