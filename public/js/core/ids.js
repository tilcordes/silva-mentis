// Random identifiers for pages and blocks. They only need to be unique, not secret, but using
// the platform's cryptographic generator avoids collisions between devices.

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Returns a new random id such as "p7k2m9x0qd4hs1ve".
 * @param {string} prefix one letter that tells what the id is for ('p' page, 'b' block)
 * @param {number} [length=15] number of random characters
 * @returns {string}
 */
export function newId(prefix, length = 15) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = prefix;
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
  return id;
}
