// The whole protocol against the real server: setup → login → save → sync → conflict →
// password change → recovery, using the same crypto and store code as the browser.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { startServer } from '../support/server.js';
import { Api } from '../../public/js/data/api.js';
import { Store } from '../../public/js/data/store.js';
import { AesCipher } from '../../public/js/crypto/ciphers.js';
import {
  createAccountKeys, createRecoveryKey, derivePasswordKeys, protectWithPassword, recoveryKeysFromText,
  unwrapWithPassword, unwrapWithRecovery,
} from '../../public/js/crypto/vault.js';

const PASSWORD = 'correct horse battery staple';
let server;

before(async () => {
  server = await startServer({ mode: 'normal' });
});
after(async () => {
  await server?.stop();
});

/** An Api whose fetch keeps cookies, like one browser. */
function browserApi() {
  const jar = new Map();
  const fetchWithCookies = async (url, options = {}) => {
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await fetch(new URL(url, server.url), { ...options, headers: { ...options.headers, ...(cookie ? { Cookie: cookie } : {}) } });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, value] = pair.split('=');
      if (value === '' || /Max-Age=0/.test(header)) jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  };
  return new Api(`${server.url}/api.php`, fetchWithCookies);
}

async function login(api, password = PASSWORD) {
  const { kdf } = await api.loginParams();
  const keys = await derivePasswordKeys(password, kdf);
  const response = await api.login('ada', keys.authKey);
  return unwrapWithPassword(response.wrappedKey, keys.kek);
}

let recoveryKey;

test('setup with the token from the data folder', async () => {
  const api = browserApi();
  const status = await api.status();
  assert.equal(status.needsSetup, true);
  assert.match(server.output(), /silva-mentis setup token: [0-9a-f]{32}/, 'php -S prints the token');
  const token = readFileSync(`${server.dataDir}/${status.setup.tokenFile}`, 'utf8').trim();
  const keys = await createAccountKeys(PASSWORD);
  await assert.rejects(api.setup({ setupToken: '0'.repeat(32), username: 'ada', ...keys.request }), /setup token is not correct/);
  await api.setup({ setupToken: token, username: 'ada', ...keys.request });
  recoveryKey = keys.recoveryKey;
  assert.deepEqual(readdirSync(server.dataDir).filter((f) => f.startsWith('setup-token')), []);
  const after = await api.status();
  assert.equal(after.authenticated, true);
  assert.equal(after.username, 'ada');
});

test('two devices: save, sync, conflict copy — server sees only ciphertext', async () => {
  const laptop = new Store({ api: browserApi(), cipher: null });
  laptop.cipher = new AesCipher(await login(laptop.api));
  await laptop.loadAll();
  const page = laptop.createPage('Waking Up', [{ id: 'b1', text: 'by [[Sam Harris]] #Secret', children: [] }]);
  await laptop.flush();

  const phone = new Store({ api: browserApi(), cipher: null });
  phone.cipher = new AesCipher(await login(phone.api));
  await phone.loadAll();
  assert.equal(phone.getPage(page.id).blocks[0].text, 'by [[Sam Harris]] #Secret');

  phone.updatePage(page.id, (blocks) => { blocks[0].text = 'phone edit'; });
  await phone.flush();
  laptop.updatePage(page.id, (blocks) => { blocks[0].text = 'laptop edit'; });
  await laptop.flush();
  assert.equal(laptop.getPage(page.id).blocks[0].text, 'phone edit');
  const copy = [...laptop.index.pages.values()].find((p) => p.title.startsWith('Waking Up (conflict copy'));
  assert.equal(copy.blocks[0].text, 'laptop edit');
  await phone.sync();
  assert.ok(phone.index.pageByTitle(copy.title), 'the conflict copy reaches the other device');

  const database = readFileSync(`${server.dataDir}/silva-mentis.sqlite`);
  for (const secret of ['Waking Up', 'Sam Harris', 'Secret', 'laptop edit', 'phone edit']) {
    assert.equal(database.includes(secret), false, `"${secret}" must not be in the database`);
  }
  laptop.dispose();
  phone.dispose();
});

test('password change keeps the data key and logs out other devices', async () => {
  const other = browserApi();
  await login(other);
  const api = browserApi();
  const { kdf } = await api.loginParams();
  const current = await derivePasswordKeys(PASSWORD, kdf);
  const response = await api.login('ada', current.authKey);
  const extractable = await unwrapWithPassword(response.wrappedKey, current.kek, { extractable: true });
  const next = await protectWithPassword('a brand new passphrase', extractable);
  await api.changePassword({ authKey: current.authKey, newAuthKey: next.authKey, newKdf: next.kdf, newWrappedKey: next.wrappedKey });

  await assert.rejects(other.documents(), /session has ended/);
  await assert.rejects(login(browserApi()), /Wrong username or password/);
  const key = await login(browserApi(), 'a brand new passphrase');
  const store = new Store({ api: api, cipher: new AesCipher(key) });
  await store.loadAll();
  assert.ok(store.index.pageByTitle('Waking Up'), 'old documents still decrypt');
  store.dispose();
});

test('recovery: the recovery key resets the password and is replaced', async () => {
  const api = browserApi();
  const recovery = await recoveryKeysFromText(recoveryKey);
  const { recoveryWrappedKey } = await api.recover('ada', recovery.authKey);
  const extractable = await unwrapWithRecovery(recoveryWrappedKey, recovery.kek);
  const password = await protectWithPassword('recovered passphrase', extractable);
  const fresh = await createRecoveryKey(extractable);
  await api.recoverFinish({
    username: 'ada',
    recoveryAuthKey: recovery.authKey,
    newAuthKey: password.authKey,
    newKdf: password.kdf,
    newWrappedKey: password.wrappedKey,
    newRecoveryAuthKey: fresh.recoveryAuthKey,
    newRecoveryWrappedKey: fresh.recoveryWrappedKey,
  });
  const store = new Store({ api, cipher: new AesCipher(await login(api, 'recovered passphrase')) });
  await store.loadAll();
  assert.ok(store.index.pageByTitle('Waking Up'));
  store.dispose();
  await assert.rejects(browserApi().recover('ada', recovery.authKey), /Wrong username or recovery key/);
});

test('security headers and CSRF header on the real server', async () => {
  const shell = await fetch(`${server.url}/`);
  assert.match(shell.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(shell.headers.get('x-frame-options'), 'DENY');
  const html = await shell.text();
  assert.match(html, /<script type="module" src="js\/main.js"><\/script>/);
  const noHeader = await fetch(`${server.url}/api.php?route=status`);
  assert.equal(noHeader.status, 403);
  assert.equal(noHeader.headers.get('content-type'), 'application/json; charset=utf-8');
});
