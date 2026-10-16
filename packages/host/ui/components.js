/**
 * @param {string} tag
 * @param {Record<string, string>} [attrs]
 * @param {(Node | string)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const child of children) node.append(child);
  return node;
}

/**
 * @param {string} str
 * @returns {string}
 */
export function hashColor(str) {
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
export function createAppIcon(app, size = 'normal') {
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
export function renderAppItem(app) {
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
export function renderDockItem(app) {
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
export function renderDrawerItem(app) {
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
export function renderWidgetItem(widget) {
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
export function renderCatalogItem(r) {
  const meta = el('div', { class: 'catalog-info' }, [
    el('strong', {}, [r.title]),
    el('span', { class: 'catalog-ver quiet' }, [` v${r.latest}`]),
    el('p', { class: 'catalog-desc' }, [r.description || 'No description provided.']),
  ]);

  const actions = el('div', { class: 'catalog-actions' });
  if (r.installed) {
    if (r.canUpdate) {
      actions.appendChild(el('button', {
        class: 'btn-action btn-update primary',
        'data-action': 'install',
        'data-id': r.id,
      }, [`Update to ${r.latest}`]));
    }
    if (r.canRollback) {
      actions.appendChild(el('button', {
        class: 'btn-action btn-rollback',
        'data-action': 'rollback',
        'data-id': r.id,
      }, ['Rollback']));
    }
    if (!r.protected) {
      actions.appendChild(el('button', {
        class: 'btn-action btn-uninstall',
        'data-action': 'uninstall',
        'data-id': r.id,
      }, ['Uninstall']));
    }
  } else {
    actions.appendChild(el('button', {
      class: 'btn-action btn-install primary',
      'data-action': 'install',
      'data-id': r.id,
    }, ['Install']));
  }

  const row = el('li', { class: 'catalog-row' }, [
    createAppIcon(r, 'small'),
    meta,
    actions,
  ]);
  return row;
}
