// Block selection: after Esc, or Shift+click across bullets, whole blocks are selected and
// keyboard commands act on all of them: Shift+↑/↓ extend, Backspace/Delete remove,
// Tab/Shift+Tab indent, Alt+Shift+↑/↓ move, Ctrl+C/X copy/cut as markdown, Ctrl+Enter tasks.

import {
  blocksToPlainText, findBlock, indent, moveDown, moveUp, outdent, removeBlocks,
} from '../core/outline.js';
import { isModKey } from './dom.js';

export class BlockSelection {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    this.view = null;
    /** @type {string[]} selected block ids in outline order */
    this.ids = [];
    this.anchor = null;
    document.addEventListener('keydown', (event) => this.onKeyDown(event));
    document.addEventListener('copy', (event) => this.onCopy(event, false));
    document.addEventListener('cut', (event) => this.onCopy(event, true));
    document.addEventListener('mousedown', (event) => {
      if (this.ids.length && !event.shiftKey && !event.target.closest('.row.selected')) this.clear();
    });
  }

  get active() {
    return this.ids.length > 0;
  }

  isSelected(view, blockId) {
    return this.view === view && this.ids.includes(blockId);
  }

  /**
   * @param {import('./outline-view.js').OutlineView} view
   * @param {string[]} ids
   */
  select(view, ids) {
    this.clearMarks();
    this.view = view;
    this.ids = ids;
    this.anchor = ids[0] ?? null;
    this.mark();
    document.activeElement?.blur?.();
  }

  clear() {
    this.clearMarks();
    this.view = null;
    this.ids = [];
    this.anchor = null;
  }

  /** Shift+click: select from the edited (or anchor) block to this one. */
  extendTo(view, blockId) {
    const editor = this.app.editor;
    const anchor = editor.target?.view === view ? editor.target.blockId : (this.view === view ? this.anchor : null);
    if (!anchor) return false;
    const visible = view.visibleIds();
    const a = visible.indexOf(anchor);
    const b = visible.indexOf(blockId);
    if (a < 0 || b < 0) return false;
    if (editor.target) editor.close();
    this.select(view, visible.slice(Math.min(a, b), Math.max(a, b) + 1));
    this.anchor = anchor;
    return true;
  }

  mark() {
    for (const id of this.ids) this.view?.rowFor(id)?.classList.add('selected');
  }

  clearMarks() {
    for (const id of this.ids) this.view?.rowFor(id)?.classList.remove('selected');
  }

  /** Selected blocks without those whose parent is selected too (they move along anyway). */
  topLevelIds() {
    const blocks = this.view.page?.blocks ?? [];
    return this.ids.filter((id) => {
      for (let place = findBlock(blocks, id); place?.parent; place = findBlock(blocks, place.parent.id)) {
        if (this.ids.includes(place.parent.id)) return false;
      }
      return true;
    });
  }

  change(operation) {
    const view = this.view;
    const ids = [...this.ids];
    this.app.store.updatePage(view.pageId, (blocks) => operation(blocks), { origin: 'edit' });
    // The view re-rendered; select the same blocks again if they still exist.
    const remaining = ids.filter((id) => findBlock(view.page?.blocks ?? [], id));
    if (remaining.length) this.select(view, remaining);
    else this.clear();
  }

  onKeyDown(event) {
    if (!this.active || event.defaultPrevented || event.target.closest?.('input, textarea, dialog')) return;
    const mod = isModKey(event);
    const visible = this.view.visibleIds();
    const key = event.key;
    let handled = true;

    if (key === 'Escape') {
      this.clear();
    } else if (key === 'Enter' && mod) {
      this.change((blocks) => {
        for (const id of this.ids) {
          const { block } = findBlock(blocks, id);
          const match = /^\[([ xX])\] ?/.exec(block.text);
          block.text = !match ? `[ ] ${block.text}` : match[1] === ' ' ? `[x] ${block.text.slice(match[0].length)}` : block.text.slice(match[0].length);
        }
      });
    } else if (key === 'Enter') {
      const view = this.view;
      const first = this.ids[0];
      this.clear();
      this.app.editor.open(view, first);
    } else if (key === 'Backspace' || key === 'Delete') {
      const view = this.view;
      const before = visible[visible.indexOf(this.ids[0]) - 1];
      const ids = this.topLevelIds();
      this.clear();
      this.app.store.updatePage(view.pageId, (blocks) => removeBlocks(blocks, ids), { origin: 'edit' });
      if (before && findBlock(view.page.blocks, before)) this.select(view, [before]);
    } else if (key === 'Tab') {
      const ids = this.topLevelIds();
      this.change((blocks) => {
        const ordered = event.shiftKey ? [...ids].reverse() : ids;
        for (const id of ordered) (event.shiftKey ? outdent : indent)(blocks, id);
      });
    } else if ((key === 'ArrowUp' || key === 'ArrowDown') && event.shiftKey && (event.altKey || mod)) {
      const ids = this.topLevelIds();
      this.change((blocks) => {
        const ordered = key === 'ArrowUp' ? ids : [...ids].reverse();
        for (const id of ordered) (key === 'ArrowUp' ? moveUp : moveDown)(blocks, id);
      });
    } else if ((key === 'ArrowUp' || key === 'ArrowDown') && event.shiftKey) {
      const first = visible.indexOf(this.ids[0]);
      const last = visible.indexOf(this.ids[this.ids.length - 1]);
      const anchorIndex = visible.indexOf(this.anchor);
      let from = first;
      let to = last;
      if (key === 'ArrowUp') {
        if (last > anchorIndex) to -= 1;
        else from = Math.max(0, first - 1);
      } else if (first < anchorIndex) {
        from += 1;
      } else {
        to = Math.min(visible.length - 1, last + 1);
      }
      const anchor = this.anchor;
      this.select(this.view, visible.slice(from, to + 1));
      this.anchor = anchor;
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      const position = key === 'ArrowUp' ? visible.indexOf(this.ids[0]) - 1 : visible.indexOf(this.ids[this.ids.length - 1]) + 1;
      if (visible[position]) this.select(this.view, [visible[position]]);
    } else {
      handled = false;
    }
    if (handled) event.preventDefault();
  }

  /** Copy or cut the selected blocks as a markdown list. */
  onCopy(event, cut) {
    if (!this.active || event.target.closest?.('input, textarea')) return;
    const blocks = this.view.page?.blocks ?? [];
    const selected = this.topLevelIds().map((id) => findBlock(blocks, id)?.block).filter(Boolean);
    event.clipboardData.setData('text/plain', blocksToPlainText(selected));
    event.preventDefault();
    if (cut) {
      const view = this.view;
      const ids = this.topLevelIds();
      this.clear();
      this.app.store.updatePage(view.pageId, (list) => removeBlocks(list, ids), { origin: 'edit' });
    }
  }
}
