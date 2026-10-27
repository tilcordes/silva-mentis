// The Store owns all decrypted data while the app is unlocked: pages (through the PageIndex),
// the settings document, which documents have unsaved changes, the save queue, delta sync,
// conflict handling and undo. Views read from it and change data only through its methods.
//
// Events (store.addEventListener):
//   'pages'    detail {ids: string[], origin}   pages changed (local edit, sync, rename…)
//   'settings' detail {settings}
//   'status'   detail {state, pending}          'saved' | 'saving' | 'offline' | 'conflict'
//   'notice'   detail {message}                 something the user should be told
//   'locked'                                    the server ended the session

import { PageIndex } from '../core/page-index.js';
import { newId } from '../core/ids.js';
import { createBlock, walkBlocks } from '../core/outline.js';
import { renameInText, renameInTitle } from '../core/references.js';
import { defaultTemplates, TEMPLATES_TITLE } from '../core/templates.js';
import { UndoHistory } from './undo.js';

export const SETTINGS_ID = 'settings';
const SAVE_DELAY = 600;
const RETRY_DELAYS = [5000, 15000, 60000];
const TYPING_PAUSE = 1000;

export const DEFAULT_SETTINGS = Object.freeze({
  kind: 'settings',
  shortcuts: [],
  theme: 'system',
  noteFont: 'serif',
  showBrackets: true,
  showTitleInTab: false,
});

export class Store extends EventTarget {
  /**
   * @param {{api: import('./api.js').Api, cipher: {encrypt: Function, decrypt: Function},
   *   now?: () => number, timers?: {set: Function, clear: Function}}} options
   */
  constructor({ api, cipher, now = () => Date.now(), timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) } }) {
    super();
    this.api = api;
    this.cipher = cipher;
    this.now = now;
    this.timers = timers;
    this.index = new PageIndex();
    this.undoHistory = new UndoHistory();
    this.settings = { ...DEFAULT_SETTINGS, shortcuts: [] };
    /** @type {Map<string, number>} document id → last version known from the server */
    this.versions = new Map();
    /** @type {Set<string>} ids of documents with local changes not yet saved */
    this.dirty = new Set();
    /** @type {Set<string>} ids waiting to be deleted on the server */
    this.pendingDeletes = new Set();
    this.cursor = 0;
    this.saveTimer = null;
    this.retryTimer = null;
    this.retryCount = 0;
    this.saving = null;
    this.state = 'saved';
    this.lastTyping = new Map();
    this.hadConflict = false;
  }

  // ── loading and sync ─────────────────────────────────────────────────────────────────────

  /**
   * Downloads and decrypts every document. On a brand-new installation, creates the settings
   * and the Templates page (and asks `seed` for more pages, used by the test version).
   * @param {{seed?: () => Array<{title: string, blocks: object[], shortcut?: boolean}>}} [options]
   */
  async loadAll({ seed } = {}) {
    const { documents, cursor } = await this.api.documents(0);
    for (const document of documents) await this.applyRemote(document);
    this.cursor = cursor;
    if (!this.versions.has(SETTINGS_ID)) {
      this.dirty.add(SETTINGS_ID);
      if (!this.index.pageByTitle(TEMPLATES_TITLE)) this.createPage(TEMPLATES_TITLE, defaultTemplates());
      for (const seeded of seed?.() ?? []) {
        const page = this.createPage(seeded.title, seeded.blocks, seeded);
        if (seeded.shortcut) this.settings.shortcuts.push(page.id);
      }
      await this.flush();
    }
    this.emit('pages', { ids: [...this.index.pages.keys()], origin: 'load' });
  }

  /** Fetches changes made elsewhere since the last sync and applies those that don't clash. */
  async sync() {
    const { documents, cursor } = await this.api.documents(this.cursor);
    const changed = [];
    for (const document of documents) {
      if (this.dirty.has(document.id)) continue; // the pending local save meets the conflict and resolves it
      if ((this.versions.get(document.id) ?? 0) >= document.version) continue; // a write from this client
      if (await this.applyRemote(document)) changed.push(document.id);
    }
    this.cursor = Math.max(this.cursor, cursor);
    if (changed.length) this.emit('pages', { ids: changed, origin: 'sync' });
    return changed;
  }

  /** Puts one server document into memory. @returns {Promise<boolean>} whether anything changed */
  async applyRemote(document) {
    this.versions.set(document.id, document.version);
    if (document.deleted) {
      if (document.id === SETTINGS_ID) return false;
      const existed = this.index.getPage(document.id) !== undefined;
      this.index.removePage(document.id);
      this.undoHistory.forget(document.id);
      return existed;
    }
    let content;
    try {
      content = await this.cipher.decrypt(document.id, document.payload);
    } catch (error) {
      this.emit('notice', { message: `One document could not be decrypted and was skipped (${error.message}).` });
      return false;
    }
    if (document.id === SETTINGS_ID) {
      this.settings = { ...DEFAULT_SETTINGS, ...content, kind: 'settings' };
      this.emit('settings', { settings: this.settings });
      return true;
    }
    if (content?.kind !== 'page' || typeof content.title !== 'string' || !Array.isArray(content.blocks)) return false;
    this.index.setPage({ ...content, id: document.id });
    this.undoHistory.forget(document.id);
    return true;
  }

  // ── reading ──────────────────────────────────────────────────────────────────────────────

  /** @returns {import('../core/page-index.js').Page|undefined} */
  getPage(id) {
    return this.index.getPage(id);
  }

  /** The title of a real or virtual page id. */
  titleOf(id) {
    return this.index.titleForId(id);
  }

  /** @returns {string} the id under which a title is shown (real or virtual) */
  idForTitle(title) {
    return this.index.idForTitle(title);
  }

  // ── changing pages ──────────────────────────────────────────────────────────────────────

  /**
   * Creates a page in memory, or returns the existing page with that title. It is written to
   * the server only once it has content.
   * @param {string} title
   * @param {object[]} [blocks] defaults to one empty block
   * @param {{created?: number, updated?: number}} [times]
   * @returns {import('../core/page-index.js').Page}
   */
  createPage(title, blocks, times = {}) {
    const clean = normaliseTitle(title);
    const existing = this.index.pageByTitle(clean);
    if (existing) return existing;
    const now = this.now();
    const page = {
      kind: 'page',
      id: this.index.idForTitle(clean),
      title: clean,
      created: times.created ?? now,
      updated: times.updated ?? now,
      blocks: blocks?.length ? blocks : [createBlock('')],
    };
    this.index.setPage(page);
    this.markDirty(page.id);
    this.emit('pages', { ids: [page.id], origin: 'create' });
    return page;
  }

  /** Makes sure a real or virtual page id has a page object (virtual pages become real). */
  materialize(id) {
    const existing = this.index.getPage(id);
    if (existing) return existing;
    const title = this.index.titleForId(id);
    if (title === undefined) throw new Error(`Unknown page ${id}`);
    const now = this.now();
    const page = { kind: 'page', id, title, created: now, updated: now, blocks: [] };
    this.index.setPage(page);
    return page;
  }

  /**
   * Changes a page's blocks. `change(blocks, page)` mutates them in place (core/outline.js).
   * @param {string} id page id (a virtual page becomes real)
   * @param {(blocks: object[], page: object) => any} change
   * @param {{history?: 'structure'|'typing'|'none', focus?: object, origin?: any}} [options]
   *   history 'typing' records an undo step only at the start of a burst of typing
   * @returns {any} whatever `change` returned
   */
  updatePage(id, change, { history = 'structure', focus = null, origin = null } = {}) {
    const page = this.materialize(id);
    if (history === 'structure') {
      this.undoHistory.record(id, page.blocks, focus);
      this.lastTyping.delete(id);
    } else if (history === 'typing') {
      const last = this.lastTyping.get(id) ?? 0;
      if (this.now() - last > TYPING_PAUSE) this.undoHistory.record(id, page.blocks, focus);
      this.lastTyping.set(id, this.now());
    }
    const result = change(page.blocks, page);
    page.updated = this.now();
    this.index.setPage(page);
    this.markDirty(id);
    this.emit('pages', { ids: [id], origin });
    return result;
  }

  /**
   * Restores the previous (or next) snapshot of a page.
   * @param {string} id
   * @param {'undo'|'redo'} direction
   * @param {object|null} focus where the caret is now (restored by the opposite action)
   * @returns {{blockId: string, caret: number}|null|false} the focus to restore, false if nothing to do
   */
  undo(id, direction = 'undo', focus = null) {
    const page = this.index.getPage(id);
    if (!page) return false;
    const snapshot = direction === 'undo'
      ? this.undoHistory.undo(id, page.blocks, focus)
      : this.undoHistory.redo(id, page.blocks, focus);
    if (!snapshot) return false;
    page.blocks = snapshot.blocks;
    page.updated = this.now();
    this.lastTyping.delete(id);
    this.index.setPage(page);
    this.markDirty(id);
    this.emit('pages', { ids: [id], origin: 'undo' });
    return snapshot.focus;
  }

  /**
   * Whether renaming to `newTitle` would collide with another page (→ merge).
   * @returns {import('../core/page-index.js').Page|undefined} the page that already has the title
   */
  renameTarget(id, newTitle) {
    const target = this.index.pageByTitle(normaliseTitle(newTitle));
    return target && target.id !== id ? target : undefined;
  }

  /**
   * Renames a page and rewrites every reference to it (also inside other titles, which cascades).
   * A collision with another page's title is handled by mergePage().
   * @param {string} id real or virtual page id
   * @param {string} newTitle
   */
  renamePage(id, newTitle) {
    const oldTitle = this.titleOf(id);
    const title = normaliseTitle(newTitle);
    if (title === '' || title === oldTitle) return;
    if (this.renameTarget(id, title)) throw new Error(`A page called "${title}" already exists.`);
    const changed = new Set();
    this.rewriteReferences(oldTitle, title, changed);
    const page = this.index.getPage(id);
    if (page) {
      page.title = title;
      page.updated = this.now();
      this.index.setPage(page);
      this.markDirty(id);
      changed.add(id);
    } else {
      // A virtual page keeps its id under the new title.
      this.index.virtualIds.delete(oldTitle);
      this.index.virtualIds.set(title, id);
    }
    this.emit('pages', { ids: [...changed], origin: 'rename' });
  }

  /**
   * Merges page `sourceId` into `targetId`: blocks are appended, references rewritten, the
   * source page deleted, shortcuts follow.
   */
  mergePage(sourceId, targetId) {
    const sourceTitle = this.titleOf(sourceId);
    const target = this.materialize(targetId);
    const source = this.index.getPage(sourceId);
    const changed = new Set([targetId]);
    if (this.settings.shortcuts.includes(sourceId)) {
      const shortcuts = this.settings.shortcuts.map((id) => (id === sourceId ? targetId : id));
      this.updateSettings({ shortcuts: [...new Set(shortcuts)] });
    }
    if (source) {
      const moving = source.blocks.filter((block) => block.text !== '' || block.children.length);
      this.undoHistory.record(targetId, target.blocks);
      target.blocks.push(...moving);
      target.blocks = target.blocks.filter((block, index) => index === 0 || block.text !== '' || block.children.length);
      source.blocks = [];
      this.deletePage(sourceId, { silent: true });
    }
    this.rewriteReferences(sourceTitle, target.title, changed);
    target.updated = this.now();
    this.index.setPage(target);
    this.markDirty(targetId);
    this.emit('pages', { ids: [...changed, sourceId], origin: 'merge' });
  }

  /** Rewrites references oldTitle → newTitle in all pages; cascades into titles containing [[oldTitle]]. */
  rewriteReferences(oldTitle, newTitle, changed) {
    for (const pageId of this.index.pagesReferencing(oldTitle)) {
      const page = this.index.getPage(pageId);
      if (!page) continue;
      let touched = false;
      walkBlocks(page.blocks, (block) => {
        const text = renameInText(block.text, oldTitle, newTitle);
        if (text !== block.text) {
          block.text = text;
          touched = true;
        }
      });
      const renamedTitle = renameInTitle(page.title, oldTitle, newTitle);
      if (touched) {
        page.updated = this.now();
        this.index.setPage(page);
        this.markDirty(page.id);
        changed.add(page.id);
      }
      if (renamedTitle !== page.title && !this.index.pageByTitle(renamedTitle)) {
        // "Article: [[Writing]] tips" becomes "Article: [[Creative Writing]] tips", and so do its references.
        this.renamePage(page.id, renamedTitle);
        changed.add(page.id);
      }
    }
  }

  /**
   * Deletes a page. Its references stay; if anything still links to it, it lives on as an
   * empty virtual page.
   */
  deletePage(id, { silent = false } = {}) {
    if (!this.index.getPage(id)) return;
    this.index.removePage(id);
    this.undoHistory.forget(id);
    this.dirty.delete(id);
    if ((this.versions.get(id) ?? 0) > 0) {
      this.pendingDeletes.add(id);
      this.scheduleSave();
    }
    if (this.settings.shortcuts.includes(id)) {
      this.updateSettings({ shortcuts: this.settings.shortcuts.filter((shortcut) => shortcut !== id) });
    }
    if (!silent) this.emit('pages', { ids: [id], origin: 'delete' });
  }

  /** @param {Partial<typeof DEFAULT_SETTINGS>} patch */
  updateSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    this.markDirty(SETTINGS_ID);
    this.emit('settings', { settings: this.settings });
  }

  /** Adds or removes a page from the shortcuts in the navigation. */
  toggleShortcut(id) {
    const shortcuts = this.settings.shortcuts.includes(id)
      ? this.settings.shortcuts.filter((shortcut) => shortcut !== id)
      : [...this.settings.shortcuts, id];
    if (!this.index.getPage(id)) this.materialize(id).blocks.push(createBlock(''));
    this.markDirty(id);
    this.updateSettings({ shortcuts });
  }

  // ── saving ──────────────────────────────────────────────────────────────────────────────

  markDirty(id) {
    this.dirty.add(id);
    this.scheduleSave();
  }

  scheduleSave(delay = SAVE_DELAY) {
    if (this.retryTimer) return; // the retry will save everything
    if (this.saveTimer) this.timers.clear(this.saveTimer);
    this.saveTimer = this.timers.set(() => {
      this.saveTimer = null;
      this.flush().catch(() => {});
    }, delay);
    this.setState(this.state === 'offline' ? 'offline' : 'saving');
  }

  /** Number of changes not yet on the server (shown in the status). */
  get pendingCount() {
    return [...this.dirty].filter((id) => this.isWorthSaving(id)).length + this.pendingDeletes.size;
  }

  /** Empty pages that were never saved stay local, so opening a day or a link writes nothing. */
  isWorthSaving(id) {
    if (id === SETTINGS_ID) return true;
    const page = this.index.getPage(id);
    if (!page) return false;
    if ((this.versions.get(id) ?? 0) > 0) return true;
    return page.blocks.some((block) => block.text.trim() !== '' || block.children.length > 0);
  }

  /** Saves every pending change now. Resolves when done (or when the server can't be reached). */
  async flush() {
    if (this.saving) {
      await this.saving;
      if (this.pendingCount === 0) return;
    }
    if (this.saveTimer) {
      this.timers.clear(this.saveTimer);
      this.saveTimer = null;
    }
    this.saving = this.saveAll().finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  async saveAll() {
    this.setState('saving');
    try {
      for (const id of [...this.pendingDeletes]) await this.deleteOnServer(id);
      for (const id of [...this.dirty]) {
        if (!this.dirty.has(id)) continue;
        if (!this.isWorthSaving(id)) {
          // An empty new page stays in memory; its next edit marks it dirty again.
          this.dirty.delete(id);
          continue;
        }
        await this.saveDocument(id);
      }
      this.retryCount = 0;
      this.setState(this.hadConflict ? 'conflict' : 'saved');
    } catch (error) {
      if (error.status === 401) {
        this.emit('locked', {});
        return;
      }
      if (error.isNetworkError || error.status >= 500 || error.status === 429) {
        this.setState('offline');
        this.scheduleRetry();
        return;
      }
      this.setState('offline');
      this.emit('notice', { message: `Saving failed: ${error.message}` });
      this.scheduleRetry();
    }
  }

  scheduleRetry() {
    const delay = RETRY_DELAYS[Math.min(this.retryCount, RETRY_DELAYS.length - 1)];
    this.retryCount += 1;
    if (this.retryTimer) this.timers.clear(this.retryTimer);
    this.retryTimer = this.timers.set(() => {
      this.retryTimer = null;
      this.flush().catch(() => {});
    }, delay);
  }

  documentFor(id) {
    if (id === SETTINGS_ID) return { ...this.settings, kind: 'settings' };
    const page = this.index.getPage(id);
    return { kind: 'page', id: page.id, title: page.title, created: page.created, updated: page.updated, blocks: page.blocks };
  }

  async saveDocument(id) {
    // Snapshot the content before awaiting: edits made while the request runs mark the page
    // dirty again and are saved in the next round.
    this.dirty.delete(id);
    const document = JSON.parse(JSON.stringify(this.documentFor(id)));
    const baseVersion = this.versions.get(id) ?? 0;
    try {
      const payload = await this.cipher.encrypt(id, document);
      const { version } = await this.api.saveDocument(id, payload, baseVersion);
      this.versions.set(id, version);
    } catch (error) {
      if (error.code === 'conflict') {
        await this.resolveConflict(id, document, error.body.current);
        return;
      }
      this.dirty.add(id);
      throw error;
    }
  }

  async deleteOnServer(id) {
    try {
      const { version } = await this.api.deleteDocument(id, this.versions.get(id) ?? 0);
      this.versions.set(id, version);
    } catch (error) {
      if (error.code !== 'conflict') throw error;
      // Changed elsewhere in the meantime: keep the other device's version.
      if (error.body.current && !error.body.current.deleted) {
        await this.applyRemote(error.body.current);
        this.emit('pages', { ids: [id], origin: 'sync' });
        this.emit('notice', { message: 'A page you deleted was changed on another device, so it was kept.' });
      }
    }
    this.pendingDeletes.delete(id);
  }

  /**
   * Another device saved first. The server's version wins in place; the local version is kept as a
   * new page "<Title> (conflict copy …)", so nothing is lost.
   */
  async resolveConflict(id, localDocument, current) {
    if (!current || current.deleted) {
      // Deleted elsewhere (or never existed under that version): the local edit brings it back.
      this.versions.set(id, current?.version ?? 0);
      this.dirty.add(id);
      await this.saveDocument(id);
      return;
    }
    await this.applyRemote(current);
    if (id === SETTINGS_ID) {
      this.emit('pages', { ids: [], origin: 'sync' });
      return;
    }
    const stamp = new Date(this.now());
    const pad = (n) => String(n).padStart(2, '0');
    const label = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
    let title = `${localDocument.title} (conflict copy ${label})`;
    for (let n = 2; this.index.pageByTitle(title); n += 1) title = `${localDocument.title} (conflict copy ${label}, ${n})`;
    const copy = {
      kind: 'page',
      id: newId('p'),
      title,
      created: this.now(),
      updated: this.now(),
      blocks: localDocument.blocks,
    };
    this.index.setPage(copy);
    this.dirty.add(copy.id);
    this.hadConflict = true;
    this.emit('pages', { ids: [id, copy.id], origin: 'conflict' });
    this.emit('notice', { message: `"${localDocument.title}" was changed on another device. Your version was saved as "${title}".` });
    await this.saveDocument(copy.id);
  }

  setState(state) {
    this.state = state;
    this.emit('status', { state, pending: this.pendingCount });
  }

  /** Clears the "conflict" status once the user has seen it. */
  acknowledgeConflict() {
    this.hadConflict = false;
    if (this.state === 'conflict') this.setState('saved');
  }

  get hasUnsavedChanges() {
    return this.pendingCount > 0 || this.saving !== null;
  }

  /** Stops timers (logout, tests). */
  dispose() {
    if (this.saveTimer) this.timers.clear(this.saveTimer);
    if (this.retryTimer) this.timers.clear(this.retryTimer);
    this.saveTimer = null;
    this.retryTimer = null;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

/** Titles are single-line and trimmed. */
export function normaliseTitle(title) {
  return String(title).replace(/[\r\n]+/g, ' ').trim();
}
