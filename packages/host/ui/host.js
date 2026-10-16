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

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [children]
 * @returns {HTMLElement}
 */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of children) node.append(child);
  return node;
}

/**
 * @param {string} str
 * @returns {string}
 */
function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash % 360);
  return `linear-gradient(135deg, hsl(${h}, 85%, 60%) 0%, hsl(${(h + 40) % 360}, 80%, 45%) 100%)`;
}

/**
 * @param {any} app
 * @param {'normal' | 'small' | 'dock'} [size]
 * @returns {HTMLElement}
 */
function createAppIcon(app, size = 'normal') {
  const bg = hashColor(app.id || app.title || 'app');
  const className = size === 'small' ? 'cat-icon' : size === 'dock' ? 'dock-icon' : 'app-icon';
  const icon = el('div', { class: className });
  icon.style.setProperty('background', bg);

  if (app.icon && typeof app.icon === 'string' && app.icon.startsWith('<svg')) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(app.icon, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (svg) icon.appendChild(svg);
    else icon.textContent = (app.title || 'A').slice(0, 2).toUpperCase();
  } else {
    const initials = el('span', { class: 'initials' }, [(app.title || 'A').slice(0, 2).toUpperCase()]);
    icon.appendChild(initials);
  }

  if (app.running) {
    icon.appendChild(el('span', { class: 'running-dot', title: 'Running' }));
  }
  return icon;
}

/**
 * @param {any} app
 * @returns {HTMLElement}
 */
function renderAppItem(app) {
  const btn = el('button', { class: 'app-btn', 'data-id': app.id }, [
    createAppIcon(app, 'normal'),
    el('span', { class: 'app-title' }, [app.title]),
  ]);
  return el('li', { class: 'app-item' }, [btn]);
}

/**
 * @param {any} app
 * @returns {HTMLElement}
 */
function renderDockItem(app) {
  return el('button', {
    class: `dock-btn${app.running ? ' running' : ''}`,
    'data-id': app.id,
    title: app.title,
    'aria-label': app.title,
  }, [createAppIcon(app, 'dock')]);
}

/**
 * @param {any} app
 * @returns {HTMLElement}
 */
function renderDrawerItem(app) {
  const btn = el('button', { class: 'drawer-app-btn', 'data-id': app.id }, [
    createAppIcon(app, 'normal'),
    el('span', { class: 'drawer-app-title' }, [app.title]),
  ]);
  return el('li', { class: 'drawer-app-item' }, [btn]);
}

/**
 * @param {any} widget
 * @returns {HTMLElement}
 */
function renderWidgetItem(widget) {
  const card = el('article', { class: 'widget-card' });
  const header = el('header', { class: 'widget-header' }, [
    el('h3', {}, [widget.title]),
  ]);
  card.appendChild(header);

  const d = widget.descriptor ?? {};
  for (const block of d.blocks ?? []) {
    if (block.type === 'metric') {
      const metric = el('div', { class: `widget-metric tone-${block.tone ?? 'neutral'}` }, [
        el('div', { class: 'metric-label' }, [block.label ?? '']),
        el('div', { class: 'metric-value' }, [block.value ?? '']),
      ]);
      card.appendChild(metric);
    } else if (block.type === 'text') {
      card.appendChild(el('p', { class: 'widget-text' }, [block.text ?? '']));
    } else if (block.type === 'list') {
      const items = (block.items ?? []).map((/** @type {any} */ item) =>
        el('li', { class: 'widget-list-item' }, [
          el('span', { class: 'item-title' }, [item.title ?? '']),
          item.subtitle ? el('span', { class: 'item-sub quiet' }, [item.subtitle]) : '',
        ])
      );
      card.appendChild(el('ul', { class: 'widget-list' }, items));
    } else if (block.type === 'actions') {
      const btns = (block.actions ?? []).map((/** @type {any} */ a) =>
        el('button', {
          class: 'widget-action-btn',
          'data-action': 'widget',
          'data-app-id': widget.appId,
          'data-widget-id': widget.widgetId,
          'data-action-id': a.id,
        }, [a.label ?? a.id])
      );
      card.appendChild(el('div', { class: 'widget-actions' }, btns));
    }
  }
  return card;
}

/**
 * @param {any} r
 * @returns {HTMLElement}
 */
function renderCatalogItem(r) {
  const statusText = r.installed
    ? `${r.installed} installed${r.latest && r.latest !== r.installed ? ` · ${r.latest} available` : ''}`
    : r.latest ? `${r.latest} available` : 'No release in this channel';

  const meta = el('div', { class: 'catalog-info' }, [
    el('strong', {}, [r.title]),
    el('span', { class: 'catalog-ver quiet' }, [` · ${r.publisher} · ${statusText}`]),
    r.description ? el('p', { class: 'catalog-desc' }, [r.description]) : '',
  ]);

  const actions = el('div', { class: 'catalog-actions' });
  if (!r.installed && r.latest) {
    actions.appendChild(el('button', {
      class: 'btn-action btn-install primary',
      'data-action': 'install',
      'data-id': r.id,
    }, ['Install']));
  }
  if (r.installed && r.latest && r.latest !== r.installed) {
    actions.appendChild(el('button', {
      class: 'btn-action btn-update primary',
      'data-action': 'install',
      'data-id': r.id,
    }, [`Update to ${r.latest}`]));
  }
  if (r.previous) {
    actions.appendChild(el('button', {
      class: 'btn-action btn-rollback',
      'data-action': 'rollback',
      'data-id': r.id,
    }, [`Roll back to ${r.previous}`]));
  }
  if (r.installed) {
    actions.appendChild(el('button', {
      class: 'btn-action btn-uninstall',
      'data-action': 'uninstall',
      'data-id': r.id,
    }, ['Uninstall']));
  }

  const row = el('li', { class: 'catalog-row' }, [
    createAppIcon(r, 'small'),
    meta,
    actions,
  ]);
  return row;
}

/** @param {any} state */
function render(state) {
  currentState = state;
  const isHome = state.active === null;
  const title = $('title');
  if (title) title.textContent = state.title || state.product;

  document.title = state.product;
  document.body.classList.toggle('app-open', !isHome);

  const back = /** @type {HTMLButtonElement | null} */ ($('back'));
  const close = /** @type {HTMLButtonElement | null} */ ($('close'));
  if (back) back.disabled = isHome;
  if (close) close.disabled = isHome;

  renderApps(state);
  renderDock(state);
  renderDrawer(state, drawerCategory, drawerQuery);
  renderWidgets(state);
  renderCatalog(state);
  renderConfirm(state);
}

/** @param {any} state */
function renderApps(state) {
  const ul = $('apps');
  const count = $('apps-count');
  if (!ul) return;
  const apps = state.apps ?? [];
  if (count) count.textContent = String(apps.length);

  const q = searchQuery.trim().toLowerCase();
  const filtered = apps.filter((/** @type {any} */ a) =>
    !q || a.title.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)
  );

  ul.replaceChildren(...filtered.map((/** @type {any} */ a) => renderAppItem(a)));
}

/** @param {any} state */
function renderWidgets(state) {
  const container = $('widgets');
  const empty = $('no-widgets');
  if (!container) return;
  const widgets = state.widgets ?? [];
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
  const error = m.actionError ?? (m.error ? `Catalog unavailable: ${m.error}` : null);
  if (err) {
    err.hidden = !error;
    err.textContent = error ?? '';
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
  const pendingId = state.manager?.pendingInstall;
  const row = (state.manager?.rows ?? []).find((/** @type {any} */ r) => r.id === pendingId);
  panel.hidden = !row;
  if (!row) return;

  const title = $('install-title');
  const detail = $('install-detail');
  const source = $('install-source');

  if (title) title.textContent = `Install ${row.title}?`;
  if (detail) {
    const desc = row.description ? ` — ${row.description}` : '';
    detail.textContent = `${row.title} ${row.latest} by ${row.publisher}${desc}`;
  }
  if (source) source.textContent = `Source: ${row.repository}`;
}

function updateClock() {
  const time = $('glance-time');
  const date = $('glance-date');
  const now = new Date();
  if (time) {
    time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (date) {
    date.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
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

  $('catalog')?.addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest('button[data-action]');
    if (btn) {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (!id) return;
      for (const b of document.querySelectorAll('#catalog button')) /** @type {HTMLButtonElement} */ (b).disabled = true;
      try {
        if (action === 'install') await api.install(id);
        else if (action === 'rollback') await api.rollback(id);
        else if (action === 'uninstall') await api.uninstall(id);
      } finally {
        for (const b of document.querySelectorAll('#catalog button')) /** @type {HTMLButtonElement} */ (b).disabled = false;
      }
    }
  });

  $('search-input')?.addEventListener('input', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    searchQuery = input.value;
    const clearBtn = $('search-clear');
    if (clearBtn) clearBtn.hidden = !searchQuery;
    if (currentState) renderApps(currentState);
  });

  $('search-clear')?.addEventListener('click', () => {
    const input = /** @type {HTMLInputElement} */ ($('search-input'));
    if (input) input.value = '';
    searchQuery = '';
    const clearBtn = $('search-clear');
    if (clearBtn) clearBtn.hidden = true;
    if (currentState) renderApps(currentState);
  });

  $('gesture-pill')?.addEventListener('click', () => {
    const drawer = $('app-drawer');
    if (drawer) {
      drawer.hidden = !drawer.hidden;
      if (!drawer.hidden && currentState) renderDrawer(currentState, drawerCategory, drawerQuery);
    }
  });

  $('btn-open-drawer')?.addEventListener('click', () => {
    const drawer = $('app-drawer');
    if (drawer) {
      drawer.hidden = false;
      if (currentState) renderDrawer(currentState, drawerCategory, drawerQuery);
    }
  });

  $('drawer-close-btn')?.addEventListener('click', () => {
    const drawer = $('app-drawer');
    if (drawer) drawer.hidden = true;
  });

  $('.drawer-categories')?.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const pill = target.closest('.cat-pill');
    if (pill) {
      document.querySelectorAll('.cat-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      drawerCategory = pill.getAttribute('data-cat') || 'all';
      if (currentState) renderDrawer(currentState, drawerCategory, drawerQuery);
    }
  });

  $('drawer-search-input')?.addEventListener('input', (e) => {
    const input = /** @type {HTMLInputElement} */ (e.target);
    drawerQuery = input.value;
    if (currentState) renderDrawer(currentState, drawerCategory, drawerQuery);
  });

  $('install-yes')?.addEventListener('click', () => {
    const pendingId = currentState?.manager?.pendingInstall;
    if (pendingId) {
      api.install(pendingId);
    }
  });

  $('install-no')?.addEventListener('click', () => {
    api.dismissInstall();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const drawer = $('app-drawer');
      if (drawer && !drawer.hidden) {
        drawer.hidden = true;
        return;
      }
      if (currentState?.manager?.pendingInstall) {
        api.dismissInstall();
        return;
      }
      if (currentState && currentState.active !== null) {
        api.back();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'h') {
      api.home();
    }
  });
}

updateClock();
setInterval(updateClock, 1000);
wireEvents();
api.onState(render);
