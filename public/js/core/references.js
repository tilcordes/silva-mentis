// Which pages a piece of text refers to, and how to rewrite those references.
// All rewriting works on source offsets from the syntax tree, so
// text inside code, URLs or other links is never touched by accident.

import { formatTag, parseBlock, parseInline } from './markdown.js';

/**
 * Titles of all pages a block refers to, in order of appearance, without duplicates:
 * [[links]] (also nested), #tags, aliases and the attribute name.
 * @param {string} text
 * @returns {string[]}
 */
export function blockReferences(text) {
  const titles = new Set();
  const tree = parseBlock(text);
  if (tree.attribute) titles.add(tree.attribute.name);
  for (const node of tree.body) {
    if (node.type === 'line') collectTitles(node.children, titles, true);
  }
  return [...titles];
}

/**
 * Titles a page title refers to: "Article: [[Writing]] tips" refers to "Writing".
 * @param {string} title
 * @returns {string[]}
 */
export function titleReferences(title) {
  // Inside a title, only bracketed links count (a "#" in a title is just a character).
  const titles = new Set();
  collectTitles(parseInline(title), titles, false);
  return [...titles];
}

function collectTitles(nodes, titles, includeTags) {
  for (const node of nodes) {
    if (node.type === 'pageRef') titles.add(node.title);
    if (node.type === 'alias') titles.add(node.title);
    if (node.type === 'tag' && includeTags) titles.add(node.title);
    if (node.children) collectTitles(node.children, titles, includeTags);
  }
}

/**
 * Rewrites every reference to `oldTitle` in a block's text so it points to `newTitle`.
 * Tags are re-written in the form the new title needs (#New or #[[New Title]]).
 * @param {string} text
 * @param {string} oldTitle
 * @param {string} newTitle
 * @returns {string} the new text (the same string if nothing referred to oldTitle)
 */
export function renameInText(text, oldTitle, newTitle) {
  const tree = parseBlock(text);
  const edits = [];
  if (tree.attribute?.name === oldTitle) {
    edits.push({ start: tree.attribute.nameStart, end: tree.attribute.nameEnd, value: newTitle });
  }
  for (const node of tree.body) {
    if (node.type === 'line') collectRenames(node.children, oldTitle, newTitle, edits);
  }
  return applyEdits(text, edits);
}

/**
 * Rewrites [[oldTitle]] inside another page's title.
 * @param {string} title
 * @param {string} oldTitle
 * @param {string} newTitle
 * @returns {string}
 */
export function renameInTitle(title, oldTitle, newTitle) {
  const edits = [];
  collectRenames(parseInline(title), oldTitle, newTitle, edits, true);
  return applyEdits(title, edits);
}

function collectRenames(nodes, oldTitle, newTitle, edits, linksOnly = false) {
  for (const node of nodes) {
    if ((node.type === 'pageRef' || node.type === 'alias') && node.title === oldTitle) {
      edits.push({ start: node.titleStart, end: node.titleEnd, value: newTitle });
      if (node.type === 'alias') collectRenames(node.children, oldTitle, newTitle, edits, linksOnly);
      continue;
    }
    if (node.type === 'tag' && !linksOnly && node.title === oldTitle) {
      edits.push({ start: node.start, end: node.end, value: formatTag(newTitle) });
      continue;
    }
    if (node.children) collectRenames(node.children, oldTitle, newTitle, edits, linksOnly);
  }
}

/** Applies non-overlapping {start, end, value} replacements. */
function applyEdits(text, edits) {
  if (edits.length === 0) return text;
  edits.sort((a, b) => b.start - a.start);
  let result = text;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  return result;
}

/**
 * Plain-text mentions of a title: case-insensitive, whole words, only in ordinary text (never in
 * links, tags, URLs or code).
 * @param {string} text block text
 * @param {string} title page title
 * @returns {Array<{start: number, end: number}>} source ranges in `text`
 */
export function findMentions(text, title) {
  const needle = title.trim();
  if (needle === '') return [];
  const pattern = new RegExp(escapeRegExp(needle), 'giu');
  const mentions = [];
  const tree = parseBlock(text);
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        const source = text.slice(node.start, node.end);
        for (const match of source.matchAll(pattern)) {
          const start = node.start + match.index;
          const end = start + match[0].length;
          if (isWordBoundary(text, start - 1) && isWordBoundary(text, end)) mentions.push({ start, end });
        }
      } else if (['strong', 'emphasis', 'highlight', 'strike'].includes(node.type)) {
        visit(node.children);
      }
    }
  };
  for (const node of tree.body) {
    if (node.type === 'line') visit(node.children);
  }
  return mentions;
}

function isWordBoundary(text, index) {
  return index < 0 || index >= text.length || !/[\p{L}\p{N}\p{M}_]/u.test(text[index]);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Turns one mention into a link. The link always uses the page's exact title, whatever spelling
 * the mention had ("mindfulness" → "[[Mindfulness]]").
 * @param {string} text
 * @param {{start: number, end: number}} mention
 * @param {string} title
 * @returns {string}
 */
export function linkMention(text, mention, title) {
  return `${text.slice(0, mention.start)}[[${title}]]${text.slice(mention.end)}`;
}
