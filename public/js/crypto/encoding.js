// Byte encodings used by the encryption protocol: base64url (no padding) for keys and
// ciphertexts, UTF-8 for text, and Crockford base32 for the human-readable recovery key.

/**
 * @param {Uint8Array} bytes
 * @returns {string} base64url without padding
 */
export function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} text base64url, with or without padding
 * @returns {Uint8Array}
 */
export function fromBase64Url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(text)) throw new Error('Invalid base64url data.');
  const base64 = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** @param {string} text @returns {Uint8Array} */
export function utf8(text) {
  return new TextEncoder().encode(text);
}

/** @param {Uint8Array|ArrayBuffer} bytes @returns {string} */
export function fromUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** @param {number} length @returns {Uint8Array} */
export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

// Crockford's alphabet leaves out I, L, O and U, so the key can be read aloud and typed without
// confusing 1/I/L or 0/O.
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHECKSUM_MODULUS = 1021; // prime below 32²; catches any single typo and swapped neighbours

/**
 * @param {Uint8Array} bytes
 * @returns {string} base32 characters (5 bits each, last group zero-padded)
 */
export function toBase32(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

/**
 * @param {string} text base32 characters (already normalised)
 * @param {number} byteLength how many bytes to read
 * @returns {Uint8Array}
 */
export function fromBase32(text, byteLength) {
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of text) {
    const digit = BASE32.indexOf(char);
    if (digit < 0) throw new Error(`"${char}" is not part of a recovery key.`);
    value = ((value << 5) | digit) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes.slice(0, byteLength));
}

function checksum(characters) {
  let sum = 0;
  for (let i = 0; i < characters.length; i += 1) sum = (sum + (i + 1) * (BASE32.indexOf(characters[i]) + 1)) % CHECKSUM_MODULUS;
  return BASE32[Math.floor(sum / 32)] + BASE32[sum % 32];
}

/**
 * Formats 16 key bytes as 26 base32 characters plus 2 checksum characters, in groups of four:
 * "K7QF-29XM-D4RT-8WQN-H2LC-6PVZ-J9AB".
 * @param {Uint8Array} bytes 16 bytes
 * @returns {string}
 */
export function formatRecoveryKey(bytes) {
  const body = toBase32(bytes);
  return (body + checksum(body)).match(/.{1,4}/g).join('-');
}

/**
 * Reads a typed recovery key. Spaces, dashes and case don't matter; O counts as 0 and I/L as 1.
 * @param {string} text
 * @returns {Uint8Array} the 16 key bytes
 * @throws {Error} with a message for the person typing it
 */
export function parseRecoveryKey(text) {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 28) throw new Error('A recovery key has 28 characters.');
  const body = clean.slice(0, 26);
  for (const char of clean) if (!BASE32.includes(char)) throw new Error(`"${char}" is not part of a recovery key.`);
  if (checksum(body) !== clean.slice(26)) throw new Error('This recovery key contains a typo.');
  return fromBase32(body, 16);
}
