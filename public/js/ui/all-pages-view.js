// All pages: a sortable table of every page, including pages that exist only because something
// links to them.

import { clear, h, icon } from './dom.js';

const COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'references', label: 'Linked refs', numeric: true },
  { key: 'updated', label: 'Last edited', numeric: true },
  { key: 'created', label: 'Created', numeric: true },
];

export class AllPagesView {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    this.sort = { key: 'updated', descending: true };
    this.query = '';
    this.showDaily = false;
    this.table = h('table', { class: 'pages' });
    this.countLabel = h('span', { class: 'muted' });
    const filter = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Filter pages',
      'aria-label': 'Filter pages',
      oninput: (event) => {
        this.query = event.target.value.trim().toLowerCase();
        this.render();
      },
    });
    const daily = h('label', { class: 'toggle-label' },
      h('input', {
        type: 'checkbox',
        class: 'switch-input',
        onchange: (event) => {
          this.showDaily = event.target.checked;
          this.render();
        },
      }),
      h('span', { class: 'switch', 'aria-hidden': 'true' }),
      'Daily notes');
    this.element = h('div', { class: 'all-pages' },
      h('div', { class: 'list-head' }, h('h1', { class: 'page-title' }, 'All pages'), this.countLabel),
      h('div', { class: 'list-tools' }, filter, daily),
      h('div', { class: 'table-wrap' }, this.table));
    this.render();
  }

  update(ids, origin) {
    if (origin !== 'typing') this.render();
  }

  render() {
    const store = this.app.store;
    let rows = store.index.listPages();
    if (!this.showDaily) rows = rows.filter((row) => !row.daily);
    if (this.query) rows = rows.filter((row) => row.title.toLowerCase().includes(this.query));
    const { key, descending } = this.sort;
    rows.sort((a, b) => {
      const order = key === 'title' ? a.title.localeCompare(b.title) : (a[key] ?? -1) - (b[key] ?? -1);
      return (descending ? -order : order) || a.title.localeCompare(b.title);
    });
    this.countLabel.textContent = `${rows.length} page${rows.length === 1 ? '' : 's'}`;

    const shortcuts = store.settings.shortcuts;
    const header = h('tr', null,
      h('th', { class: 'star', 'aria-label': 'Shortcut' }),
      COLUMNS.map((column) => h('th', {
        class: [column.numeric && 'num', key === column.key && 'sorted'],
        'aria-sort': key === column.key ? (descending ? 'descending' : 'ascending') : null,
      }, h('button', {
        type: 'button',
        class: 'th-btn',
        onclick: () => {
          this.sort = { key: column.key, descending: this.sort.key === column.key ? !this.sort.descending : column.key !== 'title' };
          this.render();
        },
      }, column.label, key === column.key ? (descending ? ' ↓' : ' ↑') : ''))));
    const body = rows.map((row) => h('tr', null,
      h('td', { class: 'star' }, h('button', {
        class: ['icon-btn', 'small', shortcuts.includes(row.id) && 'on'],
        type: 'button',
        'aria-label': shortcuts.includes(row.id) ? 'Remove from shortcuts' : 'Add to shortcuts',
        onclick: () => store.toggleShortcut(row.id),
      }, icon('star', { filled: shortcuts.includes(row.id) }))),
      h('td', { class: 'title' }, h('a', { href: `#/p/${row.id}`, 'data-page-title': row.title, class: 'page-link' }, row.title),
        row.virtual ? h('span', { class: 'muted virtual', title: 'Exists only through links' }, ' · linked only') : null),
      h('td', { class: 'num' }, String(row.references)),
      h('td', { class: 'num' }, formatDate(row.updated)),
      h('td', { class: 'num' }, formatDate(row.created))));
    clear(this.table).append(h('thead', null, header), h('tbody', null, body));
    if (rows.length === 0) this.table.append(h('tbody', null, h('tr', null, h('td', { colspan: '5', class: 'empty-hint' }, 'No pages match.'))));
  }

  destroy() {}
}

function formatDate(time) {
  if (!time) return '—';
  return new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
