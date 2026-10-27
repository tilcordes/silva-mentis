// Ctrl+K: search or create a page. Titles first (exact, prefix, word prefix, anywhere), then
// bullets containing every word. Enter opens, Shift+Enter opens in the sidebar.

import { searchBlocks, searchTitles } from '../core/search.js';
import { clear, h, icon } from './dom.js';

export class SearchPalette {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    this.input = h('input', {
      class: 'palette-input',
      type: 'search',
      placeholder: 'Search or create a page',
      'aria-label': 'Search or create a page',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.results = h('div', { class: 'palette-results', role: 'listbox' });
    this.dialog = h('dialog', { class: 'dialog palette', 'aria-label': 'Search' },
      h('div', { class: 'palette-field' }, icon('search'), this.input),
      this.results);
    this.items = [];
    this.selected = 0;
    this.input.addEventListener('input', () => this.search());
    this.input.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close(); // click on the backdrop
    });
    document.body.append(this.dialog);
  }

  open(initial = '') {
    if (this.app.editor.target) this.app.editor.close();
    this.input.value = initial;
    this.search();
    if (!this.dialog.open) this.dialog.showModal();
    this.input.focus();
    this.input.select();
  }

  close() {
    if (this.dialog.open) this.dialog.close();
  }

  search() {
    const query = this.input.value.trim();
    const index = this.app.store.index;
    const titles = searchTitles(index, query, 8);
    const blocks = query.length >= 2 ? searchBlocks(index, query, 12) : [];
    this.items = [];
    clear(this.results);
    if (!query) {
      this.results.append(h('p', { class: 'palette-hint' }, 'Type to search titles and bullets. Enter opens, Shift+Enter opens in the sidebar.'));
      return;
    }
    if (titles.length) this.results.append(h('div', { class: 'palette-section' }, 'Pages'));
    for (const result of titles) {
      this.addItem({ pageId: result.id }, [h('span', { class: 'label' }, result.title), h('span', { class: 'n' }, String(result.references))]);
    }
    if (!titles.some((result) => result.title === query)) {
      this.addItem({ create: query }, [h('span', { class: 'label' }, `Create page “${query}”`)], 'create');
    }
    if (blocks.length) this.results.append(h('div', { class: 'palette-section' }, 'Bullets'));
    for (const result of blocks) {
      this.addItem({ pageId: result.pageId }, [
        h('span', { class: 'label snippet' }, result.snippet || '…'),
        h('span', { class: 'n' }, result.title),
      ], 'block');
    }
    this.highlight(0);
  }

  addItem(target, children, kind = '') {
    const index = this.items.length;
    this.items.push(target);
    this.results.append(h('div', {
      class: ['suggestion', kind],
      role: 'option',
      onclick: (event) => this.choose(index, event.shiftKey),
      onmousemove: () => this.highlight(index),
    }, children));
  }

  highlight(index) {
    const options = this.results.querySelectorAll('.suggestion');
    options.forEach((option, i) => {
      option.classList.toggle('sel', i === index);
      option.setAttribute('aria-selected', i === index ? 'true' : 'false');
    });
    options[index]?.scrollIntoView({ block: 'nearest' });
    this.selected = index;
  }

  onKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.items.length) this.highlight((this.selected + (event.key === 'ArrowDown' ? 1 : -1) + this.items.length) % this.items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.choose(this.selected, event.shiftKey);
    }
  }

  choose(index, inSidebar) {
    const item = this.items[index];
    if (!item) return;
    this.close();
    let pageId = item.pageId;
    if (item.create !== undefined) pageId = this.app.store.createPage(item.create).id;
    if (inSidebar) this.app.sidebar.open(pageId);
    else this.app.openPage(pageId, { focus: item.create !== undefined });
  }
}
