// Host UI. Renders app tiles and widget descriptors with DOM APIs and textContent only:
// app-provided strings are never parsed as HTML.
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

/** @param {string} appId @param {string} widgetId @param {any} block */
function renderBlock(appId, widgetId, block) {
  switch (block.type) {
    case 'text': return el('p', {}, [String(block.text)]);
    case 'metric':
      return el('div', { class: 'metric', 'data-tone': block.tone ?? 'neutral' }, [
        el('span', {}, [String(block.label)]), el('br'), el('b', {}, [String(block.value)]), block.unit ? ` ${block.unit}` : '',
      ]);
    case 'list':
      return el('ul', {}, block.items.map((/** @type {any} */ i) => el('li', {}, [el('span', {}, [String(i.label)]), el('span', {}, [String(i.value ?? '')])])));
    case 'actions':
      return el('div', { class: 'actions' }, block.actions.map((/** @type {any} */ a) => {
        const button = el('button', {}, [String(a.label)]);
        button.addEventListener('click', () => api.widgetAction(appId, widgetId, a.id));
        return button;
      }));
    default: return el('span');
  }
}

/** @param {any} state */
function render(state) {
  document.title = state.product;
  $('title').textContent = state.title ?? state.product;
  document.body.classList.toggle('app-open', Boolean(state.active));
  /** @type {HTMLButtonElement} */ ($('back')).disabled = !state.active;
  /** @type {HTMLButtonElement} */ ($('close')).disabled = !state.active;

  $('apps').replaceChildren(...state.apps.map((/** @type {any} */ a) => {
    const button = el('button', {}, [
      a.running ? el('span', { class: 'badge', title: 'Running' }, ['●']) : '',
      el('strong', {}, [a.title]),
      el('span', {}, [a.publisher + (a.protected ? ' · core' : '')]),
    ]);
    button.addEventListener('click', () => api.open(a.id));
    return el('li', {}, [button]);
  }));

  $('widgets').replaceChildren(...state.widgets.map((/** @type {any} */ w) => {
    const from = state.apps.find((/** @type {any} */ a) => a.id === w.appId)?.title ?? w.appId;
    return el('article', { class: 'widget' }, [
      el('h3', {}, [w.title]),
      from === w.title ? '' : el('span', { class: 'from' }, [from]),
      ...w.descriptor.blocks.map((/** @type {any} */ b) => renderBlock(w.appId, w.widgetId, b)),
    ]);
  }));
  $('no-widgets').hidden = state.widgets.length > 0;
  renderCatalog(state.manager);
}

/** @param {{ rows: any[], error: string | null, actionError: string | null }} manager */
function renderCatalog(manager) {
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
  $('catalog').replaceChildren(...manager.rows.map((r) => {
    const status = r.installed
      ? `${r.installed} installed${r.latest && r.latest !== r.installed ? ` · ${r.latest} available` : ''}`
      : r.latest ? `${r.latest} available` : 'No release in this channel';
    return el('li', {}, [
      el('div', { class: 'info' }, [el('strong', {}, [r.title]), el('span', {}, [`${r.publisher} · ${status}`])]),
      !r.installed && r.latest ? action('Install', () => api.install(r.id), true) : '',
      r.installed && r.latest && r.latest !== r.installed ? action(`Update to ${r.latest}`, () => api.install(r.id), true) : '',
      r.previous ? action(`Roll back to ${r.previous}`, () => api.rollback(r.id)) : '',
      r.installed ? action('Remove', () => api.uninstall(r.id)) : '',
    ]);
  }));
  $('no-catalog').hidden = manager.rows.length > 0;
}

$('back').addEventListener('click', () => api.back());
$('home').addEventListener('click', () => api.home());
$('close').addEventListener('click', () => api.close());
$('refresh').addEventListener('click', () => api.refreshCatalog());
api.onState(render);
