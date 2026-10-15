// Host Shell UI — iOS & Android Fluid Experience.
// Renders app squircles, widgets, and catalog listings with DOM APIs.

const api = /** @type {any} */ (window).host;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [children]
 */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of children) node.append(child);
  return node;
}

/**
 * Procedural iOS / Android App Icon Palettes & Glyphs.
 * @type {Record<string, { bg: string, svg: string }>}
 */
const APP_THEMES = {
  welcome: {
    bg: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  },
  profile: {
    bg: 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  },
  'clipboard-manager': {
    bg: 'linear-gradient(135deg, #34d399 0%, #0d9488 100%)',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
  },
  'color-picker': {
    bg: 'linear-gradient(135deg, #f43f5e 0%, #8b5cf6 50%, #06b6d4 100%)',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
  },
  'json-tools': {
    bg: 'linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  },
  'markdown-preview': {
    bg: 'linear-gradient(135deg, #818cf8 0%, #4338ca 100%)',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  },
  'outlook-calendar': {
    bg: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  },
  pomodoro: {
    bg: 'linear-gradient(135deg, #f43f5e 0%, #f59e0b 100%)',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  },
  'quick-notes': {
    bg: 'linear-gradient(135deg, #fbbf24 0%, #ea580c 100%)',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  },
  'world-clock': {
    bg: 'linear-gradient(135deg, #06b6d4 0%, #10b981 100%)',
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon-svg"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  },
};

/** @param {string} str */
function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash % 360);
  return `linear-gradient(135deg, hsl(${h}, 85%, 60%) 0%, hsl(${(h + 40) % 360}, 80%, 45%) 100%)`;
}

/**
 * Creates an iOS / Android squircle icon element for an app.
 * @param {any} app
 * @param {'normal' | 'small' | 'dock'} [size]
 */
function createSquircle(app, size = 'normal') {
  const theme = APP_THEMES[app.id] ?? {
    bg: hashColor(app.id || app.title),
    svg: `<span class="initials">${(app.title || 'A').slice(0, 2).toUpperCase()}</span>`,
  };

  const className = size === 'small' ? 'cat-icon' : size === 'dock' ? 'dock-squircle' : 'app-squircle';
  const squircle = el('div', {
    class: className,
    style: `background: ${theme.bg}`,
  });
  squircle.innerHTML = theme.svg;

  if (app.running && size === 'normal') {
    squircle.appendChild(el('span', { class: 'running-dot', title: 'Running' }));
  }

  return squircle;
}

/** @param {string} appId @param {string} widgetId @param {any} block */
function renderBlock(appId, widgetId, block) {
  switch (block.type) {
    case 'text': return el('p', {}, [String(block.text)]);
    case 'metric':
      return el('div', { class: 'metric', 'data-tone': block.tone ?? 'neutral' }, [
        el('span', {}, [String(block.label)]),
        el('br'),
        el('b', {}, [String(block.value)]),
        block.unit ? ` ${block.unit}` : '',
      ]);
    case 'list':
      return el('ul', {}, block.items.map((/** @type {any} */ i) =>
        el('li', {}, [
          el('span', {}, [String(i.label)]),
          el('span', {}, [String(i.value ?? '')]),
        ])
      ));
    case 'actions':
      return el('div', { class: 'actions' }, block.actions.map((/** @type {any} */ a) => {
        const button = el('button', {}, [String(a.label)]);
        button.addEventListener('click', () => api.widgetAction(appId, widgetId, a.id));
        return button;
      }));
    default: return el('span');
  }
}

/** @type {any} */
let lastState = null;
let searchQuery = '';

/** @param {any} state */
function render(state) {
  lastState = state;
  document.title = state.product;
  $('title').textContent = state.title ?? state.product;
  document.body.classList.toggle('app-open', Boolean(state.active));
  /** @type {HTMLButtonElement} */ ($('back')).disabled = !state.active;
  /** @type {HTMLButtonElement} */ ($('close')).disabled = !state.active;

  const q = searchQuery.toLowerCase().trim();
  const filteredApps = state.apps.filter((/** @type {any} */ a) =>
    !q || a.title.toLowerCase().includes(q) || a.publisher.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)
  );

  $('apps-count').textContent = `${state.apps.length}`;

  $('apps').replaceChildren(...filteredApps.map((/** @type {any} */ a) => {
    const tile = el('button', { class: 'app-tile', 'data-id': a.id, 'aria-label': `Launch ${a.title}` }, [
      createSquircle(a, 'normal'),
      el('div', { class: 'app-label' }, [
        el('strong', {}, [a.title]),
        a.protected ? el('span', { class: 'core-tag' }, ['Core']) : el('span', {}, [a.publisher]),
      ]),
    ]);
    tile.addEventListener('click', () => api.open(a.id));
    return el('li', {}, [tile]);
  }));

  const filteredWidgets = state.widgets.filter((/** @type {any} */ w) =>
    !q || w.title.toLowerCase().includes(q) || w.appId.toLowerCase().includes(q)
  );

  $('widgets').replaceChildren(...filteredWidgets.map((/** @type {any} */ w) => {
    const from = state.apps.find((/** @type {any} */ a) => a.id === w.appId)?.title ?? w.appId;
    return el('article', { class: 'widget' }, [
      el('div', { class: 'widget-header' }, [
        el('h3', {}, [w.title]),
        from === w.title ? '' : el('span', { class: 'from' }, [from]),
      ]),
      ...w.descriptor.blocks.map((/** @type {any} */ b) => renderBlock(w.appId, w.widgetId, b)),
    ]);
  }));
  $('no-widgets').hidden = filteredWidgets.length > 0;

  renderAccounts(state);
  renderDock(state);
  renderCatalog(state.manager);
}

/** @type {Record<string, string>} */
const PROVIDER_COLORS = {
  google: '#ea4335',
  microsoft: '#00a4ef',
  local: '#6366f1',
};

/** @type {Record<string, string>} */
const PROVIDER_LABELS = {
  google: 'Google',
  microsoft: 'Microsoft',
  local: 'Local',
};

/** @param {any} state */
function renderAccounts(state) {
  const active = state.activeAccount;
  const accounts = state.accounts ?? [];

  if (active) {
    const accName = $('account-name');
    if (accName) accName.textContent = active.name;

    const accAvatar = $('account-avatar');
    if (accAvatar) {
      const color = PROVIDER_COLORS[active.provider] ?? active.avatarColor ?? '#6366f1';
      accAvatar.style.background = color;
      accAvatar.style.boxShadow = `0 0 6px ${color}`;
    }

    const authText = $('auth-status-text');
    if (authText) {
      const p = PROVIDER_LABELS[active.provider] ?? 'Local';
      authText.textContent = `${p} (${active.email}) · Ed25519 Token Active`;
    }
  }

  const list = $('accounts-list');
  if (!list) return;

  list.replaceChildren(...accounts.map((/** @type {any} */ acc) => {
    const isActive = active && acc.id === active.id;
    const color = PROVIDER_COLORS[acc.provider] ?? acc.avatarColor ?? '#6366f1';
    const tag = acc.provider === 'google' ? 'G' : acc.provider === 'microsoft' ? 'MS' : (acc.name || 'U').slice(0, 1).toUpperCase();

    const avatar = el('div', { class: 'acc-avatar', style: `background: ${color}` }, [tag]);
    const info = el('div', { class: 'acc-info' }, [
      el('strong', {}, [acc.name]),
      el('span', {}, [`${acc.email}${acc.role ? ` · ${acc.role}` : ''} (${PROVIDER_LABELS[acc.provider] ?? 'Local'})`]),
    ]);
    const left = el('div', { class: 'account-item-left' }, [avatar, info]);

    const actions = el('div', { class: 'acc-actions' });
    if (isActive) {
      actions.appendChild(el('span', { class: 'active-check' }, ['Active']));
    } else {
      const switchBtn = el('button', { class: 'btn-secondary', style: 'padding: 4px 10px;' }, ['Switch']);
      switchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        api.switchAccount(acc.id);
      });
      actions.appendChild(switchBtn);

      if (accounts.length > 1) {
        const removeBtn = el('button', { class: 'btn-remove-acc', title: 'Remove account', 'aria-label': `Remove ${acc.name}` }, ['✕']);
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          api.removeAccount(acc.id);
        });
        actions.appendChild(removeBtn);
      }
    }

    const item = el('li', { class: `account-item${isActive ? ' active' : ''}` }, [left, actions]);
    if (!isActive) {
      item.addEventListener('click', () => api.switchAccount(acc.id));
    }
    return item;
  }));
}

/** @param {any} state */
function renderDock(state) {
  const dock = $('dock');
  if (!dock) return;

  const pinnedIds = ['profile', 'welcome', 'quick-notes', 'world-clock', 'clipboard-manager'];
  /** @type {any[]} */
  const dockApps = [];
  for (const id of pinnedIds) {
    const app = state.apps.find((/** @type {any} */ a) => a.id === id);
    if (app && !dockApps.some((a) => a.id === app.id)) dockApps.push(app);
  }
  for (const app of state.apps) {
    if (app.running && !dockApps.some((a) => a.id === app.id)) dockApps.push(app);
  }
  if (dockApps.length === 0) {
    dockApps.push(...state.apps.slice(0, 5));
  }

  dock.replaceChildren(...dockApps.map((a) => {
    const item = el('button', {
      class: 'dock-item',
      title: a.title,
      'aria-label': `Launch ${a.title}`,
    }, [
      createSquircle(a, 'dock'),
    ]);
    if (appIsRunning(a)) {
      item.appendChild(el('span', { class: 'dock-dot', title: 'Running' }));
    }
    item.addEventListener('click', () => api.open(a.id));
    return item;
  }));
}

/** @param {any} a */
function appIsRunning(a) {
  return Boolean(a.running);
}

/** @param {{ rows: any[], error: string | null, enabled: boolean, actionError: string | null, pendingInstall: string | null }} manager */
function renderCatalog(manager) {
  $('catalog-section').hidden = !manager.enabled && manager.rows.length === 0;
  const pending = manager.rows.find((r) => r.id === manager.pendingInstall);
  $('install-confirm').hidden = !pending;
  if (pending) {
    $('install-title').textContent = `Install ${pending.title}?`;
    $('install-detail').textContent = `${pending.title} ${pending.latest} by ${pending.publisher}${pending.description ? ` — ${pending.description}` : ''}`;
    $('install-source').textContent = `Verified source: ${pending.repository}`;
    $('install-yes').onclick = () => api.install(pending.id);
    $('install-no').onclick = () => api.dismissInstall();
  }

  const error = manager.actionError ?? (manager.error ? `Catalog unavailable: ${manager.error}` : null);
  $('manager-error').textContent = error ?? '';
  $('manager-error').hidden = !error;

  /** @type {(label: string, run: () => Promise<unknown>, primary?: boolean) => HTMLElement} */
  const action = (label, run, primary = false) => {
    const button = /** @type {HTMLButtonElement} */ (el('button', primary ? { class: 'primary' } : {}, [label]));
    button.addEventListener('click', async () => {
      for (const b of document.querySelectorAll('.catalog button')) /** @type {HTMLButtonElement} */ (b).disabled = true;
      await run();
    });
    return button;
  };

  const q = searchQuery.toLowerCase().trim();
  const rows = manager.rows.filter((r) =>
    !q || r.title.toLowerCase().includes(q) || r.publisher.toLowerCase().includes(q) || (r.description && r.description.toLowerCase().includes(q))
  );

  $('catalog').replaceChildren(...rows.map((r) => {
    const status = r.installed
      ? `${r.installed} installed${r.latest && r.latest !== r.installed ? ` · ${r.latest} available` : ''}`
      : r.latest ? `${r.latest} available` : 'No release in this channel';

    return el('li', {}, [
      createSquircle(r, 'small'),
      el('div', { class: 'info' }, [
        el('strong', {}, [r.title]),
        el('span', {}, [`${r.publisher} · ${status}`]),
        r.description ? el('span', { class: 'desc' }, [r.description]) : '',
      ]),
      el('div', { class: 'catalog-actions' }, [
        !r.installed && r.latest ? action('Get', () => api.install(r.id), true) : '',
        r.installed && r.latest && r.latest !== r.installed ? action(`Update to ${r.latest}`, () => api.install(r.id), true) : '',
        r.previous ? action(`Roll back`, () => api.rollback(r.id)) : '',
        r.installed ? action('Remove', () => api.uninstall(r.id)) : '',
      ]),
    ]);
  }));
  $('no-catalog').hidden = rows.length > 0;
}

// Spotlight Search input handler
const searchInput = /** @type {HTMLInputElement} */ ($('search-input'));
const searchClear = $('search-clear');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    searchQuery = /** @type {HTMLInputElement} */ (e.target).value;
    if (searchClear) searchClear.hidden = !searchQuery;
    if (lastState) render(lastState);
  });
}
if (searchClear) {
  searchClear.addEventListener('click', () => {
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    searchClear.hidden = true;
    if (lastState) render(lastState);
  });
}

// Keyboard shortcuts: '/' focuses search, 'Esc' closes/clears
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput?.focus();
  } else if (e.key === 'Escape') {
    if (searchQuery) {
      searchQuery = '';
      if (searchInput) searchInput.value = '';
      if (searchClear) searchClear.hidden = true;
      if (lastState) render(lastState);
    } else if (lastState?.active) {
      api.back();
    }
  }
});

$('back').addEventListener('click', () => api.back());
$('home').addEventListener('click', () => api.home());
$('close').addEventListener('click', () => api.close());
$('refresh').addEventListener('click', () => api.refreshCatalog());

// Multi-Account Dialog & Form Interactions
const accountBtn = $('account-btn');
const accountDialog = /** @type {HTMLDialogElement} */ ($('account-dialog'));
const accountDialogClose = $('account-dialog-close');
const addAccountForm = /** @type {HTMLFormElement} */ ($('add-account-form'));
const addFormTitle = $('add-form-title');
const accNameInput = /** @type {HTMLInputElement} */ ($('acc-name'));
const accEmailInput = /** @type {HTMLInputElement} */ ($('acc-email'));
const accRoleInput = /** @type {HTMLInputElement} */ ($('acc-role'));
const btnCancelAdd = $('btn-cancel-add');

/** @type {'google' | 'microsoft' | 'local'} */
let selectedProvider = 'local';

if (accountBtn && accountDialog) {
  accountBtn.addEventListener('click', () => {
    accountDialog.showModal();
  });
}
if (accountDialogClose && accountDialog) {
  accountDialogClose.addEventListener('click', () => {
    accountDialog.close();
  });
}
if (accountDialog) {
  accountDialog.addEventListener('click', (e) => {
    if (e.target === accountDialog) accountDialog.close();
  });
}

/** @param {'google' | 'microsoft' | 'local'} provider @param {string} label */
function showAddAccount(provider, label) {
  selectedProvider = provider;
  if (addFormTitle) addFormTitle.textContent = `Add ${label} Account`;
  if (addAccountForm) addAccountForm.hidden = false;
  accNameInput?.focus();
}

$('btn-add-google')?.addEventListener('click', () => showAddAccount('google', 'Google'));
$('btn-add-microsoft')?.addEventListener('click', () => showAddAccount('microsoft', 'Microsoft'));
$('btn-add-local')?.addEventListener('click', () => showAddAccount('local', 'Work / Local'));

if (btnCancelAdd && addAccountForm) {
  btnCancelAdd.addEventListener('click', () => {
    addAccountForm.hidden = true;
    addAccountForm.reset();
  });
}

if (addAccountForm) {
  addAccountForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = accNameInput?.value.trim();
    const email = accEmailInput?.value.trim();
    const role = accRoleInput?.value.trim();
    if (!name || !email) return;

    try {
      await api.addAccount({
        name,
        email,
        role: role || (selectedProvider === 'google' ? 'Google Workspace' : selectedProvider === 'microsoft' ? 'Microsoft 365' : 'Local User'),
        provider: selectedProvider,
      });
      addAccountForm.hidden = true;
      addAccountForm.reset();
    } catch (err) {
      console.error('Failed to add account:', err);
    }
  });
}

api.onState(render);
