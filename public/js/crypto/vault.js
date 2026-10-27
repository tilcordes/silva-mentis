// Key handling with WebCrypto. The password and every key except
// authKey stay in this browser; authKey proves the password to the server but can't decrypt.
//
//   password ─PBKDF2─► master ─HKDF─► authKey (to the server)
//                              └HKDF─► KEK (wraps the data key)
//   recovery key ─HKDF─► recoveryAuthKey (to the server), recoveryKEK (wraps the data key)

import { formatRecoveryKey, fromBase64Url, fromUtf8, parseRecoveryKey, randomBytes, toBase64Url, utf8 } from './encoding.js';

export const KDF_ALGORITHM = 'PBKDF2-SHA256';
export const KDF_ITERATIONS = 600000;
export const MIN_PASSWORD_LENGTH = 12;
export const KEY_ID = 'k1';

const INFO = {
  auth: 'silva-mentis/v1/auth',
  kek: 'silva-mentis/v1/kek',
  recoveryAuth: 'silva-mentis/v1/recovery-auth',
  recoveryKek: 'silva-mentis/v1/recovery-kek',
};
const AAD_WRAPPED = 'silva-mentis/v1/wrapped-key';
const AAD_RECOVERY = 'silva-mentis/v1/recovery-wrapped-key';

/** A fresh KDF record with a new random salt. */
export function createKdfRecord() {
  return { alg: KDF_ALGORITHM, iterations: KDF_ITERATIONS, salt: toBase64Url(randomBytes(16)) };
}

/**
 * Refuses records that would make the password cheap to guess, whoever sent them.
 * @param {unknown} kdf
 * @returns {{alg: string, iterations: number, salt: string}}
 */
export function validateKdf(kdf) {
  if (!kdf || kdf.alg !== KDF_ALGORITHM || !Number.isInteger(kdf.iterations) || kdf.iterations < KDF_ITERATIONS
    || typeof kdf.salt !== 'string') {
    throw new Error('The server sent unsafe key-derivation settings. Your password was not used.');
  }
  if (fromBase64Url(kdf.salt).length < 16) throw new Error('The server sent unsafe key-derivation settings. Your password was not used.');
  return kdf;
}

/**
 * Checks the length rule for new passwords.
 * @param {string} password
 * @returns {string|null} a message, or null if the password is acceptable
 */
export function passwordProblem(password) {
  if ([...password.normalize('NFC')].length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A few unrelated words make a strong passphrase.`;
  }
  return null;
}

/**
 * A rough hint for the setup form, not a security guarantee.
 * @param {string} password
 * @returns {'too short'|'weak'|'fair'|'strong'}
 */
export function passwordStrength(password) {
  const length = [...password].length;
  if (length < MIN_PASSWORD_LENGTH) return 'too short';
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  const words = password.trim().split(/\s+/).length;
  if (length >= 20 || (words >= 4 && length >= 16)) return 'strong';
  if (length >= 14 && classes >= 2) return 'fair';
  return 'weak';
}

async function hkdfBytes(material, info) {
  const base = await crypto.subtle.importKey('raw', material, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) }, base, 256,
  ));
}

async function hkdfKey(material, info) {
  const base = await crypto.subtle.importKey('raw', material, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Derives authKey and KEK from a password (about half a second on purpose).
 * @param {string} password
 * @param {{alg: string, iterations: number, salt: string}} kdf
 * @returns {Promise<{authKey: string, kek: CryptoKey}>}
 */
export async function derivePasswordKeys(password, kdf) {
  validateKdf(kdf);
  const passwordKey = await crypto.subtle.importKey('raw', utf8(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const master = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64Url(kdf.salt), iterations: kdf.iterations }, passwordKey, 256,
  ));
  try {
    return { authKey: toBase64Url(await hkdfBytes(master, INFO.auth)), kek: await hkdfKey(master, INFO.kek) };
  } finally {
    master.fill(0);
  }
}

/**
 * Derives recoveryAuthKey and recoveryKEK from the recovery key's 16 bytes.
 * @param {Uint8Array} recoveryBytes
 * @returns {Promise<{authKey: string, kek: CryptoKey}>}
 */
export async function deriveRecoveryKeys(recoveryBytes) {
  return {
    authKey: toBase64Url(await hkdfBytes(recoveryBytes, INFO.recoveryAuth)),
    kek: await hkdfKey(recoveryBytes, INFO.recoveryKek),
  };
}

/**
 * Encrypts bytes into the JSON envelope {v, kid, iv, ct}.
 * @param {CryptoKey} key
 * @param {Uint8Array} plaintext
 * @param {string} aad binds the ciphertext to its purpose (e.g. the document id)
 * @returns {Promise<string>}
 */
export async function seal(key, plaintext, aad) {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, plaintext);
  return JSON.stringify({ v: 1, kid: KEY_ID, iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ciphertext)) });
}

/**
 * Decrypts an envelope made by seal(). Anything but a version-1 envelope is refused.
 * @param {CryptoKey} key
 * @param {string} envelopeText
 * @param {string} aad
 * @returns {Promise<Uint8Array>}
 */
export async function open(key, envelopeText, aad) {
  let envelope;
  try {
    envelope = JSON.parse(envelopeText);
  } catch {
    throw new Error('The encrypted data is damaged.');
  }
  if (!envelope || envelope.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') {
    throw new Error('The encrypted data has an unknown format.');
  }
  const iv = fromBase64Url(envelope.iv);
  if (iv.length !== 12) throw new Error('The encrypted data is damaged.');
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, fromBase64Url(envelope.ct),
    ));
  } catch {
    throw new Error('Decryption failed: wrong key or damaged data.');
  }
}

async function wrapDataKey(dataKey, kek, aad) {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dataKey));
  try {
    return await seal(kek, raw, aad);
  } finally {
    raw.fill(0);
  }
}

async function unwrapDataKey(wrapped, kek, aad, extractable) {
  const raw = await open(kek, wrapped, aad);
  try {
    if (raw.length !== 32) throw new Error('The stored key is damaged.');
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
}

/**
 * Unwraps the data key after a password login. The result can't be exported, so even a
 * script running later in this page can't copy the key out (it could still use it).
 * @param {string} wrappedKey
 * @param {CryptoKey} kek
 * @param {{extractable?: boolean}} [options] extractable is needed only to re-wrap the key
 * @returns {Promise<CryptoKey>}
 */
export function unwrapWithPassword(wrappedKey, kek, { extractable = false } = {}) {
  return unwrapDataKey(wrappedKey, kek, AAD_WRAPPED, extractable);
}

/**
 * @param {string} recoveryWrappedKey
 * @param {CryptoKey} recoveryKek
 * @returns {Promise<CryptoKey>} extractable, because recovery re-wraps it at once
 */
export function unwrapWithRecovery(recoveryWrappedKey, recoveryKek) {
  return unwrapDataKey(recoveryWrappedKey, recoveryKek, AAD_RECOVERY, true);
}

/**
 * A new recovery key for an (extractable) data key.
 * @param {CryptoKey} dataKey
 * @returns {Promise<{text: string, recoveryAuthKey: string, recoveryWrappedKey: string}>}
 */
export async function createRecoveryKey(dataKey) {
  const bytes = randomBytes(16);
  const { authKey, kek } = await deriveRecoveryKeys(bytes);
  return { text: formatRecoveryKey(bytes), recoveryAuthKey: authKey, recoveryWrappedKey: await wrapDataKey(dataKey, kek, AAD_RECOVERY) };
}

/**
 * New password material for an (extractable) data key: new salt, new authKey, new wrapped key.
 * @param {string} password
 * @param {CryptoKey} dataKey
 * @returns {Promise<{authKey: string, kdf: object, wrappedKey: string}>}
 */
export async function protectWithPassword(password, dataKey) {
  const kdf = createKdfRecord();
  const { authKey, kek } = await derivePasswordKeys(password, kdf);
  return { authKey, kdf, wrappedKey: await wrapDataKey(dataKey, kek, AAD_WRAPPED) };
}

/**
 * Everything the setup request needs, plus the recovery key to show and the data key to use.
 * @param {string} password
 * @returns {Promise<{request: object, recoveryKey: string, dataKey: CryptoKey}>}
 */
export async function createAccountKeys(password) {
  const extractable = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const passwordPart = await protectWithPassword(password, extractable);
  const recovery = await createRecoveryKey(extractable);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', extractable));
  const dataKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  raw.fill(0);
  return {
    request: {
      authKey: passwordPart.authKey,
      kdf: passwordPart.kdf,
      wrappedKey: passwordPart.wrappedKey,
      recoveryAuthKey: recovery.recoveryAuthKey,
      recoveryWrappedKey: recovery.recoveryWrappedKey,
    },
    recoveryKey: recovery.text,
    dataKey,
  };
}

/**
 * Turns a typed recovery key into its server proof and unwrapping key.
 * @param {string} text
 * @returns {Promise<{authKey: string, kek: CryptoKey}>}
 */
export function recoveryKeysFromText(text) {
  return deriveRecoveryKeys(parseRecoveryKey(text));
}

/** For document code that wants text out of open(). */
export async function openText(key, envelopeText, aad) {
  return fromUtf8(await open(key, envelopeText, aad));
}
