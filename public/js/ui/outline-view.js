// Shows the blocks of one page as bullets: the whole page, or (in references) a single block
// with its children. Clicking text opens the block editor; everything else (selection, drag and
// drop, links) is handled by the modules the app passes in.

import { createBlock, findBlock, walkBlocks } from '../core/outline.js';
import { clear, h } from './dom.js';
import { renderBlock } from './render.js';

export class OutlineView {
  /**
   * @param {object} app the app context (store, editor, selection, renderOptions())
   * @param {{pageId: string, rootIds?: string[]|null, placeholder?: string}} options
   *   rootIds: show only these blocks (with their children) instead of the whole page
   */
  constructor(app, { pageId, rootIds = null, placeholder = 'Start writing…' }) {
    this.app = app;
    this.pageId = pageId;
    this.rootIds = rootIds;
    this.placeholder = placeholder;
    this.element = h('ul', { class: 'blocks root' });
    // Lets DOM-based features (navigation, drag and drop) find the view that owns a row.
    this.element.outlineView = this;
    this.element.addEventListener('click', (event) => this.onClick(event));
    app.views.add(this);
    this.render();
  }

  get page() {
    return this.app.store.getPage(this.pageId);
  }

  /** The blocks shown at the top level of this view. */
  roots() {
    const page = this.page;
    if (!page) return [];
    if (!this.rootIds) return page.blocks;
    return this.rootIds.map((id) => findBlock(page.blocks, id)?.block).filter(Boolean);
  }

  /** Whether a block of this page is visible in this view (used to decide on re-rendering). */
  shows(pageId) {
    return pageId === this.pageId;
  }

  render() {
    const editor = this.app.editor;
    const editingHere = editor.target?.view === this;
    if (editingHere) editor.beginMove();
    clear(this.element);
    const roots = this.roots();
    if (roots.length === 0 && !this.rootIds) {
      this.element.append(this.renderPlaceholder());
    } else {
      for (const block of roots) this.element.append(this.renderBlock(block));
    }
    if (editingHere) editor.reattach(this);
  }

  renderPlaceholder() {
    return h('li', { class: 'block placeholder' },
      h('div', { class: 'row' },
        h('span', { class: 'bullet', 'aria-hidden': 'true' }),
        h('div', { class: 'content', 'data-action': 'start' }, h('span', { class: 't placeholder-text' }, this.placeholder))));
  }

  renderBlock(block) {
    const { element: content } = renderBlock(block.text, this.app.renderOptions());
    const hasChildren = block.children.length > 0;
    const row = h('div', { class: ['row', this.app.selection.isSelected(this, block.id) && 'selected'] },
      h('span', {
        class: 'bullet',
        role: 'button',
        tabindex: '-1',
        'aria-label': hasChildren ? (block.collapsed ? 'Expand' : 'Collapse') : 'Drag to move',
        'data-action': 'bullet',
      }),
      content);
    const item = h('li', {
      class: ['block', block.collapsed && hasChildren && 'folded', hasChildren && 'has-children'],
      'data-block-id': block.id,
    }, row);
    if (hasChildren && !block.collapsed) {
      item.append(h('ul', { class: 'blocks' }, block.children.map((child) => this.renderBlock(child))));
    }
    return item;
  }

  /** The .row element of a block in this view. */
  rowFor(blockId) {
    for (const item of this.element.querySelectorAll('li.block')) {
      if (item.dataset.blockId === blockId) return item.querySelector(':scope > .row');
    }
    return null;
  }

  /** Ids of the blocks this view shows, top to bottom. */
  visibleIds() {
    const ids = [];
    walkBlocks(this.roots(), (block) => {
      ids.push(block.id);
      return !block.collapsed;
    });
    return ids;
  }

  onClick(event) {
    if (event.target.closest('a')) return; // links are handled by the app
    const row = event.target.closest('.row');
    if (!row || !this.element.contains(row)) return;
    const blockId = row.parentElement.dataset.blockId;
    const action = event.target.closest('[data-action]')?.dataset.action;

    if (action === 'start') {
      this.startWriting();
      return;
    }
    if (action === 'toggle-task') {
      this.app.editor.toggleTask(this, blockId);
      return;
    }
    if (action === 'bullet') return; // drag-drop.js handles clicks on bullets
    if (event.shiftKey && this.app.selection.extendTo(this, blockId)) {
      event.preventDefault();
      return;
    }
    if (window.getSelection()?.toString() && !row.classList.contains('editing')) return; // user is selecting text to copy
    const content = row.querySelector('.content');
    if (!content || content.hidden) return;
    this.app.editor.open(this, blockId, clickedSourceOffset(event, content, findBlock(this.page.blocks, blockId)?.block.text ?? ''));
  }

  /** Clicking the placeholder of an empty page creates its first block. */
  startWriting() {
    const block = createBlock('');
    this.app.store.updatePage(this.pageId, (blocks) => blocks.push(block), { history: 'none', origin: 'edit' });
    this.app.editor.open(this, block.id, 0);
  }

  destroy() {
    if (this.app.editor.target?.view === this) this.app.editor.close();
    this.app.views.delete(this);
  }
}

/**
 * Maps a click in rendered text to an offset in the markdown source, so the caret lands where
 * the user clicked. Rendered characters are matched against the source in order; source
 * characters without a rendered counterpart are markup.
 */
function clickedSourceOffset(event, content, source) {
  let renderedOffset = null;
  const point = document.caretPositionFromPoint?.(event.clientX, event.clientY)
    ?? (() => {
      const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
      return range ? { offsetNode: range.startContainer, offset: range.startOffset } : null;
    })();
  if (point && content.contains(point.offsetNode)) {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let count = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node === point.offsetNode) {
        renderedOffset = count + point.offset;
        break;
      }
      count += node.textContent.length;
    }
  }
  if (renderedOffset === null) return source.length;
  const rendered = content.textContent.replace(/\u200b/g, '');
  let r = 0;
  let s = 0;
  while (s < source.length && r < renderedOffset) {
    if (source[s] === rendered[r]) r += 1;
    s += 1;
  }
  return s;
}
