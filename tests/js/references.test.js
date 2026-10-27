import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockReferences, findMentions, linkMention, renameInText, renameInTitle, titleReferences,
} from '../../public/js/core/references.js';

test('a block references links, nested links, tags, aliases and attribute names', () => {
  assert.deepEqual(
    blockReferences('Author:: [[Article: [[Writing]] tips]] #Books #[[Modern Religion]] [x]([[Alias]]) [[Books]]'),
    ['Author', 'Article: [[Writing]] tips', 'Writing', 'Books', 'Modern Religion', 'Alias'],
  );
});

test('code never references anything', () => {
  assert.deepEqual(blockReferences('`[[Hidden]]` and\n```\n#nope [[No]]\n```'), []);
});

test('a title references the pages linked inside it', () => {
  assert.deepEqual(titleReferences('Article: [[Writing]] tips about [[Notes]]'), ['Writing', 'Notes']);
  assert.deepEqual(titleReferences('C# #notatag'), []);
});

test('rename rewrites links, nested links, tags, aliases and attributes', () => {
  const text = 'Old:: [[Old]] #Old #[[Old]] [o]([[Old]]) [[Article: [[Old]] tips]] [[Older]] `[[Old]]`';
  assert.equal(
    renameInText(text, 'Old', 'New Name'),
    'New Name:: [[New Name]] #[[New Name]] #[[New Name]] [o]([[New Name]]) [[Article: [[New Name]] tips]] [[Older]] `[[Old]]`',
  );
  assert.equal(renameInText('#[[apple watch]] [[apple watch]]', 'apple watch', 'Watch'), '#Watch [[Watch]]');
  assert.equal(renameInText('nothing here', 'Old', 'New'), 'nothing here');
});

test('rename inside titles', () => {
  assert.equal(renameInTitle('Article: [[Writing]] tips', 'Writing', 'Creative Writing'), 'Article: [[Creative Writing]] tips');
  assert.equal(renameInTitle('Writing alone', 'Writing', 'X'), 'Writing alone');
});

test('mentions: whole words, any case, only in plain text', () => {
  const text = 'Mindfulness is mindful. MINDFULNESS! [[Mindfulness]] #Mindfulness `mindfulness` *mindfulness* unmindfulness';
  const found = findMentions(text, 'Mindfulness').map((m) => text.slice(m.start, m.end));
  assert.deepEqual(found, ['Mindfulness', 'MINDFULNESS', 'mindfulness']);
  assert.deepEqual(findMentions('Straße und strasse', 'Straße').length, 1);
  assert.deepEqual(findMentions('a (x+y) b', '(x+y)').length, 1);
});

test('link a mention with the exact title', () => {
  const text = 'What mindfulness does';
  const [mention] = findMentions(text, 'Mindfulness');
  assert.equal(linkMention(text, mention, 'Mindfulness'), 'What [[Mindfulness]] does');
});
