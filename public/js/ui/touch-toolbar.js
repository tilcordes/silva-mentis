// On touch devices, a slim toolbar above the keyboard with the keys phones lack:
// outdent, indent, move up/down, task, bold, highlight, [[ ]], # and Done.

import { h } from './dom.js';

const TOOLS = [
  ['outdent', '⇤', 'Outdent'],
  ['indent', '⇥', 'Indent'],
  ['up', '↑', 'Move up'],
  ['down', '↓', 'Move down'],
  ['task', '☐', 'Task'],
  ['bold', 'B', 'Bold'],
  ['highlight', '==', 'Highlight'],
  ['link', '[[ ]]', 'Page link'],
  ['tag', '#', 'Tag'],
];

export class TouchToolbar {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    this.enabled = window.matchMedia('(pointer: coarse)').matches;
    this.element = h('div', { class: 'touch-toolbar', role: 'toolbar', 'aria-label': 'Editing tools', hidden: true },
      TOOLS.map(([name, label, title]) => h('button', {
        type: 'button',
        class: ['tool', label.length > 2 && 'wide'],
        'aria-label': title,
        'data-tool': name,
      }, label)),
      h('button', { type: 'button', class: 'tool text', 'data-tool': 'done' }, 'Done'));
    // Keep the textarea focused (and the keyboard open) while tapping tools.
    this.element.addEventListener('pointerdown', (event) => event.preventDefault());
    this.element.addEventListener('click', (event) => {
      const tool = event.target.closest('[data-tool]')?.dataset.tool;
      if (tool) app.editor.command(tool);
    });
    // Stay above the on-screen keyboard. When the keyboard opens or changes size, bring the
    // edited bullet back above it (not on scroll: that would fight a person scrolling to read).
    window.visualViewport?.addEventListener('resize', () => {
      this.position();
      if (!this.element.hidden) app.editor.reveal();
    });
    window.visualViewport?.addEventListener('scroll', () => this.position());
    document.body.append(this.element);
  }

  show() {
    if (!this.enabled) return;
    this.element.hidden = false;
    this.position();
    this.app.editor.reveal();
  }

  hide() {
    this.element.hidden = true;
  }

  /** How much of the bottom of the screen the toolbar covers (0 while it is hidden). */
  get height() {
    return this.element.hidden ? 0 : this.element.offsetHeight;
  }

  /**
   * Puts the toolbar on top of the keyboard. Most phone browsers don't shrink the page for the
   * keyboard, they only cover it. So the space keyboard and toolbar take is also published as
   * --keyboard: the scroll areas add it below their content, which lets even the last bullet of
   * a page scroll up above them (see BlockEditor.reveal()).
   */
  position() {
    const viewport = window.visualViewport;
    if (!this.enabled || !viewport) return;
    const keyboard = Math.max(0, Math.round(window.innerHeight - (viewport.height + viewport.offsetTop)));
    this.element.style.bottom = `${keyboard}px`;
    if (this.element.hidden) {
      document.documentElement.style.removeProperty('--keyboard');
      return;
    }
    document.documentElement.style.setProperty('--keyboard', `${keyboard + this.height}px`);
  }
}
