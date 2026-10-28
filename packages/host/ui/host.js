const fallbackApi = {
  open(/** @type {string} */ _id) {},
  home() {},
  back() {},
  close(/** @type {string | undefined} */ _id) {},
  refreshCatalog() {},
  install(/** @type {string} */ _id) {},
  rollback(/** @type {string} */ _id) {},
  dismissInstall() {},
  uninstall(/** @type {string} */ _id) {},
  setDisabled(/** @type {string} */ _id, /** @type {boolean} */ _disabled) {},
  widgetAction(/** @type {string} */ _appId, /** @type {string} */ _widgetId, /** @type {string} */ _actionId) {},
  setTheme(/** @type {string} */ _theme) {},
  setLocale(/** @type {string} */ _loc) {},
  switchAccount(/** @type {string} */ _id, /** @type {string | undefined} */ _pin) {},
  startGuest() {},
  addAccount(/** @type {string} */ _name, /** @type {string | undefined} */ _pin) {},
  removeAccount(/** @type {string} */ _id, /** @type {string | undefined} */ _pin) {},
  setLauncher(/** @type {string | null} */ _id) {},
  removeEndpoint(/** @type {string} */ _appId, /** @type {string} */ _address) {},
  setKiosk(/** @type {boolean} */ _on, /** @type {string | undefined} */ _pin) {},
  setOverlay(/** @type {boolean} */ _open) {},
  onState(/** @type {(s: any) => void} */ _fn) {},
};

const api = /** @type {any} */ (window).host ?? fallbackApi;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

const ICONS = {
  home: 'M3 11l9-8 9 8 M5 10v11h5v-6h4v6h5V10',
  close: 'M6 6l12 12 M18 6L6 18',
  more: 'M6 9l6 6 6-6',
  check: 'M5 12l5 5L20 7',
  plus: 'M12 5v14 M5 12h14',
  lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  user: 'M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M4 21c1-4 4-6 8-6s7 2 8 6',
  open: 'M7 17L17 7 M8 7h9v9',
  power: 'M12 3v9 M6.5 6.5a8 8 0 1 0 11 0',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  settings: 'M4 7h10 M18 7h2 M4 17h2 M10 17h10 M14 5v4 M6 15v4',
};

const SECTIONS = ['general', 'apps', 'accounts', 'network'];
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** @type {any} */
let currentState = null;
/** @type {'home' | 'store' | 'settings'} */
let page = 'home';
let section = 'general';
let searchQuery = '';
let storeQuery = '';
let storeCategory = '';
/** @type {string[]} */
let tabOrder = [];
/** @type {string | null} */
let lastActive = null;
/** @type {string | null} */
let armedUninstall = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let armedTimer;
/** @type {string | null} */
let confirmInstallId = null;
/** @type {{ mode: 'pin' | 'add' | 'remove' | 'kiosk', id?: string, name?: string, locked?: boolean, unlock?: boolean } | null} */
let accountDialog = null;
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
 * @param {string} d
 * @param {number} [size]
 * @param {number} [stroke]
 */
function icon(d, size = 16, stroke = 1.8) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ class: 'icon', width: String(size), height: String(size), viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': String(stroke), 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return /** @type {any} */ (svg);
}

/** @param {string} title */
const initials = (title) => (title || 'A').trim().slice(0, 2).toUpperCase();

/**
 * @param {{ title?: string, id?: string }} app
 * @param {'' | 'small' | 'large'} [size]
 */
function appIcon(app, size = '') {
  return el('span', { class: `app-icon ${size}`.trim(), 'aria-hidden': 'true' }, [initials(app.title ?? app.id ?? '')]);
}

/** @param {string} id */
const appById = (id) => (currentState?.apps ?? []).find((/** @type {any} */ a) => a.id === id);
/** @param {string} id */
const rowById = (id) => (currentState?.manager?.rows ?? []).find((/** @type {any} */ r) => r.id === id);

/** @param {'home' | 'store' | 'settings'} next */
function setPage(next) {
  page = next;
  $('page-home').hidden = page !== 'home';
  $('page-store').hidden = page !== 'store';
  $('page-settings').hidden = page !== 'settings';
  for (const [id, name] of /** @type {const} */ ([['store-btn', 'store'], ['settings-btn', 'settings']])) {
    if (page === name) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
  }
  if (currentState) renderTabs(currentState);
  syncOverlay();
}

/** @param {string} next */
function setSection(next) {
  section = SECTIONS.includes(next) ? next : 'general';
  for (const b of document.querySelectorAll('#settings-nav button')) {
    if (b.getAttribute('data-section') === section) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  for (const panel of document.querySelectorAll('[data-panel]')) /** @type {HTMLElement} */ (panel).hidden = panel.getAttribute('data-panel') !== section;
}

function menusOpen() {
  return ['account-menu', 'tabs-menu', 'tile-menu', 'account-dialog', 'install-confirm'].some((id) => !$(id).hidden);
}

function syncOverlay() {
  const open = menusOpen() || page !== 'home';
  if (open === lastOverlay) return;
  lastOverlay = open;
  api.setOverlay(open);
}

function closeMenus() {
  for (const id of ['account-menu', 'tabs-menu', 'tile-menu']) {
    $(id).hidden = true;
  }
  $('account-btn').setAttribute('aria-expanded', 'false');
  syncOverlay();
}

/** @param {string} id @param {boolean} open */
function toggleMenu(id, open) {
  closeMenus();
  $(id).hidden = !open;
  if (id === 'account-menu') $('account-btn').setAttribute('aria-expanded', String(open));
  syncOverlay();
}

/** @param {any} widget @returns {HTMLElement} */
function renderWidgetItem(widget) {
  const owner = appById(widget.appId);
  const card = el('article', { class: 'widget-card' }, [
    el('div', { class: 'widget-head' }, [el('h3', {}, [widget.title]), el('span', {}, [owner?.title ?? ''])]),
  ]);
  for (const block of widget.descriptor?.blocks ?? []) {
    if (block.type === 'metric') {
      card.append(el('div', { class: `widget-metric tone-${block.tone ?? 'neutral'}` }, [
        el('div', { class: 'widget-metric-value' }, [String(block.value ?? '')]),
        el('div', { class: 'widget-metric-label' }, [String(block.label ?? '')]),
      ]));
    } else if (block.type === 'text') {
      card.append(el('p', { class: 'widget-text' }, [String(block.text ?? '')]));
    } else if (block.type === 'list') {
      card.append(el('ul', {}, (block.items ?? []).map((/** @type {any} */ item) =>
        el('li', { class: 'widget-list-item' }, [el('span', {}, [String(item.title ?? '')]), el('span', { class: 'sub' }, [String(item.subtitle ?? '')])]))));
    } else if (block.type === 'actions') {
      card.append(el('div', { class: 'widget-actions' }, (block.actions ?? []).map((/** @type {any} */ a) =>
        el('button', { type: 'button', class: 'btn', 'data-action': 'widget', 'data-app-id': widget.appId, 'data-widget-id': widget.widgetId, 'data-action-id': a.id }, [String(a.label ?? a.id)]))));
    }
  }
  return card;
}

/** @param {any} state */
function renderApps(state) {
  const all = (state.apps ?? []).filter((/** @type {any} */ a) => a.kind !== 'launcher' && !a.disabled);
  $('apps-count').textContent = `${all.length} installed`;
  const q = searchQuery.trim().toLowerCase();
  const shown = all.filter((/** @type {any} */ a) => !q || a.title.toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
  $('apps').replaceChildren(...shown.map((/** @type {any} */ a) => el('li', {}, [
    el('button', { type: 'button', class: 'app-btn', 'data-id': a.id }, [
      appIcon(a),
      el('span', { class: 'app-title' }, [el('span', {}, [a.title]), ...(a.running ? [el('span', { class: 'running-dot', title: 'Running' })] : [])]),
    ]),
  ])));
  $('no-match').hidden = !(q && shown.length === 0 && all.length > 0);
  $('apps-section').hidden = all.length === 0;
  const welcome = $('welcome');
  const empty = all.length === 0;
  welcome.hidden = !empty;
  if (empty) {
    const current = state.accounts?.list?.find((/** @type {any} */ a) => a.id === state.accounts.activeId);
    $('welcome-title').textContent = current ? `Welcome, ${current.name}` : 'Welcome';
    const picks = (state.manager?.rows ?? []).filter((/** @type {any} */ r) => !r.installed && !appById(r.id) && r.latest).slice(0, 3);
    const suggestHead = /** @type {HTMLElement | null} */ ($('suggest-title').closest('.shelf-head'));
    if (suggestHead) suggestHead.hidden = picks.length === 0;
    $('suggest').replaceChildren(...picks.map((/** @type {any} */ r) => el('article', { class: 'suggest-item' }, [
      appIcon(r),
      el('div', { class: 'text' }, [el('strong', {}, [r.title]), el('span', {}, [r.description || r.publisher])]),
      el('button', { type: 'button', class: 'btn small', 'data-store-install': r.id }, ['Install']),
    ])));
  }
}

/** @param {any} state */
function renderWidgets(state) {
  const widgets = state.widgets ?? [];
  $('widgets').replaceChildren(
    ...widgets.map((/** @type {any} */ w) => renderWidgetItem(w)),
    el('article', { class: 'widget-card placeholder' }, [
      el('h3', {}, [widgets.length ? 'More widgets' : 'No widgets yet']),
      el('p', { class: 'note' }, ['Apps that publish a widget show it here. Browse the Store to add more apps.']),
    ]),
  );
}

/** @param {any} state */
function renderTabs(state) {
  const apps = (state.apps ?? []).filter((/** @type {any} */ a) => a.kind !== 'launcher');
  const runningIds = apps.filter((/** @type {any} */ a) => a.running).map((/** @type {any} */ a) => a.id);
  tabOrder = [...tabOrder.filter((id) => runningIds.includes(id)), ...runningIds.filter((/** @type {string} */ id) => !tabOrder.includes(id))];
  const onHome = page === 'home';
  const home = el('button', { type: 'button', class: 'tab tab-home', 'data-tab': 'home', 'data-current': String(onHome && state.active === null) }, [icon(ICONS.home), el('span', {}, ['Home'])]);
  const tabs = tabOrder.map((id) => {
    const app = appById(id);
    const current = onHome && state.active === id;
    return el('div', { class: 'tab', 'data-app': id, 'data-current': String(current) }, [
      el('button', { type: 'button', class: 'tab-main', 'data-tab': id, ...(current ? { 'aria-current': 'page' } : {}) }, [el('span', { class: 'dot' }), el('span', { class: 'label' }, [app?.title ?? id])]),
      el('button', { type: 'button', class: 'tab-close', 'data-close': id, 'aria-label': `Close ${app?.title ?? id}` }, [icon(ICONS.close, 12, 2.2)]),
    ]);
  });
  const more = el('button', { type: 'button', class: 'tab tab-more', id: 'tabs-more', 'aria-haspopup': 'menu', 'aria-label': 'All open apps', hidden: '' }, [el('span', { id: 'tabs-more-count' }), icon(ICONS.more, 14, 2)]);
  $('tabs').replaceChildren(home, ...tabs, more);
  layoutTabs();
  renderTabsMenu(state);
}

function layoutTabs() {
  const box = $('tabs');
  const tabs = [...box.querySelectorAll('.tab[data-app]')].map((t) => /** @type {HTMLElement} */ (t));
  const more = $('tabs-more');
  if (!more) return;
  for (const t of tabs) t.hidden = false;
  more.hidden = true;
  const gap = 4;
  const room = box.clientWidth;
  const width = () => [...box.children].filter((c) => !(/** @type {HTMLElement} */ (c)).hidden).reduce((sum, c) => sum + /** @type {HTMLElement} */ (c).offsetWidth + gap, 0) - gap;
  if (width() <= room) return;
  more.hidden = false;
  let hidden = 0;
  const order = tabs.filter((t) => t.getAttribute('data-current') !== 'true').reverse();
  for (const t of order) {
    if (width() <= room) break;
    t.hidden = true;
    hidden++;
  }
  $('tabs-more-count').textContent = `+${tabs.filter((t) => t.hidden).length || hidden}`;
}

/** @param {any} state */
function renderTabsMenu(state) {
  const menu = $('tabs-menu');
  const ids = tabOrder;
  menu.replaceChildren(...ids.map((id) => {
    const app = appById(id);
    const current = page === 'home' && state.active === id;
    return el('div', { class: 'menu-item', role: 'menuitem', tabindex: '0', 'data-open': id, ...(current ? { 'aria-current': 'true' } : {}) }, [
      el('span', { class: 'dot running-dot' }),
      el('span', { class: 'grow' }, [app?.title ?? id]),
      el('button', { type: 'button', class: 'tab-close', 'data-close': id, 'aria-label': `Close ${app?.title ?? id}` }, [icon(ICONS.close, 14, 1.8)]),
    ]);
  }), ...(ids.length > 1 ? [el('div', { class: 'menu-sep' }), el('button', { type: 'button', class: 'menu-item muted', 'data-close-others': 'true' }, ['Close other apps'])] : []));
}

/** @param {any} state */
function renderAccountMenu(state) {
  const info = state.accounts;
  if (!info) return;
  const current = info.list.find((/** @type {any} */ a) => a.id === info.activeId);
  $('account-initial').textContent = (current?.name ?? '?').slice(0, 1).toUpperCase();
  const rows = info.list.map((/** @type {any} */ a) => {
    const active = a.id === info.activeId;
    const guest = a.type === 'guest';
    const sub = active ? 'Signed in' : guest ? 'Wiped when you leave' : a.locked ? 'Protected by a PIN' : 'Local account';
    const lead = guest ? el('span', { class: 'menu-avatar dashed' }, [icon(ICONS.user, 14)]) : el('span', { class: 'menu-avatar' }, [(a.name || '?').slice(0, 1).toUpperCase()]);
    const tail = active ? [icon(ICONS.check, 16, 2.2)] : a.locked ? [icon(ICONS.lock, 16)] : [];
    return el('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'data-account-action': 'switch', 'data-id': a.id, ...(active ? { 'aria-current': 'true' } : {}) }, [
      lead, el('span', { class: 'grow' }, [el('span', {}, [guest ? 'Guest session' : a.name]), el('small', {}, [sub])]), ...tail,
    ]);
  });
  const extra = [
    el('div', { class: 'menu-sep' }),
    el('button', { type: 'button', class: 'menu-item muted', role: 'menuitem', 'data-account-action': 'add' }, [icon(ICONS.plus), el('span', {}, ['Add account'])]),
  ];
  if (info.allowGuest && !info.list.some((/** @type {any} */ a) => a.type === 'guest')) {
    extra.push(el('button', { type: 'button', class: 'menu-item muted', role: 'menuitem', 'data-account-action': 'guest' }, [icon(ICONS.user), el('span', {}, ['Start a guest session'])]));
  }
  extra.push(el('button', { type: 'button', class: 'menu-item muted', role: 'menuitem', 'data-account-action': 'manage' }, [icon(ICONS.settings), el('span', {}, ['Manage accounts'])]));
  $('account-menu').replaceChildren(el('div', { class: 'menu-label' }, ['Accounts on this computer']), ...rows, ...extra);
  if (info.locked && !accountDialog && $('account-menu').hidden) {
    accountDialog = { mode: 'pin', id: info.activeId, name: current?.name, unlock: true };
  }
  renderAccountDialog();
}

/** @param {any} state */
function renderAccountList(state) {
  const info = state.accounts;
  if (!info) return;
  $('account-list').replaceChildren(...info.list.map((/** @type {any} */ a) => {
    const active = a.id === info.activeId;
    const guest = a.type === 'guest';
    const buttons = [];
    if (active) buttons.push(el('span', { class: 'pill good' }, ['Signed in']));
    else buttons.push(el('button', { type: 'button', class: 'btn small', 'data-account-action': 'switch', 'data-id': a.id }, ['Switch']));
    if (a.type === 'local' && !active) buttons.push(el('button', { type: 'button', class: 'btn small danger', 'data-account-action': 'remove', 'data-id': a.id }, ['Remove']));
    return el('div', { class: 'row' }, [
      el('span', { class: guest ? 'menu-avatar dashed' : 'menu-avatar' }, guest ? [icon(ICONS.user, 14)] : [(a.name || '?').slice(0, 1).toUpperCase()]),
      el('div', { class: 'row-text' }, [el('div', { class: 'row-title' }, [guest ? 'Guest session' : a.name, ...(a.locked ? [el('span', { class: 'pill' }, ['PIN'])] : [])]), el('div', { class: 'row-meta' }, [guest ? 'Wiped when you leave.' : 'Local account']) ]),
      el('div', { class: 'row-actions' }, buttons),
    ]);
  }));
  $('account-guest').hidden = !(info.allowGuest && !info.list.some((/** @type {any} */ a) => a.type === 'guest'));
}

function renderAccountDialog() {
  const panel = $('account-dialog');
  panel.hidden = !accountDialog;
  syncOverlay();
  if (!accountDialog) return;
  const { mode, name, locked, unlock } = accountDialog;
  $('account-title').textContent = mode === 'kiosk' ? 'Exit kiosk mode' : mode === 'add' ? 'Add local account' : mode === 'remove' ? `Remove ${name}?` : unlock ? `Unlock ${name}` : `Switch to ${name}`;
  $('account-detail').textContent = mode === 'add'
    ? 'A local account keeps its own app data on this computer. The PIN only controls who can open it here; it does not encrypt your data.'
    : mode === 'remove' ? 'Its app data on this computer is deleted.' : 'Enter the PIN for this account.';
  $('account-name-input').hidden = mode !== 'add';
  const pin = /** @type {HTMLInputElement} */ ($('account-pin-input'));
  pin.hidden = mode === 'remove' && !locked;
  pin.placeholder = mode === 'add' ? 'PIN (optional)' : 'PIN';
  $('account-submit').textContent = mode === 'kiosk' ? 'Exit kiosk' : mode === 'add' ? 'Add account' : mode === 'remove' ? 'Remove' : 'Continue';
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
  else if (mode === 'kiosk') await api.setKiosk(false, pin);
  else await api.switchAccount(id, pin);
  const error = currentState?.accounts?.error;
  if (error) $('account-error').textContent = error;
  else closeAccountDialog();
}

/** @param {any} r */
function versionLine(r) {
  if (!r.installed && appById(r.id)) return 'Built in';
  if (r.installed) return `v${r.installed}${r.latest && r.latest !== r.installed ? ` · v${r.latest} available` : ''}`;
  return r.latest ? `v${r.latest}` : 'No release in this channel';
}

/** @param {any} state */
function renderCatalog(state) {
  const rows = state.apps ?? [];
  $('catalog').replaceChildren(...rows.map((/** @type {any} */ a) => {
    const r = rowById(a.id);
    const manageable = !a.protected && a.kind !== 'launcher';
    const chip = a.protected ? 'Core' : a.kind === 'launcher' ? 'Home screen' : a.disabled ? 'Off' : a.running ? 'Running' : '';
    const meta = [a.publisher, r ? versionLine(r) : null].filter(Boolean).join(' · ');
    const actions = [];
    if (r?.installed && r.latest && r.latest !== r.installed) actions.push(el('button', { type: 'button', class: 'btn small', 'data-action': 'install', 'data-id': a.id }, [`Update to ${r.latest}`]));
    if (r?.previous) actions.push(el('button', { type: 'button', class: 'btn small quiet', 'data-action': 'rollback', 'data-id': a.id }, [`Roll back to ${r.previous}`]));
    if (manageable) {
      actions.push(el('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!a.disabled), 'aria-label': `${a.title} on or off`, 'data-action': a.disabled ? 'enable' : 'disable', 'data-id': a.id }, [el('span', {}, [a.disabled ? 'Off' : 'On']), el('span', { class: 'track' })]));
    }
    if (!a.protected && r?.installed) {
      const armed = armedUninstall === a.id;
      actions.push(el('button', { type: 'button', class: `btn small danger`, 'data-action': 'uninstall', 'data-id': a.id }, [armed ? 'Confirm uninstall' : 'Uninstall']));
    }
    return el('div', { class: `row${a.disabled ? ' off' : ''}` }, [
      appIcon(a, 'small'),
      el('div', { class: 'row-text' }, [el('div', { class: 'row-title' }, [a.title, ...(chip ? [el('span', { class: 'pill' }, [chip])] : [])]), el('div', { class: 'row-meta' }, [meta])]),
      el('div', { class: 'row-actions' }, actions),
    ]);
  }));
}

/** @param {any} state */
function renderStore(state) {
  const rows = (state.manager?.rows ?? []).filter((/** @type {any} */ r) => r.latest || r.installed);
  const categories = [...new Set(rows.flatMap((/** @type {any} */ r) => r.categories ?? []))].sort();
  if (storeCategory && !categories.includes(storeCategory)) storeCategory = '';
  $('store-chips').replaceChildren(...['', ...categories].map((c) => el('button', { type: 'button', class: 'chip-btn', 'data-category': c, 'aria-pressed': String(c === storeCategory) }, [c || 'All'])));
  $('store-chips').hidden = categories.length === 0;
  const q = storeQuery.trim().toLowerCase();
  const shown = rows.filter((/** @type {any} */ r) =>
    (!storeCategory || (r.categories ?? []).includes(storeCategory)) &&
    (!q || r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)));
  $('no-catalog').hidden = shown.length > 0;
  $('no-catalog').textContent = rows.length ? 'No apps match your search.' : 'No apps in the catalog.';
  $('store-cards').replaceChildren(...shown.map((/** @type {any} */ r) => {
    const installedApp = appById(r.id);
    const update = r.installed && r.latest && r.latest !== r.installed;
    let button;
    if (update) button = el('button', { type: 'button', class: 'btn', 'data-action': 'install', 'data-id': r.id }, ['Update']);
    else if (r.installed) button = el('button', { type: 'button', class: 'btn', 'data-store-open': r.id, ...(installedApp && !installedApp.disabled ? {} : { disabled: '' }) }, [installedApp?.disabled ? 'Off' : 'Open']);
    else if (installedApp && installedApp.kind === 'launcher') {
      const inUse = state.launcher?.active === r.id;
      button = el('button', { type: 'button', class: 'btn', 'data-store-launcher': r.id, ...(inUse ? { disabled: '' } : {}) }, [inUse ? 'In use' : 'Use as home']);
    } else if (installedApp) button = el('button', { type: 'button', class: 'btn', 'data-store-open': r.id, ...(installedApp.disabled ? { disabled: '' } : {}) }, [installedApp.disabled ? 'Off' : 'Open']);
    else if (r.latest) button = el('button', { type: 'button', class: 'btn primary', 'data-store-install': r.id }, ['Install']);
    else button = el('button', { type: 'button', class: 'btn', disabled: '' }, ['Unavailable']);
    return el('article', { class: 'card' }, [
      el('div', { class: 'card-head' }, [appIcon(r), el('div', {}, [el('div', { class: 'card-title' }, [r.title]), el('div', { class: 'card-meta' }, [r.publisher])])]),
      el('p', { class: 'card-body' }, [r.description || 'No description.']),
      el('div', { class: 'card-foot' }, [el('span', { class: 'ver' }, [versionLine(r)]), button]),
    ]);
  }));
}

/** @param {any} state */
function renderConfirm(state) {
  const panel = $('install-confirm');
  const id = state.manager?.pendingInstall ?? confirmInstallId;
  const row = id ? rowById(id) : null;
  panel.hidden = !row;
  syncOverlay();
  if (!row) return;
  $('install-icon').textContent = initials(row.title);
  $('install-title').textContent = `Install ${row.title}?`;
  $('install-detail').textContent = `Version ${row.latest} · ${row.publisher}`;
  const description = $('install-description');
  description.hidden = !row.description;
  description.textContent = row.description;
  $('install-source').textContent = `Source: ${row.repository}`;
}

/** @param {any} state */
function renderSettings(state) {
  for (const b of document.querySelectorAll('#theme-seg button')) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-choice') === (state.theme?.source ?? 'system')));
  }
  const select = /** @type {HTMLSelectElement} */ ($('launcher-select'));
  const options = state.launcher?.options ?? [];
  select.replaceChildren(el('option', { value: '' }, ['Built-in dashboard']), ...options.map((/** @type {any} */ o) => el('option', { value: o.id }, [o.title])));
  select.value = state.launcher?.active ?? '';
  const kioskReady = state.accounts?.list?.some((/** @type {any} */ a) => a.id === state.accounts.activeId && a.type === 'local' && a.locked) === true;
  $('kiosk-meta').textContent = kioskReady ? 'Hides this bar and the Store. Leaving needs this account\'s PIN.' : 'Needs a local account with a PIN. Add one in Accounts.';
  /** @type {HTMLButtonElement} */ ($('kiosk-start')).disabled = !kioskReady;
  const locale = /** @type {HTMLSelectElement} */ ($('locale-select'));
  if (state.locale) locale.value = state.locale;
  const list = state.endpoints ?? [];
  $('endpoints-section').hidden = list.length === 0;
  $('no-endpoints').hidden = list.length > 0;
  $('endpoints').replaceChildren(...list.map((/** @type {any} */ e) => el('div', { class: 'row' }, [
    el('div', { class: 'row-text' }, [el('div', { class: 'row-title' }, [e.title]), el('div', { class: 'row-meta' }, [e.address])]),
    el('button', { type: 'button', class: 'btn small danger', 'data-app': e.appId, 'data-address': e.address }, ['Remove']),
  ])));
}

/** @param {any} state */
function renderToast(state) {
  const m = state.manager ?? {};
  const error = m.actionError ?? (m.error ? `Catalog unavailable: ${m.error}` : null);
  $('toast').hidden = !error;
  $('manager-error').textContent = error ?? '';
}

/** @param {any} state */
function applyBrand(state) {
  const logo = /** @type {HTMLImageElement} */ ($('logo'));
  const favicon = /** @type {HTMLLinkElement} */ ($('favicon'));
  if (state.brand?.logo) {
    if (logo.src !== state.brand.logo) logo.src = state.brand.logo;
    logo.hidden = false;
    $('mark-default').setAttribute('hidden', '');
    if (favicon.href !== state.brand.logo) favicon.href = state.brand.logo;
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
}

/** @param {any} state */
function render(state) {
  currentState = state;
  document.title = state.product;
  $('title').textContent = state.product;
  document.body.classList.toggle('app-open', state.active !== null);
  document.body.setAttribute('data-kiosk', String(state.kiosk === true));
  $('kiosk-bar').hidden = state.kiosk !== true;
  if (state.kiosk) {
    $('kiosk-name').textContent = state.product;
    if (page !== 'home') setPage('home');
  }
  document.documentElement.setAttribute('data-theme', state.theme?.source ?? 'system');
  if (state.active !== null && state.active !== lastActive && page !== 'home') setPage('home');
  lastActive = state.active;
  applyBrand(state);
  renderAccountMenu(state);
  renderAccountList(state);
  renderApps(state);
  renderWidgets(state);
  renderTabs(state);
  renderCatalog(state);
  renderStore(state);
  renderSettings(state);
  renderConfirm(state);
  renderToast(state);
  syncOverlay();
}

function clearArmed() {
  armedUninstall = null;
  clearTimeout(armedTimer);
}

function focusSearch() {
  if (currentState?.active !== null) api.home();
  setPage('home');
  /** @type {HTMLInputElement} */ ($('search-input')).focus();
}

/** @param {string} id */
function openApp(id) {
  setPage('home');
  api.open(id);
}

function wireNavigation() {
  $('store-btn').addEventListener('click', () => { closeMenus(); setPage(page === 'store' ? 'home' : 'store'); });
  $('settings-btn').addEventListener('click', () => { closeMenus(); setPage(page === 'settings' ? 'home' : 'settings'); });
  $('welcome-store').addEventListener('click', () => setPage('store'));
  $('kiosk-start').addEventListener('click', () => api.setKiosk(true));
  $('kiosk-exit').addEventListener('click', () => { accountDialog = { mode: 'kiosk' }; renderAccountDialog(); });
  $('settings-nav').addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button[data-section]');
    if (b) setSection(b.getAttribute('data-section') ?? 'general');
  });

  $('tabs').addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const close = target.closest('[data-close]');
    if (close) { api.close(close.getAttribute('data-close')); return; }
    if (target.closest('#tabs-more')) { toggleMenu('tabs-menu', $('tabs-menu').hidden === true); return; }
    const tab = target.closest('[data-tab]');
    if (!tab) return;
    closeMenus();
    const id = tab.getAttribute('data-tab');
    if (id === 'home') { setPage('home'); api.home(); } else if (id) openApp(id);
  });
  $('tabs-menu').addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const close = target.closest('[data-close]');
    if (close) { api.close(close.getAttribute('data-close')); return; }
    if (target.closest('[data-close-others]')) {
      for (const id of tabOrder) if (id !== currentState?.active) api.close(id);
      return;
    }
    const item = target.closest('[data-open]');
    if (item) { closeMenus(); openApp(item.getAttribute('data-open') ?? ''); }
  });
}

function wireAccounts() {
  const menu = $('account-menu');
  $('account-btn').addEventListener('click', () => toggleMenu('account-menu', menu.hidden === true));
  /** @param {HTMLElement} btn */
  const act = (btn) => {
    const action = btn.getAttribute('data-account-action');
    const id = btn.getAttribute('data-id') ?? undefined;
    const target = (currentState?.accounts?.list ?? []).find((/** @type {any} */ a) => a.id === id);
    closeMenus();
    if (action === 'guest') api.startGuest();
    else if (action === 'add') accountDialog = { mode: 'add' };
    else if (action === 'manage') { setSection('accounts'); setPage('settings'); }
    else if (action === 'remove') accountDialog = { mode: 'remove', id, name: target?.name, locked: target?.locked };
    else if (target?.locked || id === currentState?.accounts?.activeId) {
      if (id !== currentState?.accounts?.activeId || currentState?.accounts?.locked) accountDialog = { mode: 'pin', id, name: target?.name };
    } else if (id) api.switchAccount(id);
    renderAccountDialog();
  };
  for (const root of [menu, $('account-list')]) {
    root.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-account-action]');
      if (btn) act(/** @type {HTMLElement} */ (btn));
    });
  }
  $('account-add').addEventListener('click', () => { accountDialog = { mode: 'add' }; renderAccountDialog(); });
  $('account-guest').addEventListener('click', () => api.startGuest());
  $('account-form').addEventListener('submit', submitAccountDialog);
  $('account-cancel').addEventListener('click', () => {
    const wasUnlock = accountDialog?.unlock;
    closeAccountDialog();
    if (wasUnlock) toggleMenu('account-menu', true);
  });
}

function wireHome() {
  $('apps').addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-id]');
    const id = btn?.getAttribute('data-id');
    if (id) api.open(id);
  });
  $('widgets').addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-action="widget"]');
    if (!btn) return;
    const appId = btn.getAttribute('data-app-id');
    const widgetId = btn.getAttribute('data-widget-id');
    const actionId = btn.getAttribute('data-action-id');
    if (appId && widgetId && actionId) api.widgetAction(appId, widgetId, actionId);
  });
  $('suggest').addEventListener('click', (e) => {
    const id = /** @type {HTMLElement} */ (e.target).closest('[data-store-install]')?.getAttribute('data-store-install');
    if (id) { confirmInstallId = id; renderConfirm(currentState); }
  });
  $('search-input').addEventListener('input', (e) => {
    searchQuery = /** @type {HTMLInputElement} */ (e.target).value;
    if (currentState) renderApps(currentState);
  });
  $('search-hint').textContent = MAC ? '⌘K' : 'Ctrl K';

  const tile = $('tile-menu');
  $('apps').addEventListener('contextmenu', (e) => {
    if (currentState?.kiosk) return;
    const id = /** @type {HTMLElement} */ (e.target).closest('.app-btn')?.getAttribute('data-id');
    const app = id ? appById(id) : null;
    if (!app) return;
    e.preventDefault();
    const items = [el('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'data-tile-action': 'open', 'data-id': app.id }, [icon(ICONS.open), el('span', {}, ['Open'])])];
    if (!app.protected) {
      items.push(
        el('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'data-tile-action': 'disable', 'data-id': app.id }, [icon(ICONS.power), el('span', {}, ['Turn off']), el('span', { class: 'hint' }, ['Keeps its data'])]),
        el('div', { class: 'menu-sep' }),
        el('button', { type: 'button', class: 'menu-item danger', role: 'menuitem', 'data-tile-action': 'uninstall', 'data-id': app.id }, [icon(ICONS.trash), el('span', {}, ['Uninstall'])]),
      );
    }
    tile.setAttribute('aria-label', app.title);
    tile.replaceChildren(...items);
    toggleMenu('tile-menu', true);
    tile.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - 256))}px`;
    tile.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - 160))}px`;
  });
  tile.addEventListener('click', async (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-tile-action]');
    const id = btn?.getAttribute('data-id');
    if (!btn || !id) return;
    const action = btn.getAttribute('data-tile-action');
    if (action === 'uninstall' && btn.getAttribute('data-armed') !== 'true') {
      btn.setAttribute('data-armed', 'true');
      btn.classList.add('armed');
      btn.replaceChildren(icon(ICONS.trash), el('span', { class: 'grow' }, [el('span', {}, ['Confirm uninstall']), el('small', {}, [`Removes ${appById(id)?.title ?? id} and its saved data from this account.`])]));
      return;
    }
    closeMenus();
    if (action === 'open') api.open(id);
    else if (action === 'disable') await api.setDisabled(id, true);
    else await api.uninstall(id);
  });
}

function wireStore() {
  $('refresh').addEventListener('click', () => api.refreshCatalog());
  $('store-search').addEventListener('input', (e) => {
    storeQuery = /** @type {HTMLInputElement} */ (e.target).value;
    if (currentState) renderStore(currentState);
  });
  $('store-chips').addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('button[data-category]');
    if (!b) return;
    storeCategory = b.getAttribute('data-category') ?? '';
    renderStore(currentState);
  });
  $('store-cards').addEventListener('click', async (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    const install = target.closest('[data-store-install]')?.getAttribute('data-store-install');
    if (install) { confirmInstallId = install; renderConfirm(currentState); return; }
    const open = target.closest('[data-store-open]')?.getAttribute('data-store-open');
    if (open) { openApp(open); return; }
    const home = target.closest('[data-store-launcher]')?.getAttribute('data-store-launcher');
    if (home) { await api.setLauncher(home); setPage('home'); return; }
    const update = target.closest('button[data-action="install"]')?.getAttribute('data-id');
    if (update) await api.install(update);
  });
  $('install-yes').addEventListener('click', () => {
    const id = currentState?.manager?.pendingInstall ?? confirmInstallId;
    confirmInstallId = null;
    if (id) api.install(id);
  });
  $('install-no').addEventListener('click', () => {
    confirmInstallId = null;
    api.dismissInstall();
    renderConfirm(currentState);
  });
}

function wireSettings() {
  $('theme-seg').addEventListener('click', (e) => {
    const choice = /** @type {HTMLElement} */ (e.target).closest('button[data-theme-choice]')?.getAttribute('data-theme-choice');
    if (choice) api.setTheme(choice);
  });
  $('launcher-select').addEventListener('change', (e) => api.setLauncher(/** @type {HTMLSelectElement} */ (e.target).value || null));
  $('locale-select').addEventListener('change', (e) => api.setLocale(/** @type {HTMLSelectElement} */ (e.target).value));
  $('endpoints').addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-address]');
    if (btn) api.removeEndpoint(btn.getAttribute('data-app'), btn.getAttribute('data-address'));
  });
  $('catalog').addEventListener('click', async (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-action]');
    const action = btn?.getAttribute('data-action');
    const id = btn?.getAttribute('data-id');
    if (!btn || !id) return;
    if (action === 'uninstall' && armedUninstall !== id) {
      armedUninstall = id;
      clearTimeout(armedTimer);
      armedTimer = setTimeout(() => { clearArmed(); renderCatalog(currentState); }, 5000);
      renderCatalog(currentState);
      return;
    }
    clearArmed();
    for (const b of document.querySelectorAll('#catalog button')) /** @type {HTMLButtonElement} */ (b).disabled = true;
    try {
      if (action === 'install') await api.install(id);
      else if (action === 'rollback') await api.rollback(id);
      else if (action === 'uninstall') await api.uninstall(id);
      else if (action === 'disable') await api.setDisabled(id, true);
      else if (action === 'enable') await api.setDisabled(id, false);
    } finally {
      for (const b of document.querySelectorAll('#catalog button')) /** @type {HTMLButtonElement} */ (b).disabled = false;
    }
  });
  $('toast-close').addEventListener('click', () => { $('toast').hidden = true; });
}

function wireKeys() {
  document.addEventListener('click', (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!menusOpen()) return;
    if (target.closest('.menu') || target.closest('#account-btn') || target.closest('#tabs-more')) return;
    if (!$('account-dialog').hidden || !$('install-confirm').hidden) return;
    closeMenus();
  });
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); focusSearch(); return; }
    if (mod && e.key.toLowerCase() === 'h') { setPage('home'); api.home(); return; }
    if (e.key !== 'Escape') return;
    if (!$('install-confirm').hidden) { confirmInstallId = null; api.dismissInstall(); renderConfirm(currentState); return; }
    if (!$('account-dialog').hidden && !accountDialog?.unlock) { closeAccountDialog(); return; }
    if (!$('account-menu').hidden || !$('tabs-menu').hidden || !$('tile-menu').hidden) { closeMenus(); return; }
    if (page !== 'home') { setPage('home'); return; }
    if (currentState && currentState.active !== null) api.back();
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => layoutTabs()).observe($('tabs'));
  else window.addEventListener('resize', layoutTabs);
}

wireNavigation();
wireAccounts();
wireHome();
wireStore();
wireSettings();
wireKeys();
setSection('general');
api.onState(render);
