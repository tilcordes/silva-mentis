import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, SETTINGS_ID } from '../../public/js/data/store.js';
import { PlainCipher } from '../../public/js/crypto/ciphers.js';
import { findBlock, splitBlock } from '../../public/js/core/outline.js';
import { FakeServer, ManualTimers } from './fake-api.js';
import { blocks, shape } from './helpers.js';

function device(server, clock = { now: 1_760_000_000_000 }) {
  const timers = new ManualTimers();
  const store = new Store({ api: server.client(), cipher: new PlainCipher(), now: () => clock.now, timers });
  return { store, timers, clock };
}

async function freshStore() {
  const server = new FakeServer();
  const { store, timers, clock } = device(server);
  await store.loadAll();
  return { server, store, timers, clock };
}

test('first load creates settings and the Templates page on the server', async () => {
  const { server, store } = await freshStore();
  assert.ok(server.documents.has(SETTINGS_ID));
  assert.equal(server.documents.size, 2);
  assert.ok(store.index.pageByTitle('Templates'));
  const again = device(server).store;
  await again.loadAll();
  assert.equal(server.documents.size, 2, 'no second Templates page');
  assert.equal(again.index.pageByTitle('Templates').blocks.length, 4);
});

test('empty pages stay local until they get content', async () => {
  const { server, store } = await freshStore();
  const page = store.createPage('Waking Up');
  await store.flush();
  assert.equal(server.documents.has(page.id), false);
  store.updatePage(page.id, (list) => { list[0].text = 'by [[Sam Harris]]'; });
  await store.flush();
  assert.equal(server.documents.get(page.id).version, 1);
  assert.equal(store.state, 'saved');
});

test('typing into a virtual page creates it under its virtual id', async () => {
  const { server, store } = await freshStore();
  const daily = store.createPage('October 20th, 2026', blocks(['see [[Mara Lindqvist]]']));
  const maraId = store.idForTitle('Mara Lindqvist');
  assert.equal(store.getPage(maraId), undefined);
  store.updatePage(maraId, (list) => list.push({ id: 'b1', text: 'Designer', children: [] }));
  await store.flush();
  assert.equal(store.getPage(maraId).title, 'Mara Lindqvist');
  assert.ok(server.documents.has(maraId));
  assert.ok(server.documents.has(daily.id));
});

test('saves are debounced and batched', async () => {
  const { server, store, timers } = await freshStore();
  const page = store.createPage('A', blocks(['x']));
  assert.deepEqual(timers.delays(), [600]);
  store.updatePage(page.id, (list) => { list[0].text = 'xy'; }, { history: 'typing' });
  assert.equal(timers.delays().length, 1, 'one pending save');
  await timers.runAll();
  await store.saving;
  assert.equal(server.documents.get(page.id).version, 1);
});

test('conflict: server wins in place, local copy becomes a conflict page', async () => {
  const server = new FakeServer();
  const a = device(server);
  await a.store.loadAll();
  const page = a.store.createPage('Plan', blocks(['shared']));
  await a.store.flush();

  const b = device(server);
  await b.store.loadAll();
  b.store.updatePage(page.id, (list) => { list[0].text = 'from B'; });
  await b.store.flush();

  const notices = [];
  a.store.addEventListener('notice', (event) => notices.push(event.detail.message));
  a.store.updatePage(page.id, (list) => { list[0].text = 'from A'; });
  await a.store.flush();

  assert.equal(a.store.getPage(page.id).blocks[0].text, 'from B');
  const copy = [...a.store.index.pages.values()].find((p) => p.title.startsWith('Plan (conflict copy '));
  assert.ok(copy, 'conflict copy exists');
  assert.equal(copy.blocks[0].text, 'from A');
  assert.ok(server.documents.has(copy.id));
  assert.equal(a.store.state, 'conflict');
  assert.match(notices[0], /changed on another device/);
});

test('delta sync brings other devices up to date, deletions included', async () => {
  const server = new FakeServer();
  const a = device(server);
  await a.store.loadAll();
  const b = device(server);
  await b.store.loadAll();
  const page = a.store.createPage('Shared', blocks(['one']));
  await a.store.flush();
  assert.deepEqual(await b.store.sync(), [page.id]);
  assert.equal(b.store.getPage(page.id).blocks[0].text, 'one');
  assert.deepEqual(await b.store.sync(), [], 'nothing new');
  assert.deepEqual(await a.store.sync(), [], 'own writes are not re-applied');

  a.store.deletePage(page.id);
  await a.store.flush();
  assert.equal(server.documents.get(page.id).deleted, true);
  await b.store.sync();
  assert.equal(b.store.getPage(page.id), undefined);
});

test('sync never overwrites unsaved local edits', async () => {
  const server = new FakeServer();
  const a = device(server);
  await a.store.loadAll();
  const page = a.store.createPage('Doc', blocks(['v1']));
  await a.store.flush();
  const b = device(server);
  await b.store.loadAll();
  b.store.updatePage(page.id, (list) => { list[0].text = 'B'; });
  await b.store.flush();
  a.store.updatePage(page.id, (list) => { list[0].text = 'A unsaved'; });
  await a.store.sync();
  assert.equal(a.store.getPage(page.id).blocks[0].text, 'A unsaved');
});

test('offline: changes wait and are retried with growing delays', async () => {
  const { server, store, timers } = await freshStore();
  server.offline = true;
  const page = store.createPage('Offline', blocks(['text']));
  await store.flush();
  assert.equal(store.state, 'offline');
  assert.equal(store.pendingCount, 1);
  assert.deepEqual(timers.delays(), [5000]);
  await timers.runAll();
  await store.saving;
  assert.deepEqual(timers.delays(), [15000]);
  server.offline = false;
  await timers.runAll();
  await store.saving;
  assert.equal(store.state, 'saved');
  assert.ok(server.documents.has(page.id));
});

test('rename rewrites references and cascades into titles', async () => {
  const { store } = await freshStore();
  const writing = store.createPage('Writing', blocks(['a tool']));
  const article = store.createPage('Article: [[Writing]] tips', blocks(['about #Writing']));
  const daily = store.createPage('October 20th, 2026', blocks(['read [[Article: [[Writing]] tips]]', 'Tool:: [[Writing]] #Writing']));
  store.renamePage(writing.id, 'Creative Writing');
  assert.equal(store.getPage(writing.id).title, 'Creative Writing');
  assert.equal(store.getPage(article.id).title, 'Article: [[Creative Writing]] tips');
  assert.equal(store.getPage(article.id).blocks[0].text, 'about #[[Creative Writing]]');
  assert.deepEqual(shape(store.getPage(daily.id).blocks), ['read [[Article: [[Creative Writing]] tips]]', 'Tool:: [[Creative Writing]] #[[Creative Writing]]']);
  assert.equal(store.index.referenceCount('Creative Writing'), 4, 'title, article block, both daily blocks');
  assert.equal(store.index.referenceCount('Article: [[Creative Writing]] tips'), 1);
  assert.equal(store.index.allTitles().includes('Writing'), false);
});

test('renaming "apple watch" to "Apple Watch" merges the pages', async () => {
  const { store } = await freshStore();
  const upper = store.createPage('Apple Watch', blocks(['bought in 2019']));
  const lower = store.createPage('apple watch', blocks(['battery is weak']));
  const other = store.createPage('Gadgets', blocks(['[[apple watch]] and #[[Apple Watch]]']));
  store.toggleShortcut(lower.id);
  assert.equal(store.renameTarget(lower.id, 'Apple Watch').id, upper.id);
  assert.throws(() => store.renamePage(lower.id, 'Apple Watch'), /already exists/);
  store.mergePage(lower.id, upper.id);
  assert.deepEqual(shape(store.getPage(upper.id).blocks), ['bought in 2019', 'battery is weak']);
  assert.equal(store.getPage(lower.id), undefined);
  assert.equal(store.getPage(other.id).blocks[0].text, '[[Apple Watch]] and #[[Apple Watch]]');
  assert.deepEqual(store.settings.shortcuts, [upper.id]);
  assert.equal(store.index.referenceCount('Apple Watch'), 1);
});

test('undo and redo restore blocks and caret, typing bursts are one step', async () => {
  const { store, clock } = await freshStore();
  const page = store.createPage('U', blocks(['hello']));
  const id = page.blocks[0].id;
  store.updatePage(page.id, (list) => { list[0].text = 'hello w'; }, { history: 'typing', focus: { blockId: id, caret: 5 } });
  clock.now += 200;
  store.updatePage(page.id, (list) => { list[0].text = 'hello world'; }, { history: 'typing', focus: { blockId: id, caret: 7 } });
  clock.now += 2000;
  store.updatePage(page.id, (list) => splitBlock(list, id, 5), { focus: { blockId: id, caret: 11 } });
  assert.deepEqual(shape(store.getPage(page.id).blocks), ['hello', ' world']);

  assert.deepEqual(store.undo(page.id), { blockId: id, caret: 11 });
  assert.deepEqual(shape(store.getPage(page.id).blocks), ['hello world']);
  assert.deepEqual(store.undo(page.id), { blockId: id, caret: 5 });
  assert.deepEqual(shape(store.getPage(page.id).blocks), ['hello']);
  assert.equal(store.undo(page.id), false);
  store.undo(page.id, 'redo');
  assert.deepEqual(shape(store.getPage(page.id).blocks), ['hello world']);
  assert.ok(findBlock(store.getPage(page.id).blocks, id));
});

test('deleting a referenced page leaves a virtual page behind', async () => {
  const { server, store } = await freshStore();
  const target = store.createPage('Target', blocks(['content']));
  store.createPage('Source', blocks(['[[Target]]']));
  await store.flush();
  store.deletePage(target.id);
  await store.flush();
  assert.equal(server.documents.get(target.id).deleted, true);
  const row = store.index.listPages().find((r) => r.title === 'Target');
  assert.equal(row.virtual, true);
  assert.equal(row.references, 1);
});

test('settings are a document too', async () => {
  const server = new FakeServer();
  const a = device(server);
  await a.store.loadAll();
  a.store.updateSettings({ theme: 'dark', noteFont: 'sans' });
  await a.store.flush();
  const b = device(server);
  await b.store.loadAll();
  assert.equal(b.store.settings.theme, 'dark');
  assert.equal(b.store.settings.noteFont, 'sans');
});

test('seed pages are created only on a brand-new installation', async () => {
  const server = new FakeServer();
  const seed = () => [{ title: 'Welcome', blocks: blocks(['hi']) }];
  const a = device(server);
  await a.store.loadAll({ seed });
  assert.ok(a.store.index.pageByTitle('Welcome'));
  const b = device(server);
  let called = false;
  await b.store.loadAll({ seed: () => { called = true; return []; } });
  assert.equal(called, false);
});
