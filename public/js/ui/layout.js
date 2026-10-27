// The app shell: navigation on the left (search, daily notes, all pages, graph, shortcuts,
// save status, settings), the main column, and the right sidebar. On narrow screens the
// navigation becomes a drawer and the sidebar a full-screen sheet.

import { clear, h, icon, modLabel } from './dom.js';

const STATUS_TEXT = {
  saved: () => 'Saved',
  saving: () => 'Saving…',
  offline: (pending) => `Offline – ${pending} change${pending === 1 ? '' : 's'} waiting`,
  conflict: () => 'Conflict – a copy was created',
};

export class Layout {
  /**
   * @param {object} app
   * @param {{banner?: HTMLElement|null}} [options]
   */
  constructor(app, { banner = null } = {}) {
    this.app = app;
    this.links = {
      daily: h('a', { href: '#/daily' }, 'Daily notes'),
      pages: h('a', { href: '#/pages' }, 'All pages'),
      graph: h('a', { href: '#/graph' }, 'Graph'),
    };
    this.shortcuts = h('div', { class: 'nav-list shortcuts' });
    this.status = h('button', {
      class: 'status saved',
      type: 'button',
      title: 'Save status',
      onclick: () => app.store.acknowledgeConflict(),
    }, 'Saved');
    this.settingsLink = h('a', { href: '#/settings', class: 'settings-link' }, 'Settings');

    this.nav = h('nav', { class: 'nav', 'aria-label': 'Navigation' },
      h('button', { class: 'search', type: 'button', onclick: () => app.palette.open() },
        icon('search'), h('span', null, 'Search or create a page'), h('kbd', null, `${modLabel()} K`)),
      h('div', { class: 'nav-list' },
        h('div', { class: 'nav-row' },
          this.links.daily,
          h('button', {
            class: 'icon-btn small',
            type: 'button',
            'aria-label': 'Open a date',
            title: 'Open a date',
            onclick: (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              app.datePicker.open({ anchor: { left: rect.left, top: rect.top, bottom: rect.bottom }, onPick: (date) => app.openDate(date) });
            },
          }, icon('calendar'))),
        this.links.pages,
        this.links.graph),
      h('div', { class: 'nav-section' }, h('div', { class: 'nav-label' }, 'Shortcuts'), this.shortcuts),
      h('div', { class: 'nav-foot' }, this.status, this.settingsLink));

    this.main = h('main', { class: 'main panel', id: 'main', tabindex: '-1' });
    this.topTitle = h('span', { class: 'title' });
    this.topbar = h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Menu', onclick: () => this.toggleNav() }, icon('menu')),
      this.topTitle,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Search', onclick: () => app.palette.open() }, icon('search')));
    this.scrim = h('div', { class: 'scrim', onclick: () => this.toggleNav(false) });
    this.root = h('div', { class: ['shell', banner && 'test'] }, banner, this.topbar, this.nav, this.main, app.sidebar.element, this.scrim);
    this.nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) this.toggleNav(false);
    });
  }

  /** Marks the current place in the navigation. */
  setActive(name, pageId = null) {
    for (const [key, link] of Object.entries(this.links)) link.classList.toggle('active', key === name);
    this.settingsLink.classList.toggle('active', name === 'settings');
    for (const link of this.shortcuts.querySelectorAll('a')) link.classList.toggle('active', link.dataset.pageId === pageId);
    const labels = { daily: 'Daily notes', pages: 'All pages', graph: 'Graph', settings: 'Settings' };
    this.topTitle.textContent = labels[name] ?? '';
  }

  renderShortcuts() {
    const store = this.app.store;
    clear(this.shortcuts);
    const ids = store.settings.shortcuts.filter((id) => store.titleOf(id) !== undefined);
    if (ids.length === 0) {
      this.shortcuts.append(h('p', { class: 'empty-hint' }, 'Star a page to keep it here.'));
      return;
    }
    for (const id of ids) {
      this.shortcuts.append(h('a', { href: `#/p/${id}`, 'data-page-id': id, title: store.titleOf(id) }, store.titleOf(id)));
    }
    const route = this.app.currentRoute;
    if (route) this.setActive(route.name, route.pageId);
  }

  /** @param {{state: string, pending: number}} status */
  setStatus({ state, pending }) {
    this.status.className = `status ${state}`;
    this.status.textContent = STATUS_TEXT[state]?.(pending) ?? state;
  }

  setSidebarOpen(open) {
    this.root.classList.toggle('with-side', open);
  }

  toggleNav(open = !this.root.classList.contains('nav-open')) {
    this.root.classList.toggle('nav-open', open);
  }
}
