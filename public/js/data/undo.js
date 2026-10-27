// Undo and redo per page. A snapshot is a deep copy of the page's blocks plus where the caret
// was, taken before every structural change and at the start of each burst of typing.

import { snapshotBlocks } from '../core/outline.js';

export class UndoHistory {
  /** @param {number} [limit=200] snapshots kept per page */
  constructor(limit = 200) {
    this.limit = limit;
    /** @type {Map<string, {undo: object[], redo: object[]}>} */
    this.stacks = new Map();
  }

  stack(pageId) {
    if (!this.stacks.has(pageId)) this.stacks.set(pageId, { undo: [], redo: [] });
    return this.stacks.get(pageId);
  }

  /**
   * Remembers the state before a change.
   * @param {string} pageId
   * @param {object[]} blocks the page's blocks as they are now (copied here)
   * @param {{blockId: string, caret: number}|null} [focus]
   */
  record(pageId, blocks, focus = null) {
    const stack = this.stack(pageId);
    stack.undo.push({ blocks: snapshotBlocks(blocks), focus });
    if (stack.undo.length > this.limit) stack.undo.shift();
    stack.redo = [];
  }

  /**
   * @param {string} pageId
   * @param {object[]} currentBlocks saved for redo
   * @param {object|null} currentFocus
   * @returns {{blocks: object[], focus: object|null}|null}
   */
  undo(pageId, currentBlocks, currentFocus = null) {
    const stack = this.stack(pageId);
    const snapshot = stack.undo.pop();
    if (!snapshot) return null;
    stack.redo.push({ blocks: snapshotBlocks(currentBlocks), focus: currentFocus });
    return snapshot;
  }

  /** The reverse of undo(). */
  redo(pageId, currentBlocks, currentFocus = null) {
    const stack = this.stack(pageId);
    const snapshot = stack.redo.pop();
    if (!snapshot) return null;
    stack.undo.push({ blocks: snapshotBlocks(currentBlocks), focus: currentFocus });
    return snapshot;
  }

  /** Forget a page's history (after it was replaced by a newer version from another device). */
  forget(pageId) {
    this.stacks.delete(pageId);
  }
}
