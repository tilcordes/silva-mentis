// The popup list under the caret: page suggestions for [[ and #, and the / command menu.
// Focus stays in the textarea; the editor forwards ↑ ↓ Enter Tab Esc while the list is open.

import { h, clear } from './dom.js';

/**
 * @typedef {object} Suggestion
 * @property {string} label
 * @property {string|number} [detail] shown faintly on the right (e.g. reference count)
 * @property {boolean} [create] styled as "Create page …"
 * @property {any} [value]
 */

export class SuggestionMenu {
  constructor() {
    this.element = h('div', { class: 'popover suggestions', role: 'listbox', hidden: true });
    this.items = [];
    this.selected = 0;
    this.onPick = null;
    // Keep the textarea focused when the list is clicked.
    this.element.addEventListener('mousedown', (event) => event.preventDefault());
    document.body.append(this.element);
  }

  get isOpen() {
    return !this.element.hidden;
  }

  /**
   * @param {{anchor: {left: number, top: number, bottom: number}, items: Suggestion[],
   *   onPick: (item: Suggestion) => void, emptyText?: string}} options
   */
  show({ anchor, items, onPick, emptyText }) {
    this.items = items;
    this.onPick = onPick;
    this.selected = 0;
    clear(this.element);
    if (items.length === 0) {
      if (!emptyText) {
        this.hide();
        return;
      }
      this.element.append(h('div', { class: 'suggestion-empty' }, emptyText));
    }
    items.forEach((item, index) => {
      this.element.append(h('div', {
        class: ['suggestion', item.create && 'create', index === 0 && 'sel'],
        role: 'option',
        'aria-selected': index === 0 ? 'true' : 'false',
        onclick: () => this.pick(index),
        onmousemove: () => this.highlight(index),
      }, h('span', { class: 'label' }, item.label), item.detail !== undefined && item.detail !== ''
        ? h('span', { class: 'n' }, String(item.detail)) : null));
    });
    this.element.hidden = false;
    this.place(anchor);
  }

  place(anchor) {
    const width = Math.min(320, window.innerWidth - 16);
    this.element.style.width = `${width}px`;
    this.element.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
    const height = this.element.offsetHeight;
    const below = anchor.bottom + 6;
    const top = below + height > window.innerHeight - 8 && anchor.top - height - 6 > 8 ? anchor.top - height - 6 : below;
    this.element.style.top = `${top}px`;
  }

  highlight(index) {
    const options = this.element.querySelectorAll('.suggestion');
    options[this.selected]?.classList.remove('sel');
    options[this.selected]?.setAttribute('aria-selected', 'false');
    this.selected = index;
    options[index]?.classList.add('sel');
    options[index]?.setAttribute('aria-selected', 'true');
    options[index]?.scrollIntoView({ block: 'nearest' });
  }

  /** @param {number} delta +1 / -1 */
  move(delta) {
    if (!this.items.length) return;
    this.highlight((this.selected + delta + this.items.length) % this.items.length);
  }

  pick(index = this.selected) {
    const item = this.items[index];
    const onPick = this.onPick;
    this.hide();
    if (item && onPick) onPick(item);
  }

  hide() {
    this.element.hidden = true;
    this.items = [];
    this.onPick = null;
  }
}
