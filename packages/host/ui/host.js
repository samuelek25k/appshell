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
  setTheme(/** @type {string} */ _theme) {},
  setLocale(/** @type {string} */ _loc) {},
  switchAccount(/** @type {string} */ _id, /** @type {string | undefined} */ _pin) {},
  startGuest() {},
  addAccount(/** @type {string} */ _name, /** @type {string | undefined} */ _pin) {},
  removeAccount(/** @type {string} */ _id, /** @type {string | undefined} */ _pin) {},
  setLauncher(/** @type {string | null} */ _id) {},
  setOverlay(/** @type {boolean} */ _open) {},
  onState(/** @type {(s: any) => void} */ fn) {},
};

const api = /** @type {any} */ (window).host ?? fallbackApi;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {any} */
let currentState = null;
/** @type {{ mode: 'pin' | 'add' | 'remove', id?: string, name?: string, locked?: boolean, unlock?: boolean } | null} */
let accountDialog = null;
let searchQuery = '';
/** @type {Set<string>} */
let appliedColors = new Set();
let lastOverlay = false;

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
 * @param {'normal' | 'small'} [size]
 * @returns {HTMLElement}
 */
function createAppIcon(app, size = 'normal') {
  const bg = hashColor(app.id || app.title || 'app');
  const className = size === 'small' ? 'cat-icon' : 'app-icon';
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
  if (back) back.hidden = isHome;
  if (close) close.hidden = isHome;
  const themeSource = state.theme?.source ?? 'system';
  document.documentElement.setAttribute('data-theme', themeSource);

  const logo = /** @type {HTMLImageElement | null} */ ($('logo'));
  const favicon = /** @type {HTMLLinkElement | null} */ ($('favicon'));
  if (state.brand?.logo) {
    if (logo && logo.src !== state.brand.logo) logo.src = state.brand.logo;
    if (favicon && favicon.href !== state.brand.logo) favicon.href = state.brand.logo;
  }
  if (state.brand?.colors) {
    const applied = new Set();
    for (const [key, value] of Object.entries(state.brand.colors)) {
      const prop = key.startsWith('--') ? key : `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
      document.documentElement.style.setProperty(prop, String(value));
      applied.add(prop);
    }
    for (const prop of appliedColors) if (!applied.has(prop)) document.documentElement.style.removeProperty(prop);
    appliedColors = applied;
  }

  const themeToggle = $('theme-toggle');
  if (themeToggle) {
    themeToggle.title = `Theme: ${themeSource}`;
    for (const source of ['system', 'light', 'dark']) {
      $(`theme-icon-${source}`)?.toggleAttribute('hidden', themeSource !== source);
    }
  }

  const localeSelect = /** @type {HTMLSelectElement | null} */ ($('locale-select'));
  if (localeSelect && state.locale) {
    localeSelect.value = state.locale;
  }

  renderAccounts(state);
  renderApps(state);
  renderWidgets(state);
  renderCatalog(state);
  renderConfirm(state);
  renderLauncherPicker(state);
  syncOverlay();
}

function syncOverlay() {
  const open = !$('account-menu').hidden || !$('settings-dialog').hidden || !$('account-dialog').hidden || !$('install-confirm').hidden;
  if (open === lastOverlay) return;
  lastOverlay = open;
  api.setOverlay(open);
}

/** @param {any} state */
function renderLauncherPicker(state) {
  const select = /** @type {HTMLSelectElement} */ ($('launcher-select'));
  const options = state.launcher?.options ?? [];
  select.replaceChildren(el('option', { value: '' }, ['Built-in dashboard']), ...options.map((/** @type {any} */ o) => el('option', { value: o.id }, [o.title])));
  select.value = state.launcher?.active ?? '';
}

/** @param {any} state */
function renderApps(state) {
  const ul = $('apps');
  const count = $('apps-count');
  if (!ul) return;
  const apps = (state.apps ?? []).filter((/** @type {any} */ a) => a.kind !== 'launcher');
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
function renderAccounts(state) {
  const info = state.accounts;
  if (!info) return;
  const current = info.list.find((/** @type {any} */ a) => a.id === info.activeId);
  $('account-initial').textContent = (current?.name ?? '?').slice(0, 1).toUpperCase();
  $('account-name').textContent = current?.name ?? '';
  const menu = $('account-menu');
  const rows = info.list.map((/** @type {any} */ a) => {
    const label = [el('span', {}, [document.createTextNode(a.name)])];
    if (a.type === 'guest') label.push(el('span', { class: 'account-tag' }, [document.createTextNode('Guest')]));
    else if (a.locked) label.push(el('span', { class: 'account-tag' }, [document.createTextNode('PIN')]));
    const pick = el('button', { type: 'button', role: 'menuitem', 'data-account-action': 'switch', 'data-id': a.id, ...(a.id === info.activeId ? { 'aria-current': 'true' } : {}) }, label);
    const parts = [pick];
    if (a.type === 'local' && a.id !== info.activeId) parts.push(el('button', { type: 'button', class: 'account-remove', 'data-account-action': 'remove', 'data-id': a.id, 'aria-label': `Remove ${a.name}` }, [document.createTextNode('Remove')]));
    return el('div', { class: 'account-row' }, parts);
  });
  const extra = [el('hr'), el('button', { type: 'button', role: 'menuitem', 'data-account-action': 'add' }, [document.createTextNode('Add local account')])];
  if (info.allowGuest && !info.list.some((/** @type {any} */ a) => a.type === 'guest')) {
    extra.push(el('button', { type: 'button', role: 'menuitem', 'data-account-action': 'guest' }, [document.createTextNode('Use as guest')]));
  }
  menu.replaceChildren(...rows, ...extra);
  if (info.locked && !accountDialog && menu.hidden) {
    accountDialog = { mode: 'pin', id: info.activeId, name: current?.name, unlock: true };
  }
  renderAccountDialog();
}

function renderAccountDialog() {
  const panel = $('account-dialog');
  panel.hidden = !accountDialog;
  syncOverlay();
  if (!accountDialog) return;
  const { mode, name, locked, unlock } = accountDialog;
  $('account-title').textContent = mode === 'add' ? 'Add local account' : mode === 'remove' ? `Remove ${name}?` : unlock ? `Unlock ${name}` : `Switch to ${name}`;
  $('account-detail').textContent = mode === 'add'
    ? 'A local account keeps its own app data on this computer. The PIN only controls who can open it here; it does not encrypt your data.'
    : mode === 'remove' ? 'Its app data on this computer is deleted.' : 'Enter the PIN for this account.';
  $('account-name-input').hidden = mode !== 'add';
  const pin = /** @type {HTMLInputElement} */ ($('account-pin-input'));
  pin.hidden = mode === 'remove' && !locked;
  pin.placeholder = mode === 'add' ? 'PIN (optional)' : 'PIN';
  $('account-submit').textContent = mode === 'add' ? 'Add account' : mode === 'remove' ? 'Remove' : 'Continue';
  $('account-cancel').textContent = unlock ? 'Choose another account' : 'Cancel';
}

function closeAccountDialog() {
  accountDialog = null;
  /** @type {HTMLFormElement} */ ($('account-form')).reset();
  $('account-error').textContent = '';
  renderAccountDialog();
}

/** @param {Event} event */
async function submitAccountDialog(event) {
  event.preventDefault();
  if (!accountDialog) return;
  const { mode, id } = accountDialog;
  const name = /** @type {HTMLInputElement} */ ($('account-name-input')).value;
  const pin = /** @type {HTMLInputElement} */ ($('account-pin-input')).value || undefined;
  if (mode === 'add') await api.addAccount(name, pin);
  else if (mode === 'remove') await api.removeAccount(id, pin);
  else await api.switchAccount(id, pin);
  const error = currentState?.accounts?.error;
  if (error) $('account-error').textContent = error;
  else closeAccountDialog();
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

function wireEvents() {
  const showSettings = (/** @type {boolean} */ open) => { $('settings-dialog').hidden = !open; syncOverlay(); };
  $('settings-btn')?.addEventListener('click', () => showSettings(true));
  $('settings-close')?.addEventListener('click', () => showSettings(false));
  $('settings-dialog')?.addEventListener('click', (e) => { if (e.target === $('settings-dialog')) showSettings(false); });
  $('launcher-select')?.addEventListener('change', (e) => api.setLauncher((/** @type {HTMLSelectElement} */ (e.target)).value || null));
  const menu = $('account-menu');
  const toggleMenu = (/** @type {boolean} */ open) => {
    menu.hidden = !open;
    syncOverlay();
    $('account-btn').setAttribute('aria-expanded', String(open));
  };
  $('account-btn')?.addEventListener('click', () => toggleMenu(menu.hidden === true));
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !(/** @type {HTMLElement} */ (e.target)).closest('.account')) toggleMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleMenu(false);
  });
  menu.addEventListener('click', (e) => {
    const btn = (/** @type {HTMLElement} */ (e.target)).closest('button[data-account-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-account-action');
    const id = btn.getAttribute('data-id') ?? undefined;
    const target = (currentState?.accounts?.list ?? []).find((/** @type {any} */ a) => a.id === id);
    toggleMenu(false);
    if (action === 'guest') api.startGuest();
    else if (action === 'add') accountDialog = { mode: 'add' };
    else if (action === 'remove') accountDialog = { mode: 'remove', id, name: target?.name, locked: target?.locked };
    else if (target?.locked || id === currentState?.accounts?.activeId) {
      if (id !== currentState?.accounts?.activeId || currentState?.accounts?.locked) accountDialog = { mode: 'pin', id, name: target?.name };
    } else if (id) api.switchAccount(id);
    renderAccountDialog();
  });
  $('account-form').addEventListener('submit', submitAccountDialog);
  $('account-cancel').addEventListener('click', () => {
    const wasUnlock = accountDialog?.unlock;
    closeAccountDialog();
    if (wasUnlock) toggleMenu(true);
  });
  $('back')?.addEventListener('click', () => api.back());
  $('home')?.addEventListener('click', () => api.home());
  $('close')?.addEventListener('click', () => api.close());
  $('refresh')?.addEventListener('click', () => api.refreshCatalog());
  $('theme-toggle')?.addEventListener('click', () => {
    const current = currentState?.theme?.source ?? 'system';
    const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
    api.setTheme(next);
  });
  $('locale-select')?.addEventListener('change', (e) => {
    const target = /** @type {HTMLSelectElement} */ (e.target);
    api.setLocale(target.value);
  });

  $('apps')?.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const btn = target.closest('button[data-id]');
    if (btn) {
      const id = btn.getAttribute('data-id');
      if (id) api.open(id);
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

wireEvents();
api.onState(render);
