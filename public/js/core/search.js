// Search over the page index: titles for navigation and autocomplete, bullets for full-text.
// Matching ignores case; page titles themselves stay case-sensitive.

import { blockToPlainText } from './markdown.js';
import { walkBlocks } from './outline.js';

/**
 * Titles matching a query, best first: exact, prefix, word prefix, then anywhere.
 * Within a rank, pages with more references come first.
 * @param {import('./page-index.js').PageIndex} index
 * @param {string} query
 * @param {number} [limit=20]
 * @returns {Array<{id: string, title: string, virtual: boolean, references: number, rank: number}>}
 */
export function searchTitles(index, query, limit = 20) {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  const results = [];
  for (const title of index.allTitles()) {
    const rank = titleRank(title.toLowerCase(), needle);
    if (rank < 0) continue;
    results.push({
      id: index.idForTitle(title),
      title,
      virtual: !index.pageByTitle(title),
      references: index.referenceCount(title),
      rank,
    });
  }
  results.sort((a, b) => a.rank - b.rank || b.references - a.references
    || a.title.length - b.title.length || a.title.localeCompare(b.title));
  return results.slice(0, limit);
}

function titleRank(title, needle) {
  if (title === needle) return 0;
  if (title.startsWith(needle)) return 1;
  const words = title.split(/[^\p{L}\p{N}]+/u);
  if (words.some((word) => word.startsWith(needle))) return 2;
  if (title.includes(needle)) return 3;
  return -1;
}

/**
 * Bullets containing every word of the query, with a short snippet around the first match.
 * Most recently edited pages first.
 * @param {import('./page-index.js').PageIndex} index
 * @param {string} query
 * @param {number} [limit=50]
 * @returns {Array<{pageId: string, blockId: string, title: string, snippet: string}>}
 */
export function searchBlocks(index, query, limit = 50) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const pages = [...index.pages.values()].sort((a, b) => index.recency(b.id) - index.recency(a.id));
  const results = [];
  for (const page of pages) {
    walkBlocks(page.blocks, (block) => {
      if (results.length >= limit) return false;
      const lower = block.text.toLowerCase();
      if (!words.every((word) => lower.includes(word))) return true;
      results.push({ pageId: page.id, blockId: block.id, title: page.title, snippet: snippet(block.text, words[0]) });
      return true;
    });
    if (results.length >= limit) break;
  }
  return results;
}

/**
 * About 120 characters of readable text around the first occurrence of `word`.
 * @param {string} text
 * @param {string} word lower case
 * @returns {string}
 */
export function snippet(text, word, radius = 60) {
  const plain = blockToPlainText(text).replace(/\s+/g, ' ');
  const at = plain.toLowerCase().indexOf(word);
  if (at < 0 || plain.length <= radius * 2) return plain.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(plain.length, at + word.length + radius);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}
