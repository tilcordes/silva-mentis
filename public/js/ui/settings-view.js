// Settings: account (password, recovery key, sessions), appearance and data (export, import,
// keep unlocked). In the test version, a reset replaces the account section.

import { exportArchive, importFiles } from '../core/markdown-file.js';
import { dateKey } from '../core/dates.js';
import { confirmDialog, infoDialog, passwordDialog, toast } from './dialogs.js';
import { downloadFile, h } from './dom.js';
import { recoveryKeyPanel, newPasswordFields } from './auth-views.js';

export class SettingsView {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    this.element = h('div', { class: 'settings' }, h('h1', { class: 'page-title' }, 'Settings'));
    this.render();
  }

  render() {
    const app = this.app;
    const sections = [];
    if (app.account) sections.push(this.accountSection());
    else sections.push(h('section', { class: 'settings-section' },
      h('h2', null, 'Test version'),
      h('p', { class: 'hint' }, 'This version has no login and stores notes unencrypted. Use it to try things out.'),
      h('button', { class: 'btn secondary', type: 'button', onclick: () => app.resetTestData() }, 'Reset test notes')));
    sections.push(this.appearanceSection(), this.dataSection());
    this.element.append(...sections);
  }

  accountSection() {
    const account = this.app.account;
    return h('section', { class: 'settings-section' },
      h('h2', null, 'Account'),
      h('p', { class: 'hint' }, `Logged in as ${account.username}. Your notes are encrypted in this browser; the server only stores ciphertext.`),
      h('div', { class: 'settings-actions' },
        h('button', { class: 'btn secondary', type: 'button', onclick: () => this.changePassword() }, 'Change password'),
        h('button', { class: 'btn secondary', type: 'button', onclick: () => this.newRecoveryKey() }, 'New recovery key'),
        h('button', {
          class: 'btn secondary',
          type: 'button',
          onclick: () => passwordDialog({
            title: 'Log out other devices',
            message: 'Every other browser has to log in again. This one stays logged in.',
            confirmLabel: 'Log out others',
            action: async (password) => {
              await account.revokeOtherSessions(password);
              toast('Other devices were logged out.');
            },
          }),
        }, 'Log out other devices'),
        h('button', { class: 'btn secondary', type: 'button', onclick: () => account.logout() }, 'Log out')));
  }

  changePassword() {
    const account = this.app.account;
    const fields = newPasswordFields();
    const current = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const submit = h('button', { class: 'btn', type: 'submit' }, 'Change password');
    const form = h('form', { class: 'dialog-body' },
      h('h2', null, 'Change password'),
      h('p', { class: 'hint' }, 'Other devices will have to log in again. Your recovery key stays valid.'),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Current password'), current),
      fields.element,
      error,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn secondary', type: 'button', onclick: () => dialog.close() }, 'Cancel'),
        submit));
    const dialog = h('dialog', { class: 'dialog' }, form);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const problem = fields.problem();
      if (problem) {
        error.textContent = problem;
        error.hidden = false;
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Working…';
      try {
        await account.changePassword(current.value, fields.value());
        dialog.close();
        toast('Your password was changed.');
      } catch (failure) {
        error.textContent = failure.message;
        error.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Change password';
      }
    });
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
    current.focus();
  }

  async newRecoveryKey() {
    let key = null;
    const ok = await passwordDialog({
      title: 'New recovery key',
      message: 'The old recovery key stops working.',
      confirmLabel: 'Create new key',
      action: async (password) => {
        key = await this.app.account.replaceRecoveryKey(password);
      },
    });
    if (!ok || !key) return;
    const panel = recoveryKeyPanel(key, { username: this.app.account.username });
    infoDialog({ title: 'Your new recovery key', content: [panel.element] });
  }

  appearanceSection() {
    const store = this.app.store;
    const settings = store.settings;
    const choice = (name, label, options, current) => h('fieldset', { class: 'choice' },
      h('legend', { class: 'field-label' }, label),
      options.map(([value, text]) => h('label', { class: 'choice-option' },
        h('input', {
          type: 'radio',
          name,
          value,
          checked: current === value,
          onchange: () => store.updateSettings({ [name]: value }),
        }), text)));
    const toggle = (key, label, hint) => h('label', { class: 'toggle-label setting-toggle' },
      h('input', { type: 'checkbox', class: 'switch-input', checked: settings[key], onchange: (event) => store.updateSettings({ [key]: event.target.checked }) }),
      h('span', { class: 'switch', 'aria-hidden': 'true' }),
      h('span', null, label, hint && h('span', { class: 'hint block' }, hint)));
    return h('section', { class: 'settings-section' },
      h('h2', null, 'Appearance'),
      choice('theme', 'Theme', [['system', 'Like the system'], ['light', 'Light'], ['dark', 'Dark']], settings.theme),
      choice('noteFont', 'Font for notes', [['serif', 'Serif (Literata)'], ['sans', 'Sans-serif (Source Sans 3)']], settings.noteFont),
      toggle('showBrackets', 'Show [[ ]] around page links'),
      toggle('showTitleInTab', 'Show page titles in the browser tab', 'Titles then also appear in the browser history.'));
  }

  dataSection() {
    const app = this.app;
    const fileInput = h('input', { type: 'file', accept: '.md,.markdown,.txt,.zip', multiple: true, hidden: true });
    fileInput.addEventListener('change', () => this.importChosen(fileInput));
    const section = h('section', { class: 'settings-section' },
      h('h2', null, 'Your data'),
      h('p', { class: 'hint' }, 'Export creates a .zip with one markdown file per page. Import reads .md files or such a .zip; pages that already exist get the imported bullets appended.'),
      h('div', { class: 'settings-actions' },
        h('button', { class: 'btn secondary', type: 'button', onclick: () => this.exportAll() }, 'Export all pages'),
        h('button', { class: 'btn secondary', type: 'button', onclick: () => fileInput.click() }, 'Import markdown…'),
        fileInput));
    if (app.account) {
      section.append(h('label', { class: 'toggle-label setting-toggle' },
        h('input', {
          type: 'checkbox',
          class: 'switch-input',
          checked: app.account.keepUnlocked,
          onchange: async (event) => {
            await app.account.setKeepUnlocked(event.target.checked);
          },
        }),
        h('span', { class: 'switch', 'aria-hidden': 'true' }),
        h('span', null, 'Keep unlocked on this device',
          h('span', { class: 'hint block' }, 'Reloading won\'t ask for the password. Anyone using this browser profile can read your notes. Off by default.'))));
    }
    return section;
  }

  exportAll() {
    const pages = [...this.app.store.index.pages.values()].filter((page) => page.blocks.some((block) => block.text || block.children.length));
    const zip = exportArchive(pages);
    downloadFile(`silva-mentis-${dateKey(new Date())}.zip`, zip, 'application/zip');
    toast(`${pages.length} pages exported.`);
  }

  async importChosen(input) {
    const files = await Promise.all([...input.files].map(async (file) => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) })));
    input.value = '';
    let result;
    try {
      result = await importFiles(files);
    } catch (error) {
      toast(`Import failed: ${error.message}`, { kind: 'error' });
      return;
    }
    const ok = await confirmDialog({
      title: `Import ${result.pages.length} page${result.pages.length === 1 ? '' : 's'}?`,
      message: result.skipped.length ? `Skipped (not markdown): ${result.skipped.slice(0, 5).join(', ')}${result.skipped.length > 5 ? ' …' : ''}` : '',
      confirmLabel: 'Import',
    });
    if (!ok) return;
    const count = this.app.importPages(result.pages);
    toast(`${count} pages imported.`);
  }

  update() {}

  destroy() {}
}
