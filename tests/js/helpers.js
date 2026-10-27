// Small builders shared by the JavaScript tests.

import { PageIndex } from '../../public/js/core/page-index.js';

let counter = 0;

/**
 * A block tree from a compact outline: strings are blocks, arrays are the children of the
 * block before them. block(['A', ['A1', 'A2'], 'B'])
 */
export function blocks(outline) {
  const result = [];
  for (const item of outline) {
    if (Array.isArray(item)) result[result.length - 1].children = blocks(item);
    else result.push({ id: `b${(counter += 1)}`, text: item, children: [] });
  }
  return result;
}

/** A page document. */
export function page(title, outline = [], { updated = 1000, id } = {}) {
  return { kind: 'page', id: id ?? `p${(counter += 1)}`, title, created: updated, updated, blocks: blocks(outline) };
}

/** An index filled with pages. */
export function indexOf(...pages) {
  const index = new PageIndex();
  for (const p of pages) index.setPage(p);
  return index;
}

/** Texts of a block tree as nested arrays, for compact assertions. */
export function shape(list) {
  const result = [];
  for (const block of list) {
    result.push(block.text);
    if (block.children.length) result.push(shape(block.children));
  }
  return result;
}
