// Drag a bullet to move its block (with children) before, after or into another block: within
// a page, between pages, between the main column and the sidebar. Pointer events cover mouse,
// pen and touch. A bullet that is clicked without dragging folds or unfolds its children.

import { findBlock, insertBlocks, moveBlocks, removeBlocks } from '../core/outline.js';
import { blockToPlainText } from '../core/markdown.js';
import { h } from './dom.js';

const DRAG_THRESHOLD = 5;
const INDENT_ZONE = 36;

export class DragAndDrop {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    this.drag = null;
    this.indicator = h('div', { class: 'drop-indicator', hidden: true });
    document.body.append(this.indicator);
    document.addEventListener('pointerdown', (event) => this.onPointerDown(event));
  }

  onPointerDown(event) {
    const bullet = event.target.closest?.('.bullet[data-action="bullet"]');
    if (!bullet || event.button !== 0) return;
    const item = bullet.closest('li.block');
    const view = item.closest('ul.root')?.outlineView;
    if (!view) return;
    event.preventDefault();
    this.drag = { view, blockId: item.dataset.blockId, item, startX: event.clientX, startY: event.clientY, active: false, ghost: null, target: null };
    bullet.setPointerCapture(event.pointerId);
    const move = (moveEvent) => this.onPointerMove(moveEvent);
    const up = (upEvent) => {
      bullet.removeEventListener('pointermove', move);
      bullet.removeEventListener('pointerup', up);
      bullet.removeEventListener('pointercancel', up);
      this.onPointerUp(upEvent);
    };
    bullet.addEventListener('pointermove', move);
    bullet.addEventListener('pointerup', up);
    bullet.addEventListener('pointercancel', up);
  }

  onPointerMove(event) {
    const drag = this.drag;
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.active = true;
      if (this.app.editor.target) this.app.editor.close();
      const block = findBlock(drag.view.page.blocks, drag.blockId)?.block;
      drag.ghost = h('div', { class: 'drag-ghost' }, blockToPlainText(block?.text ?? '').slice(0, 80) || '…');
      document.body.append(drag.ghost);
      drag.item = drag.view.rowFor(drag.blockId)?.parentElement ?? drag.item;
      drag.item.classList.add('dragging');
    }
    drag.ghost.style.left = `${event.clientX + 12}px`;
    drag.ghost.style.top = `${event.clientY + 8}px`;
    drag.target = this.findTarget(event);
    this.showIndicator(drag.target);
  }

  /** The row under the pointer and where the dragged block would go. */
  findTarget(event) {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const row = element?.closest?.('li.block:not(.placeholder) > .row');
    if (!row || this.drag.item.contains(row)) return null;
    const view = row.closest('ul.root')?.outlineView;
    if (!view) return null;
    const rect = row.getBoundingClientRect();
    const content = row.querySelector('.content, .editor') ?? row;
    const contentLeft = content.getBoundingClientRect().left;
    let position;
    if (event.clientY < rect.top + rect.height / 2) position = 'before';
    else if (event.clientX > contentLeft + INDENT_ZONE) position = 'inside';
    else position = 'after';
    return { view, blockId: row.parentElement.dataset.blockId, position, rect, contentLeft };
  }

  showIndicator(target) {
    if (!target) {
      this.indicator.hidden = true;
      return;
    }
    const { rect, position, contentLeft } = target;
    const left = position === 'inside' ? contentLeft + INDENT_ZONE : contentLeft - 14;
    this.indicator.style.left = `${left}px`;
    this.indicator.style.width = `${Math.max(40, rect.right - left)}px`;
    this.indicator.style.top = `${position === 'before' ? rect.top - 1 : rect.bottom - 1}px`;
    this.indicator.hidden = false;
  }

  onPointerUp() {
    const drag = this.drag;
    this.drag = null;
    this.indicator.hidden = true;
    if (!drag) return;
    drag.ghost?.remove();
    drag.item.classList.remove('dragging');
    if (!drag.active) {
      this.toggleCollapse(drag.view, drag.blockId);
      return;
    }
    if (drag.target) this.drop(drag.view, drag.blockId, drag.target);
  }

  toggleCollapse(view, blockId) {
    const block = findBlock(view.page?.blocks ?? [], blockId)?.block;
    if (!block?.children.length) return;
    this.app.store.updatePage(view.pageId, (blocks) => {
      const { block: target } = findBlock(blocks, blockId);
      if (target.collapsed) delete target.collapsed;
      else target.collapsed = true;
    }, { history: 'structure', origin: 'edit' });
  }

  drop(sourceView, blockId, target) {
    const store = this.app.store;
    const position = target.position;
    if (sourceView.pageId === target.view.pageId) {
      store.updatePage(sourceView.pageId, (blocks) => moveBlocks(blocks, [blockId], target.blockId, position), { origin: 'edit' });
      return;
    }
    let moved = [];
    store.updatePage(sourceView.pageId, (blocks) => {
      moved = removeBlocks(blocks, [blockId]);
    }, { origin: 'edit' });
    if (moved.length) {
      store.updatePage(target.view.pageId, (blocks) => insertBlocks(blocks, target.blockId, position, moved), { origin: 'edit' });
    }
  }
}
