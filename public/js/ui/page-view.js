// One page: its title (editable, which renames or merges), the star for shortcuts, the page menu,
// the outline, and below it linked and unlinked references.

import { isDailyTitle } from '../core/dates.js';
import { pageToMarkdown, safeFileName } from '../core/markdown-file.js';
import { confirmDialog, popupMenu, toast } from './dialogs.js';
import { downloadFile, h, icon, replaceChildren } from './dom.js';
import { OutlineView } from './outline-view.js';
import { ReferencesView } from './references-view.js';
import { renderTitle } from './render.js';

export class PageView {
  /**
   * @param {object} app
   * @param {string} pageId real or virtual page id
   * @param {{header?: boolean, references?: 'expanded'|'collapsed'|'none', titleLevel?: 'h1'|'h2'}} [options]
   */
  constructor(app, pageId, { header = true, references = 'expanded', titleLevel = 'h1' } = {}) {
    this.app = app;
    this.pageId = pageId;
    this.titleLevel = titleLevel;
    this.editingTitle = false;
    this.outline = new OutlineView(app, { pageId });
    this.references = references === 'none' ? null : new ReferencesView(app, pageId, { collapsed: references === 'collapsed' });
    this.header = header ? h('header', { class: 'page-head' }) : null;
    this.element = h('article', { class: 'page', 'data-page-id': pageId },
      this.header, this.outline.element, this.references?.element);
    app.pageViews.add(this);
    this.renderHeader();
  }

  get title() {
    return this.app.store.titleOf(this.pageId) ?? '';
  }

  /** Called by the app after pages changed. */
  update(ids, origin) {
    if (origin === 'typing') return;
    if (ids.includes(this.pageId) && !this.editingTitle) this.renderHeader();
    this.references?.update(ids, origin);
  }

  renderHeader() {
    if (!this.header) return;
    const title = this.title;
    const starred = this.app.store.settings.shortcuts.includes(this.pageId);
    const heading = h(this.titleLevel, {
      class: 'page-title',
      tabindex: '0',
      title: 'Click to rename',
      onclick: (event) => {
        if (!event.target.closest('a')) this.editTitle();
      },
      onkeydown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.editTitle();
        }
      },
    }, renderTitle(title, this.app.renderOptions()));
    const star = h('button', {
      class: ['icon-btn', 'star-btn', starred && 'on'],
      type: 'button',
      'aria-pressed': starred ? 'true' : 'false',
      'aria-label': starred ? 'Remove from shortcuts' : 'Add to shortcuts',
      title: starred ? 'Remove from shortcuts' : 'Add to shortcuts',
      onclick: () => this.app.store.toggleShortcut(this.pageId),
    }, icon('star', { filled: starred }));
    const more = h('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': 'Page menu',
      title: 'Page menu',
      onclick: (event) => this.openMenu(event.currentTarget),
    }, icon('more'));
    replaceChildren(this.header, heading, h('div', { class: 'page-tools' }, star, more));
    if (this.app.store.settings.showTitleInTab && this.app.isMainPage?.(this)) document.title = `${title} · silva-mentis`;
  }

  openMenu(anchor) {
    popupMenu(anchor, [
      { label: 'Open in sidebar', action: () => this.app.sidebar.open(this.pageId) },
      { label: 'Show local graph', action: () => this.app.sidebar.openGraph(this.pageId) },
      { label: 'Export as markdown', action: () => this.exportMarkdown() },
      { label: 'Delete page', danger: true, action: () => this.deletePage() },
    ]);
  }

  exportMarkdown() {
    const page = this.app.store.getPage(this.pageId);
    if (!page) {
      toast('This page has no content yet.');
      return;
    }
    downloadFile(safeFileName(page.title, new Set()), new TextEncoder().encode(pageToMarkdown(page)), 'text/markdown;charset=utf-8');
  }

  async deletePage() {
    const title = this.title;
    const references = this.app.store.index.referenceCount(title);
    const ok = await confirmDialog({
      title: `Delete “${title}”?`,
      message: references
        ? `Its content will be deleted. The ${references} links to it stay and show an empty page.`
        : 'Its content will be deleted.',
      confirmLabel: 'Delete page',
      danger: true,
    });
    if (!ok) return;
    this.app.store.deletePage(this.pageId);
    this.app.afterPageDeleted(this.pageId);
  }

  /** Replaces the title with a one-line editor. Enter or leaving it renames; Esc cancels. */
  editTitle() {
    if (this.editingTitle) return;
    this.editingTitle = true;
    const original = this.title;
    const input = h('textarea', { class: 'page-title title-editor', rows: '1', 'aria-label': 'Page title', spellcheck: 'true' });
    input.value = original;
    const resize = () => {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
    };
    let finished = false;
    const finish = async (commit) => {
      if (finished) return;
      finished = true;
      const value = input.value.replace(/\s+/g, ' ').trim();
      this.editingTitle = false;
      if (commit && value !== '' && value !== original) await this.rename(original, value);
      this.renderHeader();
    };
    input.addEventListener('input', () => {
      if (input.value.includes('\n')) input.value = input.value.replace(/\n/g, ' ');
      resize();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    this.header.querySelector('.page-title').replaceWith(input);
    resize();
    input.focus();
    input.select();
  }

  async rename(oldTitle, newTitle) {
    const store = this.app.store;
    if (isDailyTitle(oldTitle)) {
      const ok = await confirmDialog({
        title: 'Rename this daily note?',
        message: 'It will no longer appear among your daily notes.',
        confirmLabel: 'Rename',
      });
      if (!ok) return;
    }
    const existing = store.renameTarget(this.pageId, newTitle);
    if (existing) {
      const ok = await confirmDialog({
        title: `“${existing.title}” already exists`,
        message: `Merge “${oldTitle}” into it? Its bullets are appended there and every link to “${oldTitle}” is changed to “${existing.title}”.`,
        confirmLabel: 'Merge pages',
      });
      if (!ok) return;
      store.mergePage(this.pageId, existing.id);
      this.app.afterPageMerged(this.pageId, existing.id);
      return;
    }
    store.renamePage(this.pageId, newTitle);
  }

  destroy() {
    this.outline.destroy();
    this.references?.destroy();
    this.app.pageViews.delete(this);
  }
}
