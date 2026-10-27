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
    // Stay above the on-screen keyboard.
    window.visualViewport?.addEventListener('resize', () => this.position());
    window.visualViewport?.addEventListener('scroll', () => this.position());
    document.body.append(this.element);
  }

  show() {
    if (!this.enabled) return;
    this.element.hidden = false;
    this.position();
  }

  hide() {
    this.element.hidden = true;
  }

  position() {
    const viewport = window.visualViewport;
    if (!viewport || this.element.hidden) return;
    const bottom = window.innerHeight - (viewport.height + viewport.offsetTop);
    this.element.style.bottom = `${Math.max(0, bottom)}px`;
  }
}
