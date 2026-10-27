import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchBlocks, searchTitles, snippet } from '../../public/js/core/search.js';
import { indexOf, page } from './helpers.js';

test('titles: exact, prefix, word prefix, substring; case-insensitive', () => {
  const index = indexOf(
    page('Art'), page('Article: Why I Take Notes'), page('Pop Art'), page('Smart'), page('Areas'),
    page('Daily', ['[[Art Direction]] [[Art Direction]]', '[[Art Direction]]']),
  );
  assert.deepEqual(searchTitles(index, 'art').map((r) => r.title),
    ['Art', 'Art Direction', 'Article: Why I Take Notes', 'Pop Art', 'Smart']);
  assert.equal(searchTitles(index, 'ART')[0].title, 'Art');
  assert.equal(searchTitles(index, '   ').length, 0);
  assert.equal(searchTitles(index, 'direction')[0].virtual, true);
});

test('bullets containing all words, with snippets', () => {
  const index = indexOf(page('A', ['Coffee with [[Jonas Weber]] about books', 'coffee only']), page('B', ['jonas likes COFFEE']));
  const results = searchBlocks(index, 'coffee jonas');
  assert.deepEqual(results.map((r) => r.title).sort(), ['A', 'B']);
  assert.equal(results.find((r) => r.title === 'A').snippet, 'Coffee with Jonas Weber about books');
});

test('snippets cut long text around the match', () => {
  const text = `${'x '.repeat(100)}needle${' y'.repeat(100)}`;
  const result = snippet(text, 'needle', 10);
  assert.ok(result.startsWith('…') && result.endsWith('…') && result.includes('needle'));
});
