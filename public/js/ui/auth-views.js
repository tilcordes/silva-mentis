// The screens before the app: first registration (setup), login, unlock and recovery with the
// recovery key. Each screen resolves with the unlocked data key; keys are derived here in the
// browser (crypto/vault.js) and only authKey-type values go to the server.

import {
  createAccountKeys, createRecoveryKey, derivePasswordKeys, passwordProblem, passwordStrength,
  protectWithPassword, recoveryKeysFromText, unwrapWithPassword, unwrapWithRecovery,
} from '../crypto/vault.js';
import { clear, downloadFile, h } from './dom.js';

/** The silva-mentis wordmark ("silva-" + italic accent "mentis") above the tagline. */
export function brand() {
  return h('div', { class: 'brand' },
    h('div', { class: 'wordmark' }, 'silva-', h('span', null, 'mentis')),
    h('p', { class: 'tagline' }, 'The forest of your thinking'));
}

function screen(root, ...children) {
  clear(root).classList.remove('boot');
  const card = h('div', { class: 'auth-card' }, brand(), ...children);
  root.append(h('div', { class: 'auth' }, card));
  return card;
}

function field(label, input, hint = null) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint && h('span', { class: 'hint' }, hint));
}

function errorLine() {
  return h('p', { class: 'form-error', role: 'alert', hidden: true });
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

/** Runs a form action with a busy button; errors appear in `error`. */
function busy(button, error, label, work) {
  return async (event) => {
    event.preventDefault();
    const original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    error.hidden = true;
    try {
      await work();
    } catch (failure) {
      showError(error, failure.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  };
}

/**
 * "New password" + "Repeat password" with a strength hint.
 * @returns {{element: HTMLElement, value: () => string, problem: () => string|null}}
 */
export function newPasswordFields() {
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true, minlength: '12' });
  const repeat = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', required: true });
  const strength = h('span', { class: 'hint strength' }, 'At least 12 characters. A few unrelated words make a strong passphrase.');
  password.addEventListener('input', () => {
    const level = passwordStrength(password.value);
    strength.dataset.level = level.replace(' ', '-');
    strength.textContent = level === 'too short'
      ? `${12 - [...password.value].length} more characters needed.`
      : `Strength: ${level}. Nobody can reset this password for you.`;
  });
  return {
    element: h('div', { class: 'field-group' },
      field('New password', password, strength),
      field('Repeat password', repeat)),
    value: () => password.value,
    problem: () => passwordProblem(password.value) ?? (password.value !== repeat.value ? 'The two passwords are not the same.' : null),
  };
}

/**
 * Shows a recovery key once, with copy and download, and a confirmation checkbox.
 * @param {string} key "K7QF-29XM-…"
 * @param {{username?: string}} [options]
 * @returns {{element: HTMLElement, checkbox: HTMLInputElement}}
 */
export function recoveryKeyPanel(key, { username = '' } = {}) {
  const groups = key.split('-');
  const copyButton = h('button', {
    class: 'btn secondary',
    type: 'button',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(key);
        copyButton.textContent = 'Copied';
      } catch {
        copyButton.textContent = 'Copy failed – write it down';
      }
    },
  }, 'Copy');
  const checkbox = h('input', { type: 'checkbox', required: true });
  const element = h('div', { class: 'recovery-panel' },
    h('p', { class: 'auth-sub' }, 'If you forget your password, this key is the only way to reach your notes again. Nobody can reset it for you.'),
    h('div', { class: 'recovery', 'aria-label': `Recovery key ${key}` }, groups.map((group) => h('span', null, group))),
    h('div', { class: 'btn-row' },
      copyButton,
      h('button', {
        class: 'btn secondary',
        type: 'button',
        onclick: () => downloadFile('silva-mentis-recovery-key.txt', new TextEncoder().encode(
          `silva-mentis recovery key\n\nUsername: ${username}\nRecovery key: ${key}\n\n`
          + `Keep this file somewhere safe and offline. With it, anyone who knows your username can reset your password and read your notes.\n`,
        ), 'text/plain;charset=utf-8'),
      }, 'Download')),
    h('label', { class: 'checkline' }, checkbox, 'I stored it somewhere safe'));
  return { element, checkbox };
}

/**
 * First registration. Resolves when the account exists and the recovery key was confirmed.
 * @param {HTMLElement} root
 * @param {{api: import('../data/api.js').Api, status: object}} context
 * @returns {Promise<{dataKey: CryptoKey, username: string}>}
 */
export async function setupScreen(root, { api, status }) {
  const setup = status.setup ?? {};
  if (setup.problem) {
    screen(root,
      h('h1', null, 'Setup is blocked'),
      h('p', { class: 'auth-sub' }, setup.problem),
      h('p', { class: 'hint' }, 'Give PHP write access to the data folder (on most hosts it already has it), then reload this page.'));
    return new Promise(() => {});
  }
  if (setup.dataPath && await isPubliclyReachable(`${setup.dataPath}/README.md`)) {
    screen(root,
      h('h1', null, 'Your data folder is public'),
      h('p', { class: 'auth-sub' }, `Anyone can download files from ${setup.dataPath}/ on this server. Your encrypted notes and the setup token would be exposed.`),
      h('p', { class: 'hint' }, 'Point the web root of your domain at the "public" folder of silva-mentis (recommended), or make sure .htaccess files are allowed. Then reload this page.'));
    return new Promise(() => {});
  }

  return new Promise((resolve) => {
    const token = h('input', { class: 'input mono', type: 'text', autocomplete: 'off', spellcheck: 'false', required: true });
    const username = h('input', { class: 'input', type: 'text', autocomplete: 'username', required: true, maxlength: '64' });
    const passwords = newPasswordFields();
    const error = errorLine();
    const submit = h('button', { class: 'btn', type: 'submit' }, 'Create account');
    const onSubPath = !/^\/(index\.php)?$/.test(window.location.pathname);
    const form = h('form', { class: 'auth-form' },
      h('div', { class: 'step' }, 'Step 1 of 2'),
      h('h1', null, 'Create your account'),
      onSubPath && h('p', { class: 'warning' }, 'silva-mentis runs in a sub-folder of this domain. Other apps on the same domain could read your unlocked notes; a separate (sub)domain is safer.'),
      field('Setup token', token, `Find it in the file ${setup.tokenFile ?? 'setup-token-….txt'} in the data folder of silva-mentis on your server (FTP or file manager).`),
      field('Username', username),
      passwords.element,
      error,
      submit);
    const card = screen(root, form);
    token.focus();

    form.addEventListener('submit', busy(submit, error, 'Creating keys…', async () => {
      const problem = passwords.problem();
      if (problem) throw new Error(problem);
      const keys = await createAccountKeys(passwords.value());
      await api.setup({ setupToken: token.value, username: username.value.trim(), ...keys.request });
      const panel = recoveryKeyPanel(keys.recoveryKey, { username: username.value.trim() });
      const open = h('button', { class: 'btn', type: 'submit', disabled: true }, 'Open my notes');
      panel.checkbox.addEventListener('change', () => {
        open.disabled = !panel.checkbox.checked;
      });
      const step2 = h('form', { class: 'auth-form' },
        h('div', { class: 'step' }, 'Step 2 of 2'),
        h('h1', null, 'Save your recovery key'),
        panel.element,
        open);
      step2.addEventListener('submit', (event) => {
        event.preventDefault();
        resolve({ dataKey: keys.dataKey, username: username.value.trim() });
      });
      clear(card).append(brand(), step2);
    }));
  });
}

async function isPubliclyReachable(path) {
  try {
    const response = await fetch(path, { cache: 'no-store', credentials: 'omit' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Login (or, with a known username, unlock).
 * @param {HTMLElement} root
 * @param {{api: import('../data/api.js').Api, username?: string|null, canKeepUnlocked?: boolean}} context
 * @returns {Promise<{dataKey: CryptoKey, username: string, keepUnlocked: boolean}>}
 */
export function loginScreen(root, { api, username = null, canKeepUnlocked = true }) {
  return new Promise((resolve) => {
    const usernameInput = h('input', { class: 'input', type: 'text', autocomplete: 'username', required: true, value: username ?? '' });
    const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true });
    const keep = h('input', { type: 'checkbox' });
    const error = errorLine();
    const submit = h('button', { class: 'btn', type: 'submit' }, username ? 'Unlock' : 'Log in');
    const form = h('form', { class: 'auth-form' },
      h('p', { class: 'auth-sub' }, username ? 'Your notes are locked.' : 'Log in to your notes.'),
      username ? h('div', { hidden: true }, usernameInput) : field('Username', usernameInput),
      field('Password', password),
      canKeepUnlocked && h('label', { class: 'checkline' }, keep, 'Keep unlocked on this device'),
      error,
      submit,
      h('p', { class: 'hint' }, 'Notes are decrypted in this browser. The server only ever stores encrypted data.'),
      h('button', {
        class: 'text-btn',
        type: 'button',
        onclick: () => recoveryScreen(root, { api, username: usernameInput.value }).then(resolve),
      }, 'Forgot your password? Use your recovery key'));
    screen(root, form);
    (username ? password : usernameInput).focus();

    form.addEventListener('submit', busy(submit, error, 'Unlocking…', async () => {
      const name = usernameInput.value.trim();
      const { kdf } = await api.loginParams();
      const keys = await derivePasswordKeys(password.value, kdf);
      const response = await api.login(name, keys.authKey);
      const dataKey = await unwrapWithPassword(response.wrappedKey, keys.kek);
      resolve({ dataKey, username: response.username, keepUnlocked: keep.checked });
    }));
  });
}

/**
 * Password reset with the recovery key: sets a new password and creates a new recovery key.
 * @returns {Promise<{dataKey: CryptoKey, username: string, keepUnlocked: boolean}>}
 */
export function recoveryScreen(root, { api, username = '' }) {
  return new Promise((resolve) => {
    const usernameInput = h('input', { class: 'input', type: 'text', autocomplete: 'username', required: true, value: username });
    const key = h('input', { class: 'input mono', type: 'text', autocomplete: 'off', spellcheck: 'false', required: true, placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' });
    const passwords = newPasswordFields();
    const error = errorLine();
    const submit = h('button', { class: 'btn', type: 'submit' }, 'Set new password');
    const form = h('form', { class: 'auth-form' },
      h('h1', null, 'Reset your password'),
      h('p', { class: 'auth-sub' }, 'Your recovery key unlocks your notes; then you choose a new password and get a new recovery key.'),
      field('Username', usernameInput),
      field('Recovery key', key),
      passwords.element,
      error,
      submit,
      h('button', { class: 'text-btn', type: 'button', onclick: () => window.location.reload() }, 'Back to login'));
    const card = screen(root, form);
    key.focus();

    form.addEventListener('submit', busy(submit, error, 'Unlocking…', async () => {
      const problem = passwords.problem();
      if (problem) throw new Error(problem);
      const name = usernameInput.value.trim();
      const recovery = await recoveryKeysFromText(key.value);
      const { recoveryWrappedKey } = await api.recover(name, recovery.authKey);
      const extractable = await unwrapWithRecovery(recoveryWrappedKey, recovery.kek);
      const password = await protectWithPassword(passwords.value(), extractable);
      const newRecovery = await createRecoveryKey(extractable);
      await api.recoverFinish({
        username: name,
        recoveryAuthKey: recovery.authKey,
        newAuthKey: password.authKey,
        newKdf: password.kdf,
        newWrappedKey: password.wrappedKey,
        newRecoveryAuthKey: newRecovery.recoveryAuthKey,
        newRecoveryWrappedKey: newRecovery.recoveryWrappedKey,
      });
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', extractable));
      const dataKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      raw.fill(0);

      const panel = recoveryKeyPanel(newRecovery.text, { username: name });
      const open = h('button', { class: 'btn', type: 'submit', disabled: true }, 'Open my notes');
      panel.checkbox.addEventListener('change', () => {
        open.disabled = !panel.checkbox.checked;
      });
      const done = h('form', { class: 'auth-form' },
        h('h1', null, 'Your new recovery key'),
        h('p', { class: 'hint' }, 'The old recovery key no longer works. Other devices were logged out.'),
        panel.element,
        open);
      done.addEventListener('submit', (event) => {
        event.preventDefault();
        resolve({ dataKey, username: name, keepUnlocked: false });
      });
      clear(card).append(brand(), done);
    }));
  });
}

/**
 * Account actions for the settings screen, bound to the logged-in user.
 * @param {{api: import('../data/api.js').Api, username: string, keepUnlocked: boolean,
 *   setKeepUnlocked: (on: boolean) => Promise<void>, logout: () => Promise<void>}} context
 */
export function accountActions({ api, username, keepUnlocked, setKeepUnlocked, logout }) {
  const account = {
    username,
    keepUnlocked,
    logout,
    async setKeepUnlocked(on) {
      await setKeepUnlocked(on);
      account.keepUnlocked = on;
    },
    /** Proves the password and returns its keys (plus the server's KDF record). */
    async unlockWith(password) {
      const { kdf } = await api.loginParams();
      return derivePasswordKeys(password, kdf);
    },
    /**
     * Proves the password with a fresh login (which also returns the wrapped data key) and
     * unwraps the data key so it can be re-wrapped.
     */
    async unlockExtractable(password) {
      const current = await account.unlockWith(password);
      let login;
      try {
        login = await api.login(username, current.authKey);
      } catch (error) {
        if (error.status === 401) throw new Error('The password is not correct.');
        throw error;
      }
      return { current, extractable: await unwrapWithPassword(login.wrappedKey, current.kek, { extractable: true }) };
    },
    async changePassword(currentPassword, newPassword) {
      const { current, extractable } = await account.unlockExtractable(currentPassword);
      const next = await protectWithPassword(newPassword, extractable);
      await api.changePassword({ authKey: current.authKey, newAuthKey: next.authKey, newKdf: next.kdf, newWrappedKey: next.wrappedKey });
    },
    async replaceRecoveryKey(password) {
      const { current, extractable } = await account.unlockExtractable(password);
      const recovery = await createRecoveryKey(extractable);
      await api.replaceRecoveryKey({ authKey: current.authKey, recoveryAuthKey: recovery.recoveryAuthKey, recoveryWrappedKey: recovery.recoveryWrappedKey });
      return recovery.text;
    },
    async revokeOtherSessions(password) {
      const current = await account.unlockWith(password);
      await api.revokeOtherSessions(current.authKey);
    },
  };
  return account;
}
