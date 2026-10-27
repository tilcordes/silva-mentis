import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { crc32, createZip, readZip } from '../../public/js/core/zip.js';

test('crc32 of a known string', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('write and read back', async () => {
  const data = new TextEncoder().encode('hello');
  const zip = createZip([{ name: 'a/ü.md', data }]);
  const [entry] = await readZip(zip);
  assert.equal(entry.name, 'a/ü.md');
  assert.deepEqual(entry.data, data);
});

test('reads deflated entries written by other tools', async () => {
  const content = new TextEncoder().encode('compressed '.repeat(50));
  const compressed = deflateRawSync(content);
  const zip = createZip([{ name: 'x.md', data: compressed }]);
  // Patch the method fields to "deflate" and the sizes to match, as another zipper would write them.
  const view = new DataView(zip.buffer);
  view.setUint16(8, 8, true);
  view.setUint32(22, content.length, true);
  const central = zip.length - 22 - 46 - 4;
  view.setUint16(central + 10, 8, true);
  view.setUint32(central + 24, content.length, true);
  const [entry] = await readZip(zip);
  assert.deepEqual(entry.data, content);
});

test('limits and garbage', async () => {
  const zip = createZip([{ name: 'a', data: new Uint8Array(10) }, { name: 'b', data: new Uint8Array(10) }]);
  await assert.rejects(readZip(zip, { maxEntries: 1 }), /too many/);
  await assert.rejects(readZip(zip, { maxTotalBytes: 15 }), /too large/);
  await assert.rejects(readZip(new Uint8Array(100)), /not a ZIP/);
});
