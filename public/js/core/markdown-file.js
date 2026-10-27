// Pages as markdown files: export (one .md file per page in a .zip), import, and turning pasted
// text into blocks. The exact page title travels in a small front matter block, because file
// names can't hold every character a title may contain ("Medley 192: 1/13/2020").

import { createZip, readZip } from './zip.js';
import { blocksToPlainText, createBlock } from './outline.js';

/**
 * @param {import('./page-index.js').Page} page
 * @returns {string} the page as a markdown document
 */
export function pageToMarkdown(page) {
  const front = [
    '---',
    `title: ${JSON.stringify(page.title)}`,
    `created: ${new Date(page.created).toISOString()}`,
    `updated: ${new Date(page.updated).toISOString()}`,
    '---',
    '',
  ].join('\n');
  const body = blocksToPlainText(page.blocks);
  return `${front}\n${body}${body ? '\n' : ''}`;
}

/**
 * Reads a markdown document back into a page (without id).
 * @param {string} text
 * @param {string} fileName used for the title when there is no front matter
 * @returns {{title: string, created: number|null, updated: number|null, blocks: import('./outline.js').Block[]}}
 */
export function markdownToPage(text, fileName) {
  let body = text.replace(/\r\n?/g, '\n').replace(/^\ufeff/, '');
  const meta = {};
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (front) {
    for (const line of front[1].split('\n')) {
      const match = /^([A-Za-z]+):\s*(.*)$/.exec(line);
      if (match) meta[match[1].toLowerCase()] = parseFrontMatterValue(match[2]);
    }
    body = body.slice(front[0].length);
  }
  const fallbackTitle = fileName.split('/').pop().replace(/\.(md|markdown|txt)$/i, '').trim();
  const title = (typeof meta.title === 'string' && meta.title.trim()) || fallbackTitle || 'Untitled';
  return {
    title: title.replace(/[\r\n]+/g, ' ').trim(),
    created: toTime(meta.created),
    updated: toTime(meta.updated),
    blocks: parseOutlineText(body),
  };
}

function parseFrontMatterValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function toTime(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : null;
}

/**
 * Turns text into blocks. List items ("- ", "* ", "+ ", "1. ") become bullets and their
 * indentation becomes nesting; lines indented under an item continue it; other non-empty lines
 * become one bullet each. Used for import and for pasting.
 * @param {string} text
 * @returns {import('./outline.js').Block[]}
 */
export function parseOutlineText(text) {
  const root = [];
  /** @type {Array<{indent: number, contentIndent: number, block: object}>} */
  const stack = [];
  let current = null;
  let inFence = false;

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/\t/g, '    ');
    const indent = line.length - line.trimStart().length;

    if (current && (inFence || (line.trim() !== '' && indent >= current.contentIndent && !isListItem(line)))) {
      // Continuation of the current bullet (code fences keep everything, blank lines included).
      const stripped = line.slice(Math.min(indent, current.contentIndent));
      current.block.text += `\n${stripped}`;
      if (/^```/.test(stripped.trim())) inFence = !inFence;
      continue;
    }
    if (line.trim() === '') {
      current = null;
      continue;
    }

    const item = /^(\s*)([-*+]|\d+[.)])(?:\s+(.*))?$/.exec(line);
    const content = item ? (item[3] ?? '') : line.trim();
    const contentIndent = item ? indent + item[2].length + 1 : indent + 1;
    const block = createBlock(content);
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    (parent ? parent.block.children : root).push(block);
    current = { indent, contentIndent, block };
    stack.push(current);
    inFence = (content.match(/```/g) ?? []).length % 2 === 1;
  }
  return root;
}

function isListItem(line) {
  return /^\s*([-*+]|\d+[.)])(\s|$)/.test(line);
}

/**
 * A file name for a title that works on Windows, macOS and Linux. Names already in `used`
 * (compared without case) get " (2)", " (3)"…
 * @param {string} title
 * @param {Set<string>} used lower-case names taken so far; the new name is added
 * @returns {string}
 */
export function safeFileName(title, used) {
  let base = title
    .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  if (base === '') base = 'Untitled';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `_${base}`;
  base = base.slice(0, 120);
  let name = `${base}.md`;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base} (${n}).md`;
  used.add(name.toLowerCase());
  return name;
}

/**
 * All pages as one .zip of markdown files.
 * @param {import('./page-index.js').Page[]} pages
 * @returns {Uint8Array}
 */
export function exportArchive(pages) {
  const encoder = new TextEncoder();
  const used = new Set();
  const sorted = [...pages].sort((a, b) => a.title.localeCompare(b.title));
  return createZip(sorted.map((page) => ({
    name: safeFileName(page.title, used),
    data: encoder.encode(pageToMarkdown(page)),
    date: new Date(page.updated),
  })));
}

/**
 * Reads files chosen for import: .md/.markdown/.txt files and .zip archives of them.
 * @param {Array<{name: string, data: Uint8Array}>} files
 * @returns {Promise<{pages: ReturnType<typeof markdownToPage>[], skipped: string[]}>}
 */
export async function importFiles(files) {
  const decoder = new TextDecoder();
  const pages = [];
  const skipped = [];
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      const inner = await importFiles(await readZip(file.data));
      pages.push(...inner.pages);
      skipped.push(...inner.skipped);
    } else if (/\.(md|markdown|txt)$/i.test(file.name)) {
      pages.push(markdownToPage(decoder.decode(file.data), file.name));
    } else {
      skipped.push(file.name);
    }
  }
  return { pages, skipped };
}
