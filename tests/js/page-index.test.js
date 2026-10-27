import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_SOURCE } from '../../public/js/core/page-index.js';
import { findMentions, linkMention } from '../../public/js/core/references.js';
import { findBlock } from '../../public/js/core/outline.js';
import { indexOf, page } from './helpers.js';

test('pages exist virtually as soon as something links to them', () => {
  const index = indexOf(page('Waking Up', ['Tags:: #Books #Mindfulness', 'by [[Sam Harris]]']));
  const rows = index.listPages().sort((a, b) => a.title.localeCompare(b.title));
  assert.deepEqual(rows.map((r) => [r.title, r.virtual, r.references]), [
    ['Books', true, 1], ['Mindfulness', true, 1], ['Sam Harris', true, 1], ['Tags', true, 1], ['Waking Up', false, 0],
  ]);
  const id = index.idForTitle('Books');
  assert.equal(index.idForTitle('Books'), id, 'virtual ids are stable');
  assert.equal(index.titleForId(id), 'Books');
});

test('daily pages have predictable ids on every device', () => {
  const index = indexOf(page('A', ['[[October 20th, 2026]]']));
  assert.equal(index.idForTitle('October 20th, 2026'), 'd2026-10-20');
  assert.match(index.idForTitle('Not a day'), /^p[a-z0-9]{15}$/);
});

test('a virtual page keeps its id when it gets a document', () => {
  const index = indexOf(page('A', ['[[B]]']));
  const id = index.idForTitle('B');
  index.setPage({ ...page('B', ['hello']), id });
  assert.equal(index.idForTitle('B'), id);
  assert.equal(index.listPages().find((r) => r.title === 'B').virtual, false);
});

test('one linked reference per referencing block; own page excluded', () => {
  const index = indexOf(
    page('Mindfulness', ['self link [[Mindfulness]]']),
    page('Note', ['[[Mindfulness]] and #Mindfulness twice', 'again [[Mindfulness]]']),
    page('Article: [[Mindfulness]] at work'),
  );
  assert.equal(index.referenceCount('Mindfulness'), 3);
  const viaTitle = index.linkedReferences('Mindfulness').filter((r) => r.blockId === TITLE_SOURCE);
  assert.equal(viaTitle.length, 1);
});

test('Mindfulness goes from 11 to 14 after three Link clicks on one page', () => {
  const pages = [page('Mindfulness', ['Practice notes live on [[Meditation]].'])];
  for (let i = 0; i < 11; i += 1) pages.push(page(`Book ${i}`, [`Tags:: #Books #Mindfulness`]));
  const scholars = page('Buddhism Scholars', [
    'Mindfulness as taught by monks',
    'Western mindfulness is shallow',
    'Is MINDFULNESS a skill?',
  ]);
  pages.push(scholars);
  const index = indexOf(...pages);
  assert.equal(index.referenceCount('Mindfulness'), 11);
  const unlinked = index.unlinkedReferences('Mindfulness');
  assert.equal(unlinked.length, 3);

  for (const item of unlinked) {
    const { block } = findBlock(scholars.blocks, item.blockId);
    block.text = linkMention(block.text, item.mentions[0], 'Mindfulness');
  }
  index.setPage(scholars);
  assert.equal(index.referenceCount('Mindfulness'), 14);
  assert.equal(index.unlinkedReferences('Mindfulness').length, 0);
  assert.equal(scholars.blocks[1].text, 'Western [[Mindfulness]] is shallow');
});

test('filter Mindfulness references to those that also reference Books', () => {
  const index = indexOf(
    page('Waking Up', ['Metadata::', ['Tags:: #Books #Mindfulness #Meditation']], { updated: 5 }),
    page('The Shallows', ['Metadata::', ['Tags:: #Books #Attention #Mindfulness'], 'Notes', ['A chapter on focus']], { updated: 4 }),
    page('October 20th, 2026', ['Ran without [[Mindfulness]]', '[[Happiness]]', ['felt [[Mindfulness]]']]),
    page('Zen Mind', ['[[Mindfulness]] #Zen'], { updated: 3 }),
  );
  const all = index.linkedReferences('Mindfulness');
  assert.equal(all.length, 5);

  const books = index.filterReferences(all, { include: new Set(['Books']), exclude: new Set() }, 'Mindfulness');
  assert.deepEqual(books.map((r) => index.getPage(r.pageId).title).sort(), ['The Shallows', 'Waking Up']);

  const chips = index.filterChips(all, 'Mindfulness');
  assert.deepEqual(chips.slice(0, 2), [{ title: 'Books', count: 2 }, { title: 'Metadata', count: 2 }]);
  assert.ok(!chips.some((chip) => chip.title === 'Mindfulness'));
  assert.ok(chips.some((chip) => chip.title === 'Happiness' && chip.count === 1), 'ancestor references count');

  const withoutDaily = index.filterReferences(all, { include: new Set(), exclude: new Set(['October 20th, 2026']) }, 'Mindfulness');
  assert.equal(withoutDaily.length, 3, 'the source page itself is part of the context');
  const both = index.filterReferences(all, { include: new Set(['Books', 'Attention']), exclude: new Set() }, 'Mindfulness');
  assert.equal(both.length, 1);
});

test('page metadata counts for every reference from that page', () => {
  const index = indexOf(
    page('Waking Up', ['Metadata::', ['Type:: #Books', 'Tags:: #Mindfulness'], 'Notes', ['on [[Mindfulness]]', 'Ignore:: not metadata #Hidden']]),
    page('Blog', ['[[Mindfulness]] post']),
  );
  const all = index.linkedReferences('Mindfulness');
  const books = index.filterReferences(all, { include: new Set(['Books']), exclude: new Set() }, 'Mindfulness');
  assert.equal(books.length, 2, 'both references from the book page');
  assert.ok(!index.filterChips(all, 'Mindfulness').some((chip) => chip.title === 'Hidden'), 'attributes inside notes are not metadata');
});

test('reference groups: daily pages by date, others by last edit, blocks in outline order', () => {
  const index = indexOf(
    page('Old page', ['[[T]]'], { updated: Date.UTC(2020, 0, 1) }),
    page('October 18th, 2026', ['[[T]] one']),
    page('October 20th, 2026', ['b [[T]]', 'a [[T]]']),
    page('Fresh page', ['[[T]]'], { updated: new Date(2026, 9, 19, 12).getTime() }),
  );
  const groups = index.groupReferences('T');
  assert.deepEqual(groups.map((g) => g.title), ['October 20th, 2026', 'Fresh page', 'October 18th, 2026', 'Old page']);
  const day = index.getPage(groups[0].pageId);
  assert.deepEqual(groups[0].blockIds, [day.blocks[0].id, day.blocks[1].id]);
});

test('removing and re-titling pages updates the index', () => {
  const a = page('A', ['[[B]]']);
  const index = indexOf(a, page('B'));
  index.removePage(a.id);
  assert.equal(index.referenceCount('B'), 0);
  assert.equal(index.allTitles().includes('A'), false);
  const b = index.pageByTitle('B');
  index.setPage({ ...b, title: 'C' });
  assert.equal(index.pageByTitle('B'), undefined);
  assert.equal(index.pageByTitle('C').id, b.id);
});

test('unlinked references ignore links, code and the page itself', () => {
  const index = indexOf(
    page('Writing', ['writing is mine']),
    page('X', ['[[Writing]] and writing', '`writing` code', 'writings', 'I like writing']),
  );
  const found = index.unlinkedReferences('Writing');
  assert.equal(found.length, 1);
  const x = index.pageByTitle('X');
  assert.equal(found[0].blockId, x.blocks[3].id);
  assert.deepEqual(findMentions(x.blocks[3].text, 'Writing'), found[0].mentions);
});

test('the Templates page is not a reference source', () => {
  const index = indexOf(page('Templates', ['Book', ['Type:: #Books']]), page('Waking Up', ['Type:: #Books']));
  assert.equal(index.referenceCount('Books'), 1);
  assert.equal(index.graph().links.some((link) => link.source === index.idForTitle('Templates')), false);
});

test('graph: one node per title, one link per connected pair', () => {
  const index = indexOf(page('A', ['[[B]] [[B]] #C']), page('B', ['[[A]]']), page('Lonely'));
  const graph = index.graph();
  assert.deepEqual(graph.nodes.map((n) => n.title).sort(), ['A', 'B', 'C', 'Lonely']);
  assert.equal(graph.links.length, 2);
  assert.equal(graph.nodes.find((n) => n.title === 'A').degree, 2);
  assert.equal(graph.nodes.find((n) => n.title === 'C').virtual, true);
});
