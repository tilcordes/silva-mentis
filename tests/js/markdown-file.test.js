import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  exportArchive, importFiles, markdownToPage, pageToMarkdown, parseOutlineText, safeFileName,
} from '../../public/js/core/markdown-file.js';
import { readZip } from '../../public/js/core/zip.js';
import { page, shape } from './helpers.js';

test('a page as markdown and back keeps title, times and outline', () => {
  const original = page('Medley 192: 1/13/2020', ['Intro', ['nested **bold**', 'two\nlines'], '```js\ncode\n```', '[ ] task']);
  const text = pageToMarkdown(original);
  assert.match(text, /^---\ntitle: "Medley 192: 1\/13\/2020"\n/);
  const back = markdownToPage(text, 'Medley 192- 1-13-2020.md');
  assert.equal(back.title, 'Medley 192: 1/13/2020');
  assert.equal(back.created, original.created);
  assert.deepEqual(shape(back.blocks), shape(original.blocks));
});

test('files without front matter take the title from the file name', () => {
  const result = markdownToPage('- one\n    - two\n- three', 'notes/Waking Up.md');
  assert.equal(result.title, 'Waking Up');
  assert.deepEqual(shape(result.blocks), ['one', ['two'], 'three']);
});

test('pasted text: lists nest by indentation, other lines become bullets', () => {
  assert.deepEqual(shape(parseOutlineText('first line\nsecond line\n\nthird')), ['first line', 'second line', 'third']);
  assert.deepEqual(shape(parseOutlineText('* a\n\t* b\n\t\t* c\n* d\n1. e')), ['a', ['b', ['c']], 'd', 'e']);
  assert.deepEqual(shape(parseOutlineText('- item\n  continued\n- ```\n  code\n\n  more\n  ```')), ['item\ncontinued', '```\ncode\n\nmore\n```']);
  assert.deepEqual(shape(parseOutlineText('-\n- x')), ['', 'x']);
});

test('file names are safe and unique', () => {
  const used = new Set();
  assert.equal(safeFileName('Medley 192: 1/13/2020', used), 'Medley 192- 1-13-2020.md');
  assert.equal(safeFileName('medley 192: 1/13/2020', used), 'medley 192- 1-13-2020 (2).md');
  assert.equal(safeFileName('../../etc/passwd', used), '-..-etc-passwd.md');
  assert.equal(safeFileName('CON', used), '_CON.md');
  assert.equal(safeFileName('...', used), 'Untitled.md');
  assert.equal(safeFileName('a\u0000b', used), 'a-b.md');
});

test('export archive and import round trip', async () => {
  const pages = [page('Medley 192: 1/13/2020', ['x [[Y]]']), page('Y', ['why', ['because']]), page('Ümläut ✓', ['ok'])];
  const zip = exportArchive(pages);
  const entries = await readZip(zip);
  assert.deepEqual(entries.map((e) => e.name).sort(), ['Medley 192- 1-13-2020.md', 'Y.md', 'Ümläut ✓.md']);
  const { pages: imported, skipped } = await importFiles([
    { name: 'export.zip', data: zip },
    { name: 'photo.jpg', data: new Uint8Array([1]) },
  ]);
  assert.deepEqual(skipped, ['photo.jpg']);
  assert.deepEqual(imported.map((p) => p.title).sort(), pages.map((p) => p.title).sort());
  assert.deepEqual(shape(imported.find((p) => p.title === 'Y').blocks), ['why', ['because']]);
});
