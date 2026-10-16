import { renderAppItem, renderDockItem, renderDrawerItem, renderWidgetItem, renderCatalogItem, el } from './components.js';

const fallbackApi = {
  open(/** @type {string} */ id) {},
  home() {},
  back() {},
  close() {},
  refreshCatalog() {},
  install(/** @type {string} */ id) {},
  rollback(/** @type {string} */ id) {},
  dismissInstall() {},
  uninstall(/** @type {string} */ id) {},
  widgetAction(/** @type {string} */ appId, /** @type {string} */ widgetId, /** @type {string} */ actionId) {},
  onState(/** @type {(s: any) => void} */ fn) {},
};

const api = /** @type {any} */ (window).host ?? fallbackApi;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {any} */
let currentState = null;
let searchQuery = '';
let drawerCategory = 'all';
let drawerQuery = '';

/** @param {any} state */
function render(state) {
  currentState = state;
  const isHome = state.active === null;
  const title = $('title');
  if (title) title.textContent = state.title || state.product;

  const dashboard = $('dashboard');
  if (dashboard) dashboard.hidden = !isHome;

  const back = $('back');
  if (back) back.hidden = isHome;
  const home = $('home');
  if (home) home.hidden = isHome;
  const close = $('close');
  if (close) close.hidden = isHome;

  if (isHome) {
    renderApps(state, searchQuery);
    renderWidgets(state, searchQuery);
    renderCatalog(state);
    renderDock(state);
    renderDrawer(state, drawerCategory, drawerQuery);
    renderConfirm(state);
  }
}

/**
 * @param {any} state
 * @param {string} query
 */
function renderApps(state, query) {
  const ul = $('apps');
  const countBadge = $('apps-count');
  if (!ul) return;

  const q = query.trim().toLowerCase();
  const filtered = (state.apps ?? []).filter((/** @type {any} */ a) =>
    !q || a.title.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)
  );

  if (countBadge) countBadge.textContent = String(filtered.length);
  ul.replaceChildren(...filtered.map((/** @type {any} */ a) => renderAppItem(a)));
}

/**
 * @param {any} state
 * @param {string} query
 */
function renderWidgets(state, query) {
  const container = $('widgets');
  const empty = $('no-widgets');
  if (!container) return;

  const q = query.trim().toLowerCase();
  const widgets = (state.widgets ?? []).filter((/** @type {any} */ w) =>
    !q || w.title.toLowerCase().includes(q) || w.appId.toLowerCase().includes(q)
  );

  if (empty) empty.hidden = widgets.length > 0;
  container.replaceChildren(...widgets.map((/** @type {any} */ w) => renderWidgetItem(w)));
}

/** @param {any} state */
function renderCatalog(state) {
  const ul = $('catalog');
  const empty = $('no-catalog');
  const err = $('manager-error');
  if (!ul) return;

  const m = state.manager ?? {};
  if (err) {
    err.hidden = !m.actionError;
    err.textContent = m.actionError ?? '';
  }

  const rows = m.rows ?? [];
  if (empty) empty.hidden = rows.length > 0;
  ul.replaceChildren(...rows.map((/** @type {any} */ r) => renderCatalogItem(r)));
}

/** @param {any} state */
function renderDock(state) {
  const dock = $('dock');
  if (!dock) return;
  const apps = state.apps ?? [];
  dock.replaceChildren(...apps.slice(0, 6).map((/** @type {any} */ a) => renderDockItem(a)));
}

/**
 * @param {any} state
 * @param {string} cat
 * @param {string} query
 */
function renderDrawer(state, cat, query) {
  const grid = $('drawer-apps');
  if (!grid) return;

  const q = query.trim().toLowerCase();
  const filtered = (state.apps ?? []).filter((/** @type {any} */ a) => {
    const matchCat = cat === 'all' || (a.categories && a.categories.includes(cat));
    const matchQuery = !q || a.title.toLowerCase().includes(q) || a.id.toLowerCase().includes(q);
    return matchCat && matchQuery;
  });

  grid.replaceChildren(...filtered.map((/** @type {any} */ a) => renderDrawerItem(a)));
}

/** @param {any} state */
function renderConfirm(state) {
  const panel = $('install-confirm');
  if (!panel) return;
  const pkg = state.manager?.pendingInstall;
  panel.hidden = !pkg;
  if (!pkg) return;

  const title = $('install-title');
  const detail = $('install-detail');
  const source = $('install-source');
  const capsList = $('install-caps-list');

  if (title) title.textContent = `Install ${pkg.title}?`;
  if (detail) detail.textContent = `Version ${pkg.version} by ${pkg.publisher}`;
  if (source) source.textContent = pkg.source;

  if (capsList) {
    const caps = pkg.manifest?.capabilities ?? {};
    const pills = [];
    if (caps.network) pills.push(`Network: ${caps.network.join(', ')}`);
    if (caps.secrets) pills.push(`Secrets: ${caps.secrets.join(', ')}`);
    if (caps.notifications) pills.push('Notifications');
    if (caps.identity) pills.push('Identity');
    if (caps.iac) pills.push('Inter-App Messaging');
    capsList.replaceChildren(...pills.map((c) => el('span', { class: 'cap-pill' }, [c])));
  }
}

function updateClock() {
  const timeEl = $('glance-time');
  const dateEl = $('glance-date');
  const now = new Date();
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }
}

function wireEvents() {
  $('back')?.addEventListener('click', () => api.back());
  $('home')?.addEventListener('click', () => api.home());
  $('close')?.addEventListener('click', () => api.close());
  $('refresh')?.addEventListener('click', () => api.refreshCatalog());

  $('apps')?.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest('button[data-id]');
    if (btn) {
      const id = btn.getAttribute('data-id');
      if (id) api.open(id);
    }
  });

  $('dock')?.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest('button[data-id]');
    if (btn) {
      const id = btn.getAttribute('data-id');
      if (id) api.open(id);
    }
  });

  $('drawer-apps')?.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest('button[data-id]');
    if (btn) {
      const id = btn.getAttribute('data-id');
      if (id) {
        api.open(id);
        const drawer = $('app-drawer');
        if (drawer) drawer.hidden = true;
      }
    }
  });

  $('widgets')?.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest('button[data-action="widget"]');
    if (btn) {
      const appId = btn.getAttribute('data-app-id');
      const widgetId = btn.getAttribute('data-widget-id');
      const actionId = btn.getAttribute('data-action-id');
      if (appId && widgetId && actionId) api.widgetAction(appId, widgetId, actionId);
    }
  });

  $('catalog')?.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest('button[data-action]');
    if (btn) {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (!id) return;
      if (action === 'install') api.install(id);
      else if (action === 'rollback') api.rollback(id);
      else if (action === 'uninstall') api.uninstall(id);
    }
  });

  $('search-input')?.addEventListener('input', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    searchQuery = input.value;
    const clearBtn = $('search-clear');
    if (clearBtn) clearBtn.hidden = !searchQuery;
    if (currentState) {
      renderApps(currentState, searchQuery);
      renderWidgets(currentState, searchQuery);
    }
  });

  $('search-clear')?.addEventListener('click', () => {
    const input = /** @type {HTMLInputElement} */ ($('search-input'));
    if (input) input.value = '';
    searchQuery = '';
    const clearBtn = $('search-clear');
    if (clearBtn) clearBtn.hidden = true;
    if (currentState) {
      renderApps(currentState, '');
      renderWidgets(currentState, '');
    }
  });

  const toggleDrawer = () => {
    const drawer = $('app-drawer');
    if (!drawer) return;
    drawer.hidden = !drawer.hidden;
    if (!drawer.hidden) {
      $('drawer-search-input')?.focus();
      if (currentState) renderDrawer(currentState, drawerCategory, drawerQuery);
    }
  };

  $('btn-open-drawer')?.addEventListener('click', toggleDrawer);
  $('gesture-pill')?.addEventListener('click', toggleDrawer);
  $('drawer-close-btn')?.addEventListener('click', toggleDrawer);
  $('drawer-handle')?.addEventListener('click', toggleDrawer);

  $('drawer-search-input')?.addEventListener('input', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    drawerQuery = input.value;
    if (currentState) renderDrawer(currentState, drawerCategory, drawerQuery);
  });

  document.querySelectorAll('.cat-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.cat-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      drawerCategory = pill.getAttribute('data-cat') || 'all';
      if (currentState) renderDrawer(currentState, drawerCategory, drawerQuery);
    });
  });

  $('install-yes')?.addEventListener('click', () => {
    if (currentState?.manager?.pendingInstall?.id) {
      api.install(currentState.manager.pendingInstall.id);
    }
  });
  $('install-no')?.addEventListener('click', () => api.dismissInstall());

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const drawer = $('app-drawer');
      if (drawer && !drawer.hidden) {
        drawer.hidden = true;
        return;
      }
      if (currentState && currentState.active !== null) {
        api.back();
      }
    } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault();
      $('search-input')?.focus();
    }
  });
}

updateClock();
setInterval(updateClock, 1000);
wireEvents();
api.onState(render);
