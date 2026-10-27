// The right sidebar: pages opened with Shift+click, stacked as cards, each fully editable.
// New cards go on top; opening a page that is already there moves its card to the top.

import { clear, h, icon } from './dom.js';
import { PageView } from './page-view.js';
import { GraphCanvas } from './graph-view.js';
import { renderTitle } from './render.js';

export class Sidebar {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    /** @type {Array<{key: string, pageId: string, kind: 'page'|'graph', folded: boolean, element: HTMLElement, view: any}>} */
    this.cards = [];
    this.list = h('div', { class: 'side-cards' });
    this.element = h('aside', { class: 'side', 'aria-label': 'Sidebar', hidden: true },
      h('div', { class: 'side-tools' },
        h('span', null, 'Sidebar'),
        h('button', { class: 'text-btn', type: 'button', onclick: () => this.closeAll() }, 'Close all')),
      this.list);
  }

  /** Opens (or moves to the top) a page card. */
  open(pageId) {
    this.openCard(`page ${pageId}`, pageId, 'page');
  }

  /** Opens a local graph card: the page and its direct neighbours. */
  openGraph(pageId) {
    this.openCard(`graph ${pageId}`, pageId, 'graph');
  }

  openCard(key, pageId, kind) {
    const existing = this.cards.find((card) => card.key === key);
    if (existing) {
      this.cards = [existing, ...this.cards.filter((card) => card !== existing)];
      existing.folded = false;
    } else {
      const card = { key, pageId, kind, folded: false, element: h('section', { class: 'side-item panel' }), view: null };
      card.view = kind === 'page'
        ? new PageView(this.app, pageId, { header: false })
        : new GraphCanvas(this.app, { focusId: pageId, local: true });
      this.cards.unshift(card);
    }
    this.render();
    this.app.layout.setSidebarOpen(true);
    this.list.scrollTop = 0;
  }

  close(card) {
    card.view.destroy();
    this.cards = this.cards.filter((c) => c !== card);
    this.render();
    if (this.cards.length === 0) this.app.layout.setSidebarOpen(false);
  }

  closeAll() {
    for (const card of this.cards) card.view.destroy();
    this.cards = [];
    this.render();
    this.app.layout.setSidebarOpen(false);
  }

  /** Replaces a page id in open cards (after a merge). */
  replacePage(oldId, newId) {
    for (const card of [...this.cards]) if (card.pageId === oldId) this.close(card);
    if (oldId !== newId) this.open(newId);
  }

  /** Re-renders headers (titles and counts change when pages change) and graph cards. */
  update(ids, origin) {
    if (origin === 'typing') return;
    for (const card of this.cards) {
      this.renderHeader(card);
      if (card.kind === 'graph') card.view.update(ids, origin);
    }
  }

  render() {
    const editor = this.app.editor;
    const editing = this.cards.find((card) => card.kind === 'page' && card.element.contains(editor.textarea));
    if (editing) editor.beginMove();
    clear(this.list);
    for (const card of this.cards) {
      this.renderHeader(card);
      this.list.append(card.element);
    }
    if (editing) editor.reattach(editor.target.view);
    this.element.hidden = this.cards.length === 0;
  }

  renderHeader(card) {
    const store = this.app.store;
    const title = store.titleOf(card.pageId);
    if (title === undefined) {
      // The page was deleted and nothing links to it any more.
      queueMicrotask(() => this.close(card));
      return;
    }
    const count = store.index.referenceCount(title);
    const header = h('header', null,
      h('button', {
        class: 'side-btn',
        type: 'button',
        'aria-label': card.folded ? 'Unfold' : 'Fold',
        'aria-expanded': card.folded ? 'false' : 'true',
        onclick: () => {
          card.folded = !card.folded;
          this.render();
        },
      }, icon(card.folded ? 'plus' : 'minus')),
      h('h4', null,
        card.kind === 'graph' ? h('span', { class: 'card-kind' }, 'Graph · ') : null,
        h('a', { class: 'card-title', href: `#/p/${card.pageId}` }, renderTitle(title, { ...this.app.renderOptions(), showBrackets: false }))),
      count ? h('span', { class: 'count', title: 'Linked references' }, String(count)) : null,
      h('button', { class: 'side-btn', type: 'button', 'aria-label': 'Close', onclick: () => this.close(card) }, icon('close')));
    const body = card.view.element;
    body.hidden = card.folded;
    card.element.classList.toggle('folded', card.folded);
    clear(card.element).append(header, body);
  }
}
