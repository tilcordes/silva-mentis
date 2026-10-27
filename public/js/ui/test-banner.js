// The bar across the top of the test version, so it can't be mistaken for the real thing.

import { confirmDialog } from './dialogs.js';
import { h } from './dom.js';

/**
 * @param {{onReset: () => Promise<void>}} options
 * @returns {HTMLElement}
 */
export function testBanner({ onReset }) {
  return h('div', { class: 'testbar', role: 'note' },
    h('strong', null, 'TEST VERSION'),
    h('span', null, 'No login, no encryption — notes are stored as plain text on this computer.'),
    h('button', {
      type: 'button',
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'Reset the test version?',
          message: 'All test notes are deleted and the sample notes are loaded again.',
          confirmLabel: 'Reset',
          danger: true,
        });
        if (ok) await onReset();
      },
    }, 'Reset'));
}
