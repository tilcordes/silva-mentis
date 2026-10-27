// Operations on an outline: a list of blocks, each with children. Every function works on the
// page's `blocks` array in place and identifies blocks by id, so the editor, drag and drop,
// paste and undo all share the same small set of moves.

import { newId } from './ids.js';

/**
 * @typedef {object} Block
 * @property {string} id
 * @property {string} text markdown, may contain newlines
 * @property {Block[]} children
 * @property {boolean} [collapsed] present (true) only when the children are hidden
 */

/**
 * @param {string} [text='']
 * @param {Block[]} [children=[]]
 * @returns {Block}
 */
export function createBlock(text = '', children = []) {
  return { id: newId('b'), text, children };
}

/**
 * Finds a block and where it sits.
 * @param {Block[]} blocks
 * @param {string} id
 * @returns {{block: Block, parent: Block|null, siblings: Block[], index: number}|null}
 */
export function findBlock(blocks, id, parent = null) {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.id === id) return { block, parent, siblings: blocks, index };
    const found = findBlock(block.children, id, block);
    if (found) return found;
  }
  return null;
}

/**
 * Calls `visit(block, ancestors)` for every block, parents before children.
 * Returning false from `visit` skips that block's children.
 * @param {Block[]} blocks
 * @param {(block: Block, ancestors: Block[]) => (boolean|void)} visit
 */
export function walkBlocks(blocks, visit, ancestors = []) {
  for (const block of blocks) {
    if (visit(block, ancestors) === false) continue;
    walkBlocks(block.children, visit, [...ancestors, block]);
  }
}

/**
 * The blocks a reader sees, top to bottom (children of collapsed blocks are hidden).
 * @param {Block[]} blocks
 * @returns {Block[]}
 */
export function visibleBlocks(blocks) {
  const result = [];
  walkBlocks(blocks, (block) => {
    result.push(block);
    return !block.collapsed;
  });
  return result;
}

/**
 * The chain of parents of a block, outermost first.
 * @param {Block[]} blocks
 * @param {string} id
 * @returns {Block[]}
 */
export function ancestorsOf(blocks, id) {
  let result = [];
  walkBlocks(blocks, (block, ancestors) => {
    if (block.id === id) result = ancestors;
  });
  return result;
}

/** Inserts `newBlock` right after the block `id` (same parent). */
export function insertAfter(blocks, id, newBlock) {
  const place = findBlock(blocks, id);
  if (!place) throw new Error(`Block ${id} not found`);
  place.siblings.splice(place.index + 1, 0, newBlock);
  return newBlock;
}

/** Inserts `newBlock` right before the block `id`. */
export function insertBefore(blocks, id, newBlock) {
  const place = findBlock(blocks, id);
  if (!place) throw new Error(`Block ${id} not found`);
  place.siblings.splice(place.index, 0, newBlock);
  return newBlock;
}

/** Makes `newBlock` the first child of block `id` and shows the children. */
export function insertFirstChild(blocks, id, newBlock) {
  const place = findBlock(blocks, id);
  if (!place) throw new Error(`Block ${id} not found`);
  place.block.children.unshift(newBlock);
  delete place.block.collapsed;
  return newBlock;
}

/**
 * Tab: the block becomes the last child of its previous sibling.
 * @returns {boolean} false if there is no previous sibling
 */
export function indent(blocks, id) {
  const place = findBlock(blocks, id);
  if (!place || place.index === 0) return false;
  const newParent = place.siblings[place.index - 1];
  place.siblings.splice(place.index, 1);
  newParent.children.push(place.block);
  delete newParent.collapsed;
  return true;
}

/**
 * Shift+Tab: the block moves out of its parent and follows it. Later siblings stay where they
 * are.
 * @returns {boolean} false at the top level
 */
export function outdent(blocks, id) {
  const place = findBlock(blocks, id);
  if (!place || !place.parent) return false;
  const parentPlace = findBlock(blocks, place.parent.id);
  place.siblings.splice(place.index, 1);
  parentPlace.siblings.splice(parentPlace.index + 1, 0, place.block);
  return true;
}

/**
 * Alt+Shift+↑: swap with the previous sibling. The first child moves into the end of its
 * parent's previous sibling, or before its parent, so a block can travel through the outline.
 * @returns {boolean}
 */
export function moveUp(blocks, id) {
  const place = findBlock(blocks, id);
  if (!place) return false;
  if (place.index > 0) {
    place.siblings.splice(place.index, 1);
    place.siblings.splice(place.index - 1, 0, place.block);
    return true;
  }
  if (!place.parent) return false;
  const parentPlace = findBlock(blocks, place.parent.id);
  place.siblings.splice(place.index, 1);
  if (parentPlace.index > 0) {
    const aunt = parentPlace.siblings[parentPlace.index - 1];
    aunt.children.push(place.block);
    delete aunt.collapsed;
  } else {
    parentPlace.siblings.splice(parentPlace.index, 0, place.block);
  }
  return true;
}

/**
 * Alt+Shift+↓: the mirror image of moveUp. The last child moves to the start of its parent's
 * next sibling's children, or after its parent.
 * @returns {boolean}
 */
export function moveDown(blocks, id) {
  const place = findBlock(blocks, id);
  if (!place) return false;
  if (place.index < place.siblings.length - 1) {
    place.siblings.splice(place.index, 1);
    place.siblings.splice(place.index + 1, 0, place.block);
    return true;
  }
  if (!place.parent) return false;
  const parentPlace = findBlock(blocks, place.parent.id);
  place.siblings.splice(place.index, 1);
  if (parentPlace.index < parentPlace.siblings.length - 1) {
    const aunt = parentPlace.siblings[parentPlace.index + 1];
    aunt.children.unshift(place.block);
    delete aunt.collapsed;
  } else {
    parentPlace.siblings.splice(parentPlace.index + 1, 0, place.block);
  }
  return true;
}

/**
 * Removes blocks (with their children). Selecting a block and its child removes the subtree once.
 * @param {Block[]} blocks
 * @param {string[]} ids
 * @returns {Block[]} the removed blocks in outline order
 */
export function removeBlocks(blocks, ids) {
  const wanted = new Set(ids);
  const removed = [];
  const prune = (list) => {
    for (let index = 0; index < list.length; index += 1) {
      if (wanted.has(list[index].id)) {
        removed.push(...list.splice(index, 1));
        index -= 1;
      } else {
        prune(list[index].children);
      }
    }
  };
  prune(blocks);
  return removed;
}

/**
 * Moves blocks before, after or into (as last child) a target block. Used by drag and drop and
 * by multi-block moves. Moving a block into its own subtree is refused.
 * @param {Block[]} blocks
 * @param {string[]} ids
 * @param {string} targetId
 * @param {'before'|'after'|'inside'} position
 * @returns {boolean}
 */
export function moveBlocks(blocks, ids, targetId, position) {
  if (ids.includes(targetId)) return false;
  for (const id of ids) {
    const place = findBlock(blocks, id);
    if (place && findBlock(place.block.children, targetId)) return false;
  }
  const moving = removeBlocks(blocks, ids);
  insertBlocks(blocks, targetId, position, moving);
  return moving.length > 0;
}

/**
 * Inserts existing block objects next to or inside a target.
 * @param {Block[]} blocks
 * @param {string|null} targetId null appends to the top level
 * @param {'before'|'after'|'inside'|'first'} position
 * @param {Block[]} newBlocks
 */
export function insertBlocks(blocks, targetId, position, newBlocks) {
  if (targetId === null) {
    blocks.push(...newBlocks);
    return;
  }
  const place = findBlock(blocks, targetId);
  if (!place) throw new Error(`Block ${targetId} not found`);
  if (position === 'inside' || position === 'first') {
    if (position === 'inside') place.block.children.push(...newBlocks);
    else place.block.children.unshift(...newBlocks);
    delete place.block.collapsed;
  } else {
    place.siblings.splice(position === 'before' ? place.index : place.index + 1, 0, ...newBlocks);
  }
}

/**
 * Enter: splits a block at the caret. At the start of a non-empty block a new block goes above;
 * in a block with open children the rest of the text becomes the first child.
 * @param {Block[]} blocks
 * @param {string} id
 * @param {number} caret
 * @returns {{focusId: string, caret: number, newId: string}}
 */
export function splitBlock(blocks, id, caret) {
  const place = findBlock(blocks, id);
  if (!place) throw new Error(`Block ${id} not found`);
  const { block } = place;
  const hasOpenChildren = block.children.length > 0 && !block.collapsed;

  if (caret === 0 && block.text !== '') {
    const above = insertBefore(blocks, id, createBlock(''));
    return { focusId: id, caret: 0, newId: above.id };
  }
  const before = block.text.slice(0, caret);
  const after = block.text.slice(caret);
  block.text = before;
  const fresh = createBlock(after);
  if (hasOpenChildren) insertFirstChild(blocks, id, fresh);
  else insertAfter(blocks, id, fresh);
  return { focusId: fresh.id, caret: 0, newId: fresh.id };
}

/**
 * Backspace at the start: joins this block onto the previous visible block. Its children move
 * along. An empty block without children simply disappears.
 * @returns {{focusId: string, caret: number}|null} null if there is no previous block
 */
export function mergeIntoPrevious(blocks, id) {
  const visible = visibleBlocks(blocks);
  const position = visible.findIndex((block) => block.id === id);
  if (position <= 0) return null;
  const previous = visible[position - 1];
  const place = findBlock(blocks, id);
  const caret = previous.text.length;
  previous.text += place.block.text;
  place.siblings.splice(place.index, 1, ...place.block.children);
  return { focusId: previous.id, caret };
}

/**
 * Delete at the end: pulls the next visible block's text into this one. The pulled block's
 * children take its place.
 * @returns {{focusId: string, caret: number}|null}
 */
export function mergeNextInto(blocks, id) {
  const visible = visibleBlocks(blocks);
  const position = visible.findIndex((block) => block.id === id);
  if (position < 0 || position >= visible.length - 1) return null;
  const current = visible[position];
  const next = visible[position + 1];
  const caret = current.text.length;
  current.text += next.text;
  const place = findBlock(blocks, next.id);
  place.siblings.splice(place.index, 1, ...next.children);
  return { focusId: current.id, caret };
}

/**
 * Deep copy of blocks with new ids (templates, paste, merge of pages).
 * @param {Block[]} blocks
 * @returns {Block[]}
 */
export function cloneBlocks(blocks) {
  return blocks.map((block) => {
    const copy = { id: newId('b'), text: block.text, children: cloneBlocks(block.children) };
    if (block.collapsed) copy.collapsed = true;
    return copy;
  });
}

/**
 * Deep copy that keeps ids (undo snapshots).
 * @param {Block[]} blocks
 * @returns {Block[]}
 */
export function snapshotBlocks(blocks) {
  return blocks.map((block) => {
    const copy = { id: block.id, text: block.text, children: snapshotBlocks(block.children) };
    if (block.collapsed) copy.collapsed = true;
    return copy;
  });
}

/**
 * Blocks as a markdown list ("- text", two spaces per level). Continuation lines of multi-line
 * blocks are indented to stay inside their bullet.
 * @param {Block[]} blocks
 * @param {number} [depth=0]
 * @returns {string}
 */
export function blocksToPlainText(blocks, depth = 0) {
  const indentation = '  '.repeat(depth);
  return blocks
    .map((block) => {
      const [first, ...rest] = block.text.split('\n');
      const lines = [`${indentation}- ${first}`, ...rest.map((line) => `${indentation}  ${line}`)];
      const children = block.children.length ? `\n${blocksToPlainText(block.children, depth + 1)}` : '';
      return lines.join('\n') + children;
    })
    .join('\n');
}

/**
 * Counts blocks including all descendants.
 * @param {Block[]} blocks
 * @returns {number}
 */
export function countBlocks(blocks) {
  let count = 0;
  walkBlocks(blocks, () => {
    count += 1;
  });
  return count;
}
