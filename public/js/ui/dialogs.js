// Modal dialogs (confirm, password prompt) and toasts. Dialogs use <dialog>, which traps focus
// and closes with Esc on its own.

import { h } from './dom.js';

/**
 * Asks a yes/no question.
 * @param {{title: string, message?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean}} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'dialog' },
      h('form', { method: 'dialog', class: 'dialog-body' },
        h('h2', null, title),
        message && h('p', null, message),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn secondary', value: 'cancel', type: 'submit' }, cancelLabel),
          h('button', { class: ['btn', danger && 'danger'], value: 'ok', type: 'submit', autofocus: true }, confirmLabel))));
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Asks for the password before a sensitive action.
 * @param {{title: string, message?: string, confirmLabel?: string,
 *   action: (password: string) => Promise<void>}} options action may throw; its message is shown
 * @returns {Promise<boolean>} whether the action succeeded
 */
export function passwordDialog({ title, message = '', confirmLabel = 'Continue', action }) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const submit = h('button', { class: 'btn', type: 'submit' }, confirmLabel);
    let succeeded = false;
    const form = h('form', { class: 'dialog-body' },
      h('h2', null, title),
      message && h('p', null, message),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Password'), input),
      error,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn secondary', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
        submit));
    const dialog = h('dialog', { class: 'dialog' }, form);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Working…';
      error.hidden = true;
      try {
        await action(input.value);
        succeeded = true;
        dialog.close();
      } catch (problem) {
        error.textContent = problem.message;
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = confirmLabel;
        input.select();
      }
    });
    dialog.addEventListener('close', () => {
      resolve(succeeded);
      dialog.remove();
    });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}

/**
 * A dialog with arbitrary content and a close button.
 * @param {{title: string, content: Node[], wide?: boolean}} options
 */
export function infoDialog({ title, content, wide = false }) {
  const dialog = h('dialog', { class: ['dialog', wide && 'wide'] },
    h('form', { method: 'dialog', class: 'dialog-body' },
      h('h2', null, title),
      ...content,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', type: 'submit', autofocus: true }, 'Close'))));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

let toastHost = null;

/**
 * A short message in the corner that goes away on its own.
 * @param {string} message
 * @param {{timeout?: number, kind?: 'info'|'error'}} [options]
 */
export function toast(message, { timeout = 6000, kind = 'info' } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const item = h('div', { class: ['toast', kind] },
    h('span', null, message),
    h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Dismiss', onclick: () => item.remove() }, '×'));
  toastHost.append(item);
  setTimeout(() => item.remove(), timeout);
}

/**
 * A small menu next to a button.
 * @param {HTMLElement} anchor
 * @param {Array<{label: string, action: () => void, danger?: boolean}>} items
 */
export function popupMenu(anchor, items) {
  document.querySelector('.popup-menu')?.remove();
  const menu = h('div', { class: 'popover popup-menu', role: 'menu' },
    items.map((item) => h('button', {
      class: ['menu-item', item.danger && 'danger'],
      type: 'button',
      role: 'menuitem',
      onclick: () => {
        close();
        item.action();
      },
    }, item.label)));
  const close = () => {
    menu.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
  };
  const outside = (event) => {
    if (!menu.contains(event.target) && !anchor.contains(event.target)) close();
  };
  const escape = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      anchor.focus();
    }
  };
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', escape, true);
  menu.querySelector('button')?.focus();
  return close;
}
