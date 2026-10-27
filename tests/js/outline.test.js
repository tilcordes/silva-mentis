import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ancestorsOf, blocksToPlainText, cloneBlocks, findBlock, indent, insertBlocks, mergeIntoPrevious,
  mergeNextInto, moveBlocks, moveDown, moveUp, outdent, removeBlocks, splitBlock, visibleBlocks,
} from '../../public/js/core/outline.js';
import { blocks, shape } from './helpers.js';

const idOf = (list, text) => visibleBlocks(list).find((b) => b.text === text)?.id
  ?? (() => { let id; const walk = (l) => l.forEach((b) => { if (b.text === text) id = b.id; walk(b.children); }); walk(list); return id; })();

test('indent and outdent', () => {
  const list = blocks(['A', 'B', 'C']);
  assert.equal(indent(list, idOf(list, 'A')), false);
  assert.equal(indent(list, idOf(list, 'B')), true);
  assert.deepEqual(shape(list), ['A', ['B'], 'C']);
  indent(list, idOf(list, 'C'));
  assert.deepEqual(shape(list), ['A', ['B', 'C']]);
  indent(list, idOf(list, 'C'));
  assert.deepEqual(shape(list), ['A', ['B', ['C']]]);
  assert.equal(outdent(list, idOf(list, 'B')), true);
  assert.deepEqual(shape(list), ['A', 'B', ['C']]);
  assert.equal(outdent(list, idOf(list, 'A')), false);
});

test('indent opens a collapsed new parent', () => {
  const list = blocks(['A', ['A1'], 'B']);
  list[0].collapsed = true;
  indent(list, idOf(list, 'B'));
  assert.equal(list[0].collapsed, undefined);
  assert.deepEqual(shape(list), ['A', ['A1', 'B']]);
});

test('outdent keeps later siblings with the old parent', () => {
  const list = blocks(['P', ['X', 'Y']]);
  outdent(list, idOf(list, 'X'));
  assert.deepEqual(shape(list), ['P', ['Y'], 'X']);
});

test('move up and down travel across parents', () => {
  const list = blocks(['Day 1', ['task'], 'Day 2', ['other']]);
  moveDown(list, idOf(list, 'task'));
  assert.deepEqual(shape(list), ['Day 1', 'Day 2', ['task', 'other']]);
  moveUp(list, idOf(list, 'task'));
  assert.deepEqual(shape(list), ['Day 1', ['task'], 'Day 2', ['other']]);
  moveUp(list, idOf(list, 'task'));
  assert.deepEqual(shape(list), ['task', 'Day 1', 'Day 2', ['other']]);
  assert.equal(moveUp(list, idOf(list, 'task')), false);
  moveDown(list, idOf(list, 'other'));
  assert.deepEqual(shape(list), ['task', 'Day 1', 'Day 2', 'other']);
  assert.equal(moveDown(list, idOf(list, 'other')), false);
});

test('split at the caret, at the start and with open children', () => {
  const list = blocks(['Hello world']);
  const result = splitBlock(list, list[0].id, 5);
  assert.deepEqual(shape(list), ['Hello', ' world']);
  assert.equal(result.focusId, list[1].id);

  const atStart = blocks(['Text']);
  const keep = atStart[0].id;
  const r2 = splitBlock(atStart, keep, 0);
  assert.deepEqual(shape(atStart), ['', 'Text']);
  assert.equal(r2.focusId, keep);

  const parent = blocks(['Parent', ['child']]);
  splitBlock(parent, parent[0].id, 6);
  assert.deepEqual(shape(parent), ['Parent', ['', 'child']]);

  const collapsed = blocks(['Parent', ['child']]);
  collapsed[0].collapsed = true;
  splitBlock(collapsed, collapsed[0].id, 6);
  assert.deepEqual(shape(collapsed), ['Parent', ['child'], '']);
});

test('backspace merges into the previous visible block, children follow', () => {
  const list = blocks(['A', ['A1'], 'B', ['B1']]);
  const result = mergeIntoPrevious(list, idOf(list, 'B'));
  assert.deepEqual(shape(list), ['A', ['A1B'], 'B1']);
  assert.deepEqual(result, { focusId: idOf(list, 'A1B'), caret: 2 });
  assert.equal(mergeIntoPrevious(list, idOf(list, 'A')), null);
});

test('backspace in an empty block removes it', () => {
  const list = blocks(['A', '']);
  mergeIntoPrevious(list, list[1].id);
  assert.deepEqual(shape(list), ['A']);
});

test('delete pulls the next block in', () => {
  const list = blocks(['A', 'B', ['B1']]);
  const result = mergeNextInto(list, idOf(list, 'A'));
  assert.deepEqual(shape(list), ['AB', 'B1']);
  assert.equal(result.caret, 1);
  assert.equal(mergeNextInto(list, idOf(list, 'B1')), null);
});

test('visible blocks skip collapsed children; ancestors', () => {
  const list = blocks(['A', ['A1', ['A1a']], 'B']);
  assert.deepEqual(visibleBlocks(list).map((b) => b.text), ['A', 'A1', 'A1a', 'B']);
  findBlock(list, idOf(list, 'A1')).block.collapsed = true;
  assert.deepEqual(visibleBlocks(list).map((b) => b.text), ['A', 'A1', 'B']);
  assert.deepEqual(ancestorsOf(list, idOf(list, 'A1a')).map((b) => b.text), ['A', 'A1']);
});

test('move blocks for drag and drop, never into themselves', () => {
  const list = blocks(['A', ['A1'], 'B', 'C']);
  assert.equal(moveBlocks(list, [idOf(list, 'A')], idOf(list, 'A1'), 'inside'), false);
  moveBlocks(list, [idOf(list, 'C')], idOf(list, 'A'), 'inside');
  assert.deepEqual(shape(list), ['A', ['A1', 'C'], 'B']);
  moveBlocks(list, [idOf(list, 'A')], idOf(list, 'B'), 'after');
  assert.deepEqual(shape(list), ['B', 'A', ['A1', 'C']]);
  moveBlocks(list, [idOf(list, 'A1'), idOf(list, 'C')], idOf(list, 'B'), 'before');
  assert.deepEqual(shape(list), ['A1', 'C', 'B', 'A']);
});

test('remove a selection that contains a parent and its child', () => {
  const list = blocks(['A', ['A1'], 'B']);
  const removed = removeBlocks(list, [idOf(list, 'A'), idOf(list, 'A1')]);
  assert.deepEqual(removed.map((b) => b.text), ['A']);
  assert.deepEqual(shape(list), ['B']);
});

test('insert blocks, clone with new ids, markdown text', () => {
  const list = blocks(['A']);
  const copies = cloneBlocks(blocks(['X', ['Y']]));
  insertBlocks(list, list[0].id, 'first', copies);
  assert.deepEqual(shape(list), ['A', ['X', ['Y']]]);
  assert.notEqual(copies[0].id, undefined);
  list[0].children[0].text = 'line 1\nline 2';
  assert.equal(blocksToPlainText(list), '- A\n  - line 1\n    line 2\n    - Y');
});
