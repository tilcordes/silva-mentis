// Templates live on an ordinary page called "Templates": each top-level bullet names a template,
// its children are the template itself. /template copies the children into the current outline.

import { cloneBlocks, createBlock } from './outline.js';
import { blockToPlainText } from './markdown.js';

export const TEMPLATES_TITLE = 'Templates';

/**
 * @param {import('./page-index.js').Page|undefined} templatesPage
 * @returns {Array<{id: string, name: string, blocks: import('./outline.js').Block[]}>}
 */
export function listTemplates(templatesPage) {
  if (!templatesPage) return [];
  return templatesPage.blocks
    .filter((block) => block.text.trim() !== '' && block.children.length > 0)
    .map((block) => ({ id: block.id, name: blockToPlainText(block.text), blocks: block.children }));
}

/**
 * Fresh copies (new ids) of a template's blocks, ready to insert.
 * @param {{blocks: import('./outline.js').Block[]}} template
 * @returns {import('./outline.js').Block[]}
 */
export function instantiateTemplate(template) {
  return cloneBlocks(template.blocks).map(expand);
}

function expand(block) {
  delete block.collapsed;
  block.children = block.children.map(expand);
  return block;
}

/** Shorthand: a block with children given as further arguments. */
function b(text, ...children) {
  return createBlock(text, children);
}

/**
 * The templates a new installation starts with: metadata nested under "Metadata::" so it can be
 * folded away.
 * @returns {import('./outline.js').Block[]} blocks for the Templates page
 */
export function defaultTemplates() {
  return [
    b('Book',
      b('Metadata::',
        b('Author:: '),
        b('Type:: #Books'),
        b('Recommended By:: '),
        b('Tags:: '),
        b('Date Read:: ')),
      b('Notes',
        b(''))),
    b('Article',
      b('Metadata::',
        b('Author:: '),
        b('Type:: #Articles'),
        b('URL:: '),
        b('Tags:: ')),
      b('Notes',
        b(''))),
    b('Blog Article',
      b('Metadata::',
        b('Status:: #drafting'),
        b('Target Date:: '),
        b('Tags:: #[[Blog Articles]]')),
      b('Outline',
        b('')),
      b('Draft',
        b(''))),
    b('Person',
      b('Metadata::',
        b('Phone Number:: '),
        b('Email:: '),
        b('Company:: '),
        b('Role:: '),
        b('Location:: '),
        b('How We Met:: '),
        b('Birthday:: '),
        b('Interests:: '),
        b('Tags:: #People')),
      b('Notes',
        b(''))),
  ];
}
