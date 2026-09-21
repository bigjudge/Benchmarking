/* Einstiegspunkt: Bootstrap, Navigation, globale Bankauswahl. */

import {
  state, api, el, clear, toast, toastError, visibleBankIds,
} from './core.js';
import * as dashboard from './views/dashboard.js';
import * as compare from './views/compare.js';
import * as analysis from './views/analysis.js';
import * as reports from './views/reports.js';
import * as dataView from './views/data.js';
import * as settings from './views/settings.js';

const VIEWS = {
  dashboard: { label: 'Dashboard', module: dashboard },
  compare: { label: 'Vergleich', module: compare },
  analysis: { label: 'Analyse', module: analysis },
  reports: { label: 'Berichte', module: reports, badge: 'offeneBerichte' },
  data: { label: 'Datenpflege', module: dataView },
  settings: { label: 'Einstellungen', module: settings },
};

const mounted = new Set();

async function boot() {
  try {
    state.boot = await api('/api/bootstrap');
  } catch (err) {
    document.getElementById('app').replaceChildren(
      el('div', { class: 'card' },
        el('h2', {}, 'Der Server ist nicht erreichbar'),
        el('p', { class: 'card-desc' }, err.message),
        el('button', { class: 'btn primary', onClick: () => window.location.reload() },
          'Erneut versuchen')));
    return;
  }

  if (!state.year || !state.boot.jahre.includes(state.year)) {
    state.year = state.boot.jahre[0] || String(new Date().getFullYear());
  }
  if (!state.boot.kpiDefinitionen[state.kpi]) {
    state.kpi = state.boot.berichteteKpis[0];
  }

  // Erst die URL auswerten, dann den Rahmen bauen – sonst wird die
  // Startansicht zweimal gesetzt und blendet sichtbar um.
  restoreFromUrl();
  renderShell();
  await showView(state.activeView, true);
}

/* ------------------------------------------------------------ Rahmen */
function renderShell() {
  const target = state.boot.banken.find((b) => b.istZielbank);

  const nav = el('nav', { class: 'nav', id: 'nav' });
  Object.entries(VIEWS).forEach(([key, cfg]) => {
    nav.append(el('button', {
      dataset: { view: key },
      class: key === state.activeView ? 'active' : '',
      onClick: () => showView(key),
    }, cfg.label));
  });

  document.getElementById('topbar').replaceChildren(
    el('div', { class: 'topbar-inner' },
      el('div', { class: 'brand' },
        el('div', { class: 'brand-mark' }, 'BM'),
        el('div', { class: 'brand-name' },
          state.boot.meta?.titel || 'Bank-Benchmarking')),
      nav,
      el('div', { class: 'topbar-actions' },
        el('button', {
          class: 'btn sm', id: 'bankFilterBtn',
          onClick: toggleBankPanel,
        }, 'Banken', el('span', { class: 'muted', id: 'bankCount' }, '')),
        el('button', {
          class: 'btn icon-btn ghost', title: 'Darstellung wechseln',
          onClick: toggleTheme,
        }, '◐'))));

  document.getElementById('app').replaceChildren(
    el('section', { class: 'card', id: 'bankPanel', hidden: true }),
    ...Object.keys(VIEWS).map((key) => el('div', {
      class: `view${key === state.activeView ? ' active' : ''}`,
      id: `view-${key}`,
    })),
  );

  renderBankPanel();
  updateBankCount();

  if (target) {
    document.title = `${state.boot.meta?.titel || 'Benchmarking'} – ${target.name}`;
  }
}

/* ------------------------------------------------- Globale Bankauswahl */
function toggleBankPanel() {
  const panel = document.getElementById('bankPanel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderBankPanel();
}

function renderBankPanel() {
  const panel = document.getElementById('bankPanel');
  if (!panel || panel.hidden) return;
  clear(panel);

  const gruppen = {};
  state.boot.banken.forEach((b) => {
    (gruppen[b.gruppe || 'Ohne Zuordnung'] ||= []).push(b);
  });

  panel.append(el('div', { class: 'card-head' },
    el('div', {},
      el('h2', {}, 'Banken im Vergleich'),
      el('p', { class: 'card-desc' },
        'Abgewählte Banken verschwinden aus allen Auswertungen, Rankings und Exporten. '
        + 'Die Zielbank bleibt immer enthalten.')),
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn sm', onClick: () => setAll(true) }, 'Alle'),
      el('button', { class: 'btn sm', onClick: () => setAll(false) }, 'Nur Zielbank'),
      el('button', {
        class: 'btn sm ghost', onClick: () => { document.getElementById('bankPanel').hidden = true; },
      }, 'Schliessen'))));

  Object.entries(gruppen).forEach(([gruppe, banken]) => {
    const row = el('div', { class: 'chip-row', style: { marginBottom: '10px' } });
    banken.forEach((bank) => {
      if (bank.istZielbank) {
        row.append(el('span', { class: 'chip target' },
          el('span', { class: 'swatch' }),
          el('span', { class: 'label-text' }, `${bank.name} · Zielbank`)));
        return;
      }
      const checked = !state.hidden.has(bank.id);
      const input = el('input', {
        type: 'checkbox', checked,
        onChange: (e) => {
          if (e.target.checked) state.hidden.delete(bank.id);
          else state.hidden.add(bank.id);
          if (visibleBankIds().length < 2) {
            toast('Mindestens zwei Banken', 'Ein Vergleich braucht wenigstens eine Peer-Bank.',
              'warn');
          }
          renderBankPanel();
          updateBankCount();
          syncUrl();
          refreshActive();
        },
      });
      row.append(el('label', { class: `chip${checked ? '' : ' off'}` },
        input, el('span', { class: 'swatch' }),
        el('span', { class: 'label-text' }, bank.name)));
    });
    panel.append(
      el('div', {
        class: 'glabel',
        style: { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '.04em',
          color: 'var(--text-muted)', fontWeight: '650', marginBottom: '5px' },
      }, gruppe),
      row);
  });
}

function setAll(visible) {
  state.hidden.clear();
  if (!visible) {
    state.boot.banken.filter((b) => !b.istZielbank).forEach((b) => state.hidden.add(b.id));
  }
  renderBankPanel();
  updateBankCount();
  syncUrl();
  refreshActive();
}

function updateBankCount() {
  const node = document.getElementById('bankCount');
  if (node) node.textContent = ` ${visibleBankIds().length}/${state.boot.banken.length}`;
}

/* ------------------------------------------------------- Navigation */
async function showView(key, initial = false) {
  if (!VIEWS[key]) key = 'dashboard';
  const previous = state.activeView;
  if (previous !== key && VIEWS[previous]?.module.unmount) {
    VIEWS[previous].module.unmount();
  }
  state.activeView = key;

  document.querySelectorAll('#nav button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === key);
  });
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('active', view.id === `view-${key}`);
  });

  const host = document.getElementById(`view-${key}`);
  const module = VIEWS[key].module;
  if (!mounted.has(key)) {
    module.mount(host);
    mounted.add(key);
  }
  await module.refresh();
  syncUrl();
  if (!initial) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function refreshActive() {
  const module = VIEWS[state.activeView]?.module;
  if (module && mounted.has(state.activeView)) module.refresh();
}

/* -------------------------------------------------------------- URL */
function syncUrl() {
  const params = new URLSearchParams();
  params.set('view', state.activeView);
  if (state.activeView !== 'settings') {
    params.set('kpi', state.kpi);
    params.set('year', state.year);
  }
  if (state.hidden.size) params.set('aus', [...state.hidden].join(','));
  const url = `${window.location.pathname}?${params}`;
  window.history.replaceState(null, '', url);
}

function restoreFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view && VIEWS[view]) state.activeView = view;
  const kpi = params.get('kpi');
  if (kpi && state.boot.kpiDefinitionen[kpi]) state.kpi = kpi;
  const year = params.get('year');
  if (year && state.boot.jahre.includes(year)) state.year = year;
  const aus = params.get('aus');
  if (aus) {
    aus.split(',').filter(Boolean).forEach((id) => {
      if (state.boot.banken.some((b) => b.id === id && !b.istZielbank)) state.hidden.add(id);
    });
  }
}

/* ------------------------------------------------------------ Theme */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : current === 'light' ? null : 'dark';
  if (next) document.documentElement.setAttribute('data-theme', next);
  else document.documentElement.removeAttribute('data-theme');
  try {
    if (next) localStorage.setItem('theme', next);
    else localStorage.removeItem('theme');
  } catch { /* Speicher nicht verfügbar – Auswahl gilt für diese Sitzung */ }
  refreshActive();
}

try {
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
} catch { /* ignorieren */ }

/* -------------------------------------------------------- Ereignisse */
window.addEventListener('data-changed', async () => {
  try {
    state.boot = await api('/api/bootstrap', { quiet: true });
    if (!state.boot.jahre.includes(state.year)) state.year = state.boot.jahre[0];
    renderShell();
    mounted.clear();
    await showView(state.activeView, true);
  } catch (err) {
    toastError(err, 'Daten konnten nicht neu geladen werden');
  }
});

window.addEventListener('settings-changed', async () => {
  try {
    state.boot.einstellungen = await api('/api/settings', { quiet: true });
    refreshActive();
  } catch { /* still */ }
});

window.addEventListener('kpi-selected', () => showView('dashboard'));
window.addEventListener('goto-kpi', () => showView('dashboard'));
window.addEventListener('goto-view', (e) => showView(e.detail));

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  const map = { 1: 'dashboard', 2: 'compare', 3: 'analysis', 4: 'reports', 5: 'data', 6: 'settings' };
  if (map[e.key]) { e.preventDefault(); showView(map[e.key]); }
  if (e.key === 'b') { e.preventDefault(); toggleBankPanel(); }
});

boot();
