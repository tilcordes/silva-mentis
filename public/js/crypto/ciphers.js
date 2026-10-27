// How a page document becomes the payload string the server stores. Normal mode encrypts with
// the data key; the test version stores readable JSON. Each refuses the other's format, so test
// data can never end up inside a real vault.

import { utf8 } from './encoding.js';
import { openText, seal } from './vault.js';

const PADDING_BLOCK = 512;

/** The additional authenticated data for a document: the ciphertext only opens under its own id. */
export function documentAad(id) {
  return `silva-mentis/v1/document/${id}`;
}

/**
 * Pads JSON text with spaces to a multiple of 512 bytes, so the server learns less from sizes.
 * @param {string} json
 * @returns {Uint8Array}
 */
export function padJson(json) {
  const bytes = utf8(json);
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / PADDING_BLOCK) * PADDING_BLOCK).fill(0x20);
  padded.set(bytes);
  return padded;
}

export class AesCipher {
  /** @param {CryptoKey} dataKey */
  constructor(dataKey) {
    this.dataKey = dataKey;
    this.encrypted = true;
  }

  /**
   * @param {string} id document id
   * @param {object} document
   * @returns {Promise<string>} payload
   */
  async encrypt(id, document) {
    return seal(this.dataKey, padJson(JSON.stringify(document)), documentAad(id));
  }

  /**
   * @param {string} id
   * @param {string} payload
   * @returns {Promise<object>}
   */
  async decrypt(id, payload) {
    return JSON.parse(await openText(this.dataKey, payload, documentAad(id)));
  }
}

export class PlainCipher {
  constructor() {
    this.encrypted = false;
  }

  async encrypt(id, document) {
    return JSON.stringify({ v: 0, plain: document });
  }

  async decrypt(id, payload) {
    const envelope = JSON.parse(payload);
    if (!envelope || envelope.v !== 0 || typeof envelope.plain !== 'object') {
      throw new Error('This is not a test-version document.');
    }
    return envelope.plain;
  }
}
