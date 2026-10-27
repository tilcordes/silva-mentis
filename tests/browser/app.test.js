// UI tests in headless Firefox against the test version (no login, sample notes). They check
// the core features end to end: typing and linking, references, the sidebar,
// rename and merge, unlinked references, search, daily notes, drag and drop.
// Skipped when Firefox is not installed.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../support/server.js';
import { Firefox, KEYS, findFirefox } from '../support/firefox.js';

const skip = findFirefox() ? false : 'Firefox is not installed';
let server;
let browser;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  if (skip) return;
  server = await startServer({ mode: 'test' });
  browser = await Firefox.launch({ width: 1280, height: 900 });
});

after(async () => {
  await browser?.close();
  await server?.stop();
});

/** Fresh sample notes and a freshly loaded app on the daily notes. */
beforeEach(async () => {
  if (skip) return;
  await fetch(`${server.url}/api.php?route=test-reset`, { method: 'POST', headers: { 'X-Silva-Mentis': '1' } });
  await reload('#/daily');
  await browser.waitFor(() => document.querySelector('.day .content'), { message: 'daily notes' });
  await browser.eval(() => document.querySelector('.editor') && document.activeElement.blur());
  await wait(100);
});

let loads = 0;

/** A real page load (a changed query string), not just a hash change. */
async function reload(hash) {
  loads += 1;
  await browser.goto(`${server.url}/?load=${loads}${hash}`);
}

/** Waits until every change reached the server. */
async function saved() {
  await browser.waitFor(() => document.querySelector('.status')?.textContent === 'Saved', { message: 'saved' });
  await wait(700); // a debounced save may still be scheduled
  await browser.waitFor(() => document.querySelector('.status')?.textContent === 'Saved', { message: 'saved' });
}

/** Opens a page through All pages, like a person would. */
async function openPage(title) {
  await browser.eval(() => { location.hash = '#/pages'; });
  await browser.waitFor(() => document.querySelector('td.title a'), { message: 'all pages' });
  await browser.eval(() => {
    const daily = document.querySelector('.list-tools .switch-input');
    if (!daily.checked) daily.click();
  });
  await browser.eval((t) => [...document.querySelectorAll('td.title a')].find((a) => a.textContent === t).click(), title);
  await browser.waitFor((t) => document.querySelector('.main .page-title')?.textContent === t, { message: `page ${title}` }, title);
}

/** Clicks a bullet's text and puts the caret at its end. */
async function editAtEnd(selector) {
  await browser.click(selector);
  await browser.waitFor(() => document.activeElement?.classList.contains('editor'), { message: 'editor' });
  await browser.type(KEYS.end, { modifiers: [KEYS.control] });
}

const TODAY_LAST = '.day:first-child > .blocks > li:last-child > .row .content';

const texts = (selector) => browser.eval((s) => [...document.querySelectorAll(s)].map((e) => e.textContent), selector);

test('typing creates bullets and links that survive a reload', { skip }, async () => {
  await editAtEnd(TODAY_LAST);
  await browser.type(KEYS.enter);
  await browser.type('Met [[Ada Lovel');
  await browser.waitFor(() => document.querySelector('.suggestions:not([hidden]) .suggestion.create'), { message: 'create suggestion' });
  await browser.type(`ace${KEYS.right}${KEYS.right} at the #libr`);
  await browser.type(KEYS.enter); // picks the first suggestion, not "Create page libr"
  await browser.type(KEYS.escape);
  await saved();
  await reload('#/daily');
  await browser.waitFor(() => document.querySelector('.day .content'), { message: 'reload' });
  const blocks = await texts('.day:first-child > .blocks > li > .row .content');
  assert.match(blocks.at(-1), /^Met \[\[Ada Lovelace\]\] at the #libr/);
  const link = await browser.eval(() => document.querySelector('a[data-page-title="Ada Lovelace"]')?.textContent);
  assert.equal(link, '[[Ada Lovelace]]');
});

test('Enter, Tab, Shift+Tab, Backspace and task cycling', { skip }, async () => {
  await editAtEnd(TODAY_LAST);
  await browser.type(`${KEYS.enter}first${KEYS.enter}second${KEYS.tab}`);
  let shape = await browser.eval(() => {
    const item = [...document.querySelectorAll('.day:first-child li.block')].find((li) => li.querySelector(':scope > .row')?.textContent.includes('first'));
    return item?.querySelector(':scope > .blocks > li > .row')?.textContent;
  });
  assert.equal(shape, 'second', 'second is a child of first');
  await browser.type(KEYS.enter, { modifiers: [KEYS.control] });
  assert.equal(await browser.eval(() => document.activeElement.value), '[ ] second');
  await browser.type(KEYS.enter, { modifiers: [KEYS.control] });
  assert.equal(await browser.eval(() => document.activeElement.value), '[x] second');
  await browser.type(KEYS.tab, { modifiers: [KEYS.shift] });
  await browser.type(KEYS.home);
  await browser.type(KEYS.backspace);
  assert.equal(await browser.eval(() => document.activeElement.value), 'first[x] second');
  await browser.type(KEYS.escape);
  shape = await browser.eval(() => document.querySelector('.row.selected')?.textContent);
  assert.equal(shape, 'first[x] second', 'Esc selects the block');
});

test('Shift+click opens a page in the sidebar, where it can be edited', { skip }, async () => {
  await browser.click('.day a[data-page-title="Waking Up"]', { shift: true });
  await browser.waitFor(() => document.querySelector('.side-item h4')?.textContent === 'Waking Up', { message: 'sidebar card' });
  assert.equal(await browser.eval(() => document.querySelector('.shell').classList.contains('with-side')), true);
  await editAtEnd('.side-item .page > .blocks > li:last-child > .blocks > li:last-child > .row .content');
  await browser.type(' (edited in the sidebar)');
  await browser.type(KEYS.escape);
  await saved();
  await openPage('Waking Up');
  const notes = await texts('.main .page > .blocks > li:last-child > .blocks > li > .row .content');
  assert.match(notes.at(-1), /\(edited in the sidebar\)$/);
});

test('linked references and the filter on the Mindfulness page', { skip }, async () => {
  await reload('#/pages');
  await browser.waitFor(() => document.querySelector('td.title a'), { message: 'all pages' });
  await browser.eval(() => [...document.querySelectorAll('td.title a')].find((a) => a.textContent === 'Mindfulness').click());
  await browser.waitFor(() => document.querySelector('.refs.linked .count')?.textContent === '4', { message: '4 linked references' });
  await browser.click('.refs.linked .icon-btn');
  await browser.eval(() => [...document.querySelectorAll('.filter-pop .chip')].find((chip) => chip.firstChild.textContent === 'Books').click());
  await browser.waitFor(() => document.querySelector('.refs.linked .count')?.textContent === '4 of 4', { message: 'Books filter' });
  await browser.eval(() => [...document.querySelectorAll('.filter-pop .chip')].find((chip) => chip.firstChild.textContent === 'Zen')
    .dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })));
  await browser.waitFor(() => document.querySelector('.refs.linked .count')?.textContent === '3 of 4', { message: 'exclude Zen' });
  const groups = await texts('.refs.linked .ref-group h5');
  assert.ok(!groups.includes('Zen Mind, Beginner\'s Mind'));
});

test('unlinked references: Link turns a mention into a reference', { skip }, async () => {
  await openPage('Mindfulness');
  await browser.waitFor(() => document.querySelector('.refs.unlinked .refs-toggle'), { message: 'unlinked header' });
  await browser.click('.refs.unlinked .refs-toggle');
  await browser.waitFor(() => document.querySelector('.link-btn'), { message: 'Link button' });
  await browser.click('.link-btn');
  await browser.waitFor(() => document.querySelector('.refs.linked .count')?.textContent === '5', { message: '5 linked references' });
  assert.equal(await browser.eval(() => document.querySelector('.refs.unlinked .count').textContent), '3');
  await saved();
});

test('renaming a page rewrites every reference', { skip }, async () => {
  await openPage('Waking Up');
  await browser.click('.main .page-title');
  await browser.type('a', { modifiers: [KEYS.control] });
  await browser.type(`Waking Up (Harris)${KEYS.enter}`);
  await browser.waitFor(() => document.querySelector('.main .page-title')?.textContent === 'Waking Up (Harris)', { message: 'renamed' });
  await saved();
  await reload('#/daily');
  await browser.waitFor(() => document.querySelector('.day .content'), { message: 'daily' });
  const links = await texts('.day:first-child a[data-page-title^="Waking Up"]');
  assert.deepEqual(links, ['[[Waking Up (Harris)]]']);
});

test('renaming onto an existing title merges the pages', { skip }, async () => {
  await openPage('Short-term Goals');
  await browser.click('.main .page-title');
  await browser.type('a', { modifiers: [KEYS.control] });
  await browser.type(`Long-term Goals${KEYS.enter}`);
  await browser.waitFor(() => document.querySelector('dialog[open]'), { message: 'merge dialog' });
  assert.match(await browser.eval(() => document.querySelector('dialog[open] h2').textContent), /already exists/);
  await browser.click('dialog[open] button[value="ok"]');
  await browser.waitFor(() => document.querySelector('.main .page-title')?.textContent === 'Long-term Goals', { message: 'merged page' });
  const blocks = await texts('.main .page > .blocks > li > .row .content');
  assert.equal(blocks.length, 4);
  const shortcuts = await texts('.shortcuts a');
  assert.equal(shortcuts.filter((title) => title === 'Long-term Goals').length, 1);
  assert.ok(!shortcuts.includes('Short-term Goals'));
});

test('daily notes: tasks filed under today resurface as linked references', { skip }, async () => {
  const refs = await texts('.day:first-child .refs.linked .ref-group h5');
  assert.ok(refs.some((title) => title.startsWith('Weekly Plan')));
  const blocks = await texts('.day:first-child .refs.linked .content');
  assert.ok(blocks.some((text) => text.includes('Call the [[Dentist]]')));
  const days = await texts('.day > .page-head .page-title');
  assert.ok(days.length >= 3, 'earlier days follow');
});

test('Ctrl+K searches titles and creates pages', { skip }, async () => {
  await browser.type('k', { modifiers: [KEYS.control] });
  await browser.waitFor(() => document.querySelector('.palette[open]'), { message: 'palette' });
  await browser.type('mindful');
  await browser.waitFor(() => document.querySelector('.palette .suggestion.sel .label')?.textContent === 'Mindfulness', { message: 'result' });
  await browser.type(KEYS.enter);
  await browser.waitFor(() => document.querySelector('.main .page-title')?.textContent === 'Mindfulness', { message: 'opened' });
  await browser.type('k', { modifiers: [KEYS.control] });
  await browser.type(`Brand New Page${KEYS.down}`);
  await browser.waitFor(() => document.querySelector('.palette .suggestion.create.sel'), { message: 'create entry' });
  await browser.type(KEYS.enter);
  await browser.waitFor(() => document.querySelector('.main .page-title')?.textContent === 'Brand New Page', { message: 'new page' });
});

test('drag a bullet into another block', { skip }, async () => {
  await openPage('Projects');
  const before = await texts('.main .page > .blocks > li > .row .content');
  assert.equal(before.length, 3);
  await browser.drag('.main .page > .blocks > li:nth-child(3) > .row .bullet', '.main .page > .blocks > li:nth-child(1) > .row .content', { dx: 120, dyRatio: 0.8 });
  await browser.waitFor(() => document.querySelectorAll('.main .page > .blocks > li').length === 2, { message: 'moved' });
  const child = await browser.eval(() => document.querySelector('.main .page > .blocks > li:nth-child(1) > .blocks > li > .row .content')?.textContent);
  assert.match(child, /Studio North/);
});
