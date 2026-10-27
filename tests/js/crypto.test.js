import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRecoveryKey, fromBase32, fromBase64Url, parseRecoveryKey, toBase32, toBase64Url,
} from '../../public/js/crypto/encoding.js';
import {
  createAccountKeys, createKdfRecord, derivePasswordKeys, open, passwordProblem, passwordStrength,
  protectWithPassword, recoveryKeysFromText, seal, unwrapWithPassword, unwrapWithRecovery, validateKdf,
} from '../../public/js/crypto/vault.js';
import { AesCipher, PlainCipher, documentAad, padJson } from '../../public/js/crypto/ciphers.js';

test('base64url round trip without padding', () => {
  for (let length = 0; length < 40; length += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    const text = toBase64Url(bytes);
    assert.ok(!/[+/=]/.test(text));
    assert.deepEqual(fromBase64Url(text), bytes);
  }
  assert.throws(() => fromBase64Url('a+b'));
});

test('base32 and recovery keys', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  assert.deepEqual(fromBase32(toBase32(bytes), 16), bytes);
  const key = formatRecoveryKey(bytes);
  assert.match(key, /^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.deepEqual(parseRecoveryKey(key), bytes);
  assert.deepEqual(parseRecoveryKey(key.toLowerCase().replace(/-/g, ' ')), bytes);
  // Each single-character typo is detected.
  for (let i = 0; i < key.length; i += 1) {
    if (key[i] === '-') continue;
    const typo = key.slice(0, i) + (key[i] === 'A' ? 'B' : 'A') + key.slice(i + 1);
    assert.throws(() => parseRecoveryKey(typo), /typo|recovery key/, typo);
  }
  assert.throws(() => parseRecoveryKey('too short'), /28 characters/);
});

test('kdf records below the minimum are refused', () => {
  const good = createKdfRecord();
  assert.equal(validateKdf(good), good);
  for (const bad of [null, { ...good, iterations: 1000 }, { ...good, alg: 'SHA1' }, { ...good, salt: 'AAAA' }, { ...good, iterations: '600000' }]) {
    assert.throws(() => validateKdf(bad), /unsafe/);
  }
});

test('password rules and strength hint', () => {
  assert.match(passwordProblem('short'), /12 characters/);
  assert.equal(passwordProblem('correct horse battery'), null);
  assert.equal(passwordStrength('abc'), 'too short');
  assert.equal(passwordStrength('correct horse battery staple'), 'strong');
});

test('setup keys: login unwraps the same data key, recovery too', async () => {
  const { request, recoveryKey, dataKey } = await createAccountKeys('a long enough passphrase');
  assert.match(request.authKey, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(dataKey.extractable, false);

  const payload = await seal(dataKey, new TextEncoder().encode('secret'), 'test');
  const { authKey, kek } = await derivePasswordKeys('a long enough passphrase', request.kdf);
  assert.equal(authKey, request.authKey);
  const unwrapped = await unwrapWithPassword(request.wrappedKey, kek);
  assert.equal(new TextDecoder().decode(await open(unwrapped, payload, 'test')), 'secret');

  const recovery = await recoveryKeysFromText(recoveryKey);
  assert.equal(recovery.authKey, request.recoveryAuthKey);
  const viaRecovery = await unwrapWithRecovery(request.recoveryWrappedKey, recovery.kek);
  assert.equal(new TextDecoder().decode(await open(viaRecovery, payload, 'test')), 'secret');

  const wrong = await derivePasswordKeys('a long enough passphrasE', request.kdf);
  assert.notEqual(wrong.authKey, request.authKey);
  await assert.rejects(unwrapWithPassword(request.wrappedKey, wrong.kek), /Decryption failed/);
  // The two wrapped keys can't be swapped (different associated data).
  await assert.rejects(unwrapWithPassword(request.recoveryWrappedKey, kek), /Decryption failed/);
});

test('password change re-wraps the same data key under a new salt', async () => {
  const { request } = await createAccountKeys('first passphrase here');
  const { kek } = await derivePasswordKeys('first passphrase here', request.kdf);
  const extractable = await unwrapWithPassword(request.wrappedKey, kek, { extractable: true });
  const changed = await protectWithPassword('second passphrase here', extractable);
  assert.notEqual(changed.kdf.salt, request.kdf.salt);
  const next = await derivePasswordKeys('second passphrase here', changed.kdf);
  const key = await unwrapWithPassword(changed.wrappedKey, next.kek, { extractable: true });
  const a = new Uint8Array(await crypto.subtle.exportKey('raw', extractable));
  const b = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  assert.deepEqual(a, b);
});

test('NFC normalisation: composed and decomposed passwords match', async () => {
  const kdf = createKdfRecord();
  const composed = await derivePasswordKeys('Grüße aus Köln!', kdf);
  const decomposed = await derivePasswordKeys('Grüße aus Köln!', kdf);
  assert.equal(composed.authKey, decomposed.authKey);
});

test('document cipher: padding, id binding, tampering', async () => {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const cipher = new AesCipher(key);
  const doc = { kind: 'page', title: 'Ünïcode ✓', blocks: [] };
  const payload = await cipher.encrypt('p1', doc);
  const envelope = JSON.parse(payload);
  assert.equal(envelope.v, 1);
  assert.equal(envelope.kid, 'k1');
  assert.equal(fromBase64Url(envelope.ct).length, 512 + 16);
  assert.deepEqual(await cipher.decrypt('p1', payload), doc);
  await assert.rejects(cipher.decrypt('p2', payload), /Decryption failed/);
  const tampered = JSON.stringify({ ...envelope, ct: envelope.ct.slice(0, -2) + (envelope.ct.endsWith('AA') ? 'BA' : 'AA') });
  await assert.rejects(cipher.decrypt('p1', tampered), /Decryption failed/);
  await assert.rejects(cipher.decrypt('p1', JSON.stringify({ v: 0, plain: doc })), /unknown format/);
  assert.equal(padJson('x'.repeat(511)).length, 512);
  assert.equal(padJson('x'.repeat(512)).length, 1024);
  assert.equal(documentAad('p1'), 'silva-mentis/v1/document/p1');
});

test('plain cipher of the test version refuses encrypted envelopes', async () => {
  const plain = new PlainCipher();
  const payload = await plain.encrypt('p1', { kind: 'page' });
  assert.deepEqual(await plain.decrypt('p1', payload), { kind: 'page' });
  await assert.rejects(plain.decrypt('p1', '{"v":1,"iv":"a","ct":"b"}'), /not a test-version/);
});
