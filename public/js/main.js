// Boot: ask the server what state it is in, then show setup, login or unlock (normal mode) or
// go straight to the notes (test version), and finally start the app with the right cipher.

import { Api } from './data/api.js';
import { Store } from './data/store.js';
import { AesCipher, PlainCipher } from './crypto/ciphers.js';
import { deleteKey, loadKey, storeKey } from './data/key-storage.js';
import { App } from './ui/app.js';
import { accountActions, brand, loginScreen, setupScreen } from './ui/auth-views.js';
import { passwordDialog, toast } from './ui/dialogs.js';
import { clear, h } from './ui/dom.js';
import { sampleNotes } from './test-mode/sample-notes.js';

const root = document.getElementById('app');

function applyStoredTheme(mode) {
  try {
    const theme = localStorage.getItem(`silva-mentis:${mode}:theme`);
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch {
    // no storage: follow the system theme
  }
}

function fatal(title, message) {
  clear(root).classList.remove('boot');
  root.append(h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, brand(), h('h1', null, title), h('p', { class: 'auth-sub' }, message))));
}

function loading(message) {
  clear(root).classList.add('boot');
  root.append(h('p', { class: 'boot-message' }, message));
}

async function boot() {
  const api = new Api();
  let status;
  try {
    status = await api.status();
  } catch (error) {
    fatal('silva-mentis can’t start', error.message);
    return;
  }
  applyStoredTheme(status.mode);
  if (status.mode === 'test') {
    await startTestVersion(api);
    return;
  }
  if (!window.isSecureContext || !crypto?.subtle) {
    fatal('A secure connection is needed', 'Your notes are encrypted in the browser, which browsers only allow over HTTPS (or on localhost). Open this site with https://.');
    return;
  }
  await startNormal(api, status);
}

async function startTestVersion(api) {
  loading('Loading test notes…');
  const store = new Store({ api, cipher: new PlainCipher() });
  await store.loadAll({ seed: sampleNotes });
  new App({
    root,
    store,
    mode: 'test',
    account: null,
    onTestReset: async () => {
      store.dispose();
      await api.testReset();
      window.location.replace(window.location.pathname);
    },
  });
}

async function startNormal(api, status) {
  const keyName = 'data-key:normal';
  let session = null;

  if (status.needsSetup) {
    session = { ...(await setupScreen(root, { api, status })), keepUnlocked: false };
  } else if (status.authenticated) {
    const stored = await loadKey(keyName);
    if (stored) session = { dataKey: stored, username: status.username, keepUnlocked: true };
    else session = await loginScreen(root, { api, username: status.username });
  } else {
    await deleteKey(keyName); // the session ended, so the stored key goes too
    session = await loginScreen(root, { api });
  }

  if (session.keepUnlocked) await storeKey(keyName, session.dataKey);

  loading('Decrypting your notes…');
  const store = new Store({ api, cipher: new AesCipher(session.dataKey) });
  try {
    await store.loadAll();
  } catch (error) {
    if (error.status === 401) {
      await deleteKey(keyName);
      window.location.reload();
      return;
    }
    fatal('Your notes could not be loaded', error.message);
    return;
  }

  const logout = async () => {
    await store.flush().catch(() => {});
    store.dispose();
    await api.logout().catch(() => {});
    await deleteKey(keyName);
    // A fresh page load leaves nothing decrypted in memory.
    window.location.replace(window.location.pathname);
  };
  const account = accountActions({
    api,
    username: session.username,
    keepUnlocked: session.keepUnlocked,
    setKeepUnlocked: async (on) => {
      if (on) await storeKey(keyName, session.dataKey);
      else await deleteKey(keyName);
    },
    logout,
  });

  // When the server ends the session (expired, logged out elsewhere), ask for the password
  // again instead of throwing away unsaved changes.
  let relocking = false;
  const relock = async () => {
    if (relocking) return;
    relocking = true;
    await deleteKey(keyName);
    const ok = await passwordDialog({
      title: 'Your session ended',
      message: 'Enter your password to keep working. Unsaved changes are kept.',
      confirmLabel: 'Log in',
      action: async (password) => {
        const keys = await account.unlockWith(password);
        await api.login(session.username, keys.authKey);
      },
    });
    relocking = false;
    if (!ok) {
      window.location.replace(window.location.pathname);
      return;
    }
    if (account.keepUnlocked) await storeKey(keyName, session.dataKey);
    toast('Logged in again.');
    store.flush().catch(() => {});
  };
  store.addEventListener('locked', relock);

  new App({ root, store, mode: 'normal', account });
}

// Coming back through the back/forward cache: check the lock state again.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

boot().catch((error) => {
  console.error(error);
  fatal('Something went wrong', error.message);
});
