// Puts the unlocked app together: layout, views, editor, sidebar, global shortcuts, link
// handling and background sync. Everything the views share is passed around as this object.

import { formatDailyTitle } from '../core/dates.js';
import { createBlock } from '../core/outline.js';
import { BlockEditor } from './block-editor.js';
import { BlockSelection } from './selection.js';
import { DragAndDrop } from './drag-drop.js';
import { Sidebar } from './sidebar.js';
import { Layout } from './layout.js';
import { Router } from './router.js';
import { DailyView } from './daily-view.js';
import { PageView } from './page-view.js';
import { AllPagesView } from './all-pages-view.js';
import { GraphView } from './graph-view.js';
import { SettingsView } from './settings-view.js';
import { SearchPalette } from './search-palette.js';
import { DatePicker } from './date-picker.js';
import { TouchToolbar } from './touch-toolbar.js';
import { testBanner } from './test-banner.js';
import { infoDialog, toast } from './dialogs.js';
import { clear, h, isModKey, modLabel } from './dom.js';

const SYNC_INTERVAL = 60_000;

export class App {
  /**
   * @param {{root: HTMLElement, store: import('../data/store.js').Store, mode: 'normal'|'test',
   *   account: object|null, onTestReset?: () => Promise<void>}} options
   */
  constructor({ root, store, mode, account, onTestReset }) {
    this.root = root;
    this.store = store;
    this.mode = mode;
    this.account = account;
    this.onTestReset = onTestReset;
    /** Every mounted OutlineView; re-rendered when their page changes. */
    this.views = new Set();
    /** Every mounted PageView (main column, daily stream, sidebar). */
    this.pageViews = new Set();
    /** Reference filters per page title, kept for the session. */
    this.referenceFilters = new Map();
    this.mainView = null;
    this.currentRoute = null;

    this.editor = new BlockEditor(this);
    this.selection = new BlockSelection(this);
    this.dragDrop = new DragAndDrop(this);
    this.datePicker = new DatePicker();
    this.touchToolbar = new TouchToolbar(this);
    this.sidebar = new Sidebar(this);
    this.palette = new SearchPalette(this);
    this.layout = new Layout(this, { banner: mode === 'test' ? testBanner({ onReset: () => this.resetTestData() }) : null });

    clear(root).classList.remove('boot');
    root.append(this.layout.root);
    this.applySettings();
    this.layout.renderShortcuts();
    this.layout.setStatus({ state: store.state, pending: store.pendingCount });

    store.addEventListener('pages', (event) => this.onPagesChanged(event.detail.ids, event.detail.origin));
    store.addEventListener('settings', () => {
      this.applySettings();
      this.layout.renderShortcuts();
      for (const view of this.pageViews) view.renderHeader();
    });
    store.addEventListener('status', (event) => this.layout.setStatus(event.detail));
    store.addEventListener('notice', (event) => toast(event.detail.message));

    document.addEventListener('click', (event) => this.onLinkClick(event));
    document.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('focus', () => this.sync());
    window.addEventListener('beforeunload', (event) => {
      if (!store.hasUnsavedChanges) return;
      store.flush();
      event.preventDefault();
      event.returnValue = '';
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') store.flush().catch(() => {});
      else this.sync();
    });
    this.syncTimer = setInterval(() => this.sync(), SYNC_INTERVAL);

    this.router = new Router((route) => this.showRoute(route));
    this.showRoute(this.router.current(), { initial: true });
  }

  /** Options for rendering markdown (render.js). */
  renderOptions() {
    // Brackets are always rendered and hidden with CSS (.no-brackets), so the setting applies at once.
    return { idForTitle: (title) => this.store.idForTitle(title) };
  }

  applySettings() {
    const settings = this.store.settings;
    const html = document.documentElement;
    if (settings.theme === 'light' || settings.theme === 'dark') html.dataset.theme = settings.theme;
    else delete html.dataset.theme;
    html.dataset.noteFont = settings.noteFont === 'sans' ? 'sans' : 'serif';
    html.classList.toggle('no-brackets', !settings.showBrackets);
    try {
      localStorage.setItem(`silva-mentis:${this.mode}:theme`, settings.theme);
    } catch {
      // storage may be unavailable (private windows); the theme then follows the system on boot
    }
    if (!settings.showTitleInTab) document.title = 'silva-mentis';
  }

  // ── navigation ──────────────────────────────────────────────────────────────────────────

  /**
   * Shows a page in the main column, or in the sidebar.
   * @param {string} pageId
   * @param {{sidebar?: boolean, focus?: boolean}} [options]
   */
  openPage(pageId, { sidebar = false, focus = false } = {}) {
    if (sidebar) {
      this.sidebar.open(pageId);
      return;
    }
    this.pendingFocus = focus;
    this.router.go({ name: 'page', pageId });
  }

  /** Opens the daily page of any date. */
  openDate(date) {
    this.openPage(this.store.idForTitle(formatDailyTitle(date)));
  }

  showRoute(route, { initial = false } = {}) {
    if (this.store.titleOf(route.pageId) === undefined && route.name === 'page') {
      if (!initial) toast('That page no longer exists.');
      route = { name: 'daily' };
    }
    if (this.editor.target) this.editor.close();
    this.selection.clear();
    this.mainView?.destroy();
    this.currentRoute = route;
    const main = this.layout.main;
    clear(main);
    main.className = `main panel view-${route.name}`;
    document.title = 'silva-mentis';

    switch (route.name) {
      case 'page':
        this.mainView = new PageView(this, route.pageId);
        break;
      case 'pages':
        this.mainView = new AllPagesView(this);
        break;
      case 'graph':
        this.mainView = new GraphView(this);
        break;
      case 'settings':
        this.mainView = new SettingsView(this);
        break;
      default:
        this.mainView = new DailyView(this);
    }
    main.append(h('div', { class: route.name === 'graph' ? 'graph-column' : 'column' }, this.mainView.element));
    main.scrollTop = 0;
    this.layout.setActive(route.name, route.pageId ?? null);
    if (route.name === 'page') {
      this.mainView.renderHeader();
      if (this.store.settings.showTitleInTab) document.title = `${this.store.titleOf(route.pageId)} · silva-mentis`;
      if (this.pendingFocus) this.focusFirstBlock(this.mainView.outline);
    } else if (route.name === 'daily' && window.matchMedia('(pointer: fine)').matches) {
      this.mainView.focusToday();
    }
    this.pendingFocus = false;
  }

  focusFirstBlock(outline) {
    const first = outline.visibleIds()[0];
    if (first) this.editor.open(outline, first);
    else outline.startWriting();
  }

  isMainPage(pageView) {
    return this.mainView === pageView;
  }

  afterPageDeleted(pageId) {
    for (const card of [...this.sidebar.cards]) if (card.pageId === pageId) this.sidebar.close(card);
    if (this.currentRoute?.pageId === pageId) this.router.go({ name: 'daily' });
    toast('Page deleted.');
  }

  afterPageMerged(sourceId, targetId) {
    this.sidebar.replacePage(sourceId, targetId);
    if (this.currentRoute?.pageId === sourceId) this.openPage(targetId);
  }

  // ── reacting to changes ─────────────────────────────────────────────────────────────────

  onPagesChanged(ids, origin) {
    if (origin === 'typing') return; // the editor shows the text; everything else updates on commit
    for (const view of [...this.views]) {
      if (ids.includes(view.pageId) && this.views.has(view)) view.render();
    }
    for (const view of [...this.pageViews]) {
      if (this.pageViews.has(view)) view.update(ids, origin);
    }
    if (this.mainView && !(this.mainView instanceof PageView) && !(this.mainView instanceof DailyView)) {
      this.mainView.update?.(ids, origin);
    }
    this.sidebar.update(ids, origin);
    if (origin !== 'commit') this.layout.renderShortcuts();
    if (origin === 'sync' && this.currentRoute?.pageId && this.store.titleOf(this.currentRoute.pageId) === undefined) {
      this.router.go({ name: 'daily' });
    }
  }

  async sync() {
    if (this.mainView instanceof DailyView && this.mainView.isStale() && !this.editor.target) {
      this.showRoute(this.currentRoute); // a new day began
    }
    try {
      await this.store.sync();
    } catch (error) {
      if (error.status === 401) this.store.emit('locked', {});
    }
  }

  // ── links and keys ──────────────────────────────────────────────────────────────────────

  /** Page links anywhere: click opens, Shift+click opens in the sidebar. */
  onLinkClick(event) {
    const link = event.target.closest?.('a[href^="#/p/"]');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const title = link.dataset.pageTitle;
    const pageId = title !== undefined ? this.store.idForTitle(title) : link.getAttribute('href').slice(4);
    if (this.editor.target) this.editor.close();
    this.openPage(pageId, { sidebar: event.shiftKey });
  }

  onKeyDown(event) {
    const mod = isModKey(event);
    if (mod && !event.shiftKey && !event.altKey && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault();
      this.palette.open();
      return;
    }
    const typing = event.target.closest?.('input, textarea, [contenteditable], dialog');
    if (typing) return;
    if (event.key === '?' && !mod) {
      event.preventDefault();
      this.showShortcuts();
    } else if (event.key === 'Escape') {
      this.layout.toggleNav(false);
    }
  }

  showShortcuts() {
    const mod = modLabel();
    const rows = [
      ['Enter', 'New bullet (split at the caret)'],
      ['Shift Enter', 'Line break inside a bullet'],
      ['Tab / Shift Tab', 'Indent / outdent'],
      ['Alt Shift ↑ / ↓', 'Move bullet up / down'],
      [`${mod} ↑ / ↓`, 'Collapse / expand children'],
      [`${mod} Enter`, 'Cycle task: none → [ ] → [x]'],
      [`${mod} B / I / H`, 'Bold / italic / highlight'],
      ['[[', 'Link to a page'],
      ['#', 'Tag a page'],
      ['/', 'Commands: dates, task, headings, template…'],
      ['Esc', 'Stop editing, select the bullet'],
      [`${mod} Z / ${mod} Shift Z`, 'Undo / redo'],
      [`${mod} K`, 'Search or create a page'],
      ['Shift click', 'Open a link in the sidebar'],
      ['?', 'This overview'],
    ];
    infoDialog({
      title: 'Keyboard shortcuts',
      wide: true,
      content: [h('table', { class: 'shortcut-table' }, rows.map(([keys, action]) => h('tr', null, h('td', null, h('kbd', null, keys)), h('td', null, action))))],
    });
  }

  // ── data actions used by settings ───────────────────────────────────────────────────────

  /**
   * Adds imported pages. Pages whose title exists get the imported bullets appended.
   * @returns {number} how many pages were created or extended
   */
  importPages(pages) {
    let count = 0;
    for (const imported of pages) {
      if (imported.blocks.length === 0) continue;
      const existing = this.store.index.pageByTitle(imported.title);
      if (existing) {
        this.store.updatePage(existing.id, (blocks) => {
          if (blocks.length === 1 && blocks[0].text === '' && blocks[0].children.length === 0) blocks.splice(0, 1);
          blocks.push(...imported.blocks);
        }, { origin: 'import' });
      } else {
        this.store.createPage(imported.title, imported.blocks.length ? imported.blocks : [createBlock('')], {
          created: imported.created ?? undefined,
          updated: imported.updated ?? undefined,
        });
      }
      count += 1;
    }
    this.store.flush().catch(() => {});
    return count;
  }

  async resetTestData() {
    await this.onTestReset?.();
  }

  destroy() {
    clearInterval(this.syncTimer);
    this.router.destroy();
    this.store.dispose();
  }
}
