// The markdown dialect of a block. Text is parsed into a syntax tree;
// only ui/render.js turns that tree into DOM. Nothing here produces HTML, so note text can never
// become markup.
//
// Every node keeps start/end offsets into the block's text. References, rename, "Link" for
// unlinked mentions and the editor all rely on those offsets to change exactly the right characters.

const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const TAG_CHAR = /[\p{L}\p{M}\p{N}_\-./]/u;
const LETTER = /\p{L}/u;
const ALNUM = /[\p{L}\p{N}]/u;

/** Delimiter → node type. Longer delimiters are tried first. */
const EMPHASIS = [
  ['**', 'strong'], ['__', 'strong'], ['==', 'highlight'], ['^^', 'highlight'], ['~~', 'strike'],
  ['*', 'emphasis'], ['_', 'emphasis'],
];

/**
 * @typedef {object} BlockTree
 * @property {null|'todo'|'done'} task
 * @property {0|1|2|3} heading
 * @property {boolean} quote
 * @property {null|{name: string, start: number, end: number, nameStart: number, nameEnd: number}} attribute
 * @property {Array<object>} body block-level nodes: line, codeBlock, rule
 * @property {number} bodyStart offset in the text where the body begins
 */

/**
 * Parses the full text of one block.
 * @param {string} text
 * @returns {BlockTree}
 */
export function parseBlock(text) {
  let position = 0;
  let task = null;
  let heading = 0;
  let quote = false;
  let attribute = null;

  const taskMatch = /^\[([ xX])\](?: |$)/.exec(text);
  if (taskMatch) {
    task = taskMatch[1] === ' ' ? 'todo' : 'done';
    position = taskMatch[0].length;
  }

  const rest = text.slice(position);
  const headingMatch = /^(#{1,3}) /.exec(rest);
  if (headingMatch) {
    heading = headingMatch[1].length;
    position += headingMatch[0].length;
  } else if (rest.startsWith('> ')) {
    quote = true;
    position += 2;
  }

  // "Key:: value" — an attribute. The key is itself a page reference.
  const attributeMatch = /^([^\n`:[\]]+|\[\[[^\n\]]+\]\])::(?: |$)/.exec(text.slice(position));
  if (attributeMatch) {
    const raw = attributeMatch[1];
    const bracketed = raw.startsWith('[[');
    const inner = bracketed ? raw.slice(2, -2) : raw;
    const name = inner.trim();
    if (name !== '' && !/^\s/.test(raw)) {
      const nameStart = position + (bracketed ? 2 : 0) + (inner.length - inner.trimStart().length);
      attribute = {
        name,
        start: position,
        end: position + raw.length + 2,
        nameStart,
        nameEnd: nameStart + name.length,
      };
      position += attributeMatch[0].length;
    }
  }

  return { task, heading, quote, attribute, body: parseBody(text, position), bodyStart: position };
}

/** Splits the body into lines, fenced code blocks and horizontal rules. */
function parseBody(text, from) {
  const nodes = [];
  let fence = null;
  let lineStart = from;
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd);

    if (fence) {
      if (/^```\s*$/.test(line)) {
        nodes.push({ type: 'codeBlock', language: fence.language, value: fence.lines.join('\n'), start: fence.start, end: lineEnd });
        fence = null;
      } else {
        fence.lines.push(line);
      }
    } else if (line.startsWith('```')) {
      fence = { language: line.slice(3).trim(), start: lineStart, lines: [] };
    } else if (/^-{3,}\s*$/.test(line)) {
      nodes.push({ type: 'rule', start: lineStart, end: lineEnd });
    } else {
      nodes.push({ type: 'line', start: lineStart, end: lineEnd, children: parseInline(line, lineStart) });
    }
    lineStart = lineEnd + 1;
  }
  if (fence) {
    // An unclosed fence runs to the end of the block, like in most editors.
    nodes.push({ type: 'codeBlock', language: fence.language, value: fence.lines.join('\n'), start: fence.start, end: text.length });
  }
  return nodes;
}

/**
 * Parses inline markdown (one line, or the inside of a link or emphasis).
 * @param {string} text
 * @param {number} [offset=0] added to every start/end, so offsets point into the block's text
 * @returns {Array<object>} inline nodes: text, pageRef, tag, alias, link, autolink, strong,
 *   emphasis, highlight, strike, code — each with start/end offsets
 */
export function parseInline(text, offset = 0) {
  const nodes = [];
  let pending = '';
  let pendingStart = -1;

  const addText = (start, value) => {
    if (pendingStart < 0) pendingStart = start;
    pending += value;
  };
  const flush = (end) => {
    if (pending !== '') nodes.push({ type: 'text', value: pending, start: offset + pendingStart, end: offset + end });
    pending = '';
    pendingStart = -1;
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];

    if (char === '\\' && i + 1 < text.length && ESCAPABLE.test(text[i + 1])) {
      addText(i, text[i + 1]);
      i += 2;
      continue;
    }

    if (char === '`') {
      const code = matchCode(text, i);
      if (code) {
        flush(i);
        nodes.push({ type: 'code', value: code.value, start: offset + i, end: offset + code.end });
        i = code.end;
      } else {
        // An unmatched run of backticks is literal text, all of it.
        const run = backtickRun(text, i);
        addText(i, '`'.repeat(run));
        i += run;
      }
      continue;
    }

    const match = matchConstruct(text, i, offset);
    if (match) {
      flush(i);
      nodes.push(match.node);
      i = match.end;
      continue;
    }

    addText(i, char);
    i += 1;
  }
  flush(text.length);
  return nodes;
}

/** Tries every construct that can start at position i. Returns {node, end} or null. */
function matchConstruct(text, i, offset) {
  const char = text[i];
  if (char === '[' && text[i + 1] === '[') return matchPageRef(text, i, offset);
  if (char === '#') return matchTag(text, i, offset);
  if (char === '!' && text[i + 1] === '[') {
    const link = matchLink(text, i + 1, offset);
    if (!link || link.node.type !== 'link') return null;
    // Images are shown as links labelled with their alt text (no external requests).
    const alt = text.slice(i + 2, link.labelEnd);
    link.node.start = offset + i;
    link.node.children = alt === '' ? [] : [{ type: 'text', value: alt, start: offset + i + 2, end: offset + link.labelEnd }];
    return link;
  }
  if (char === '[') return matchLink(text, i, offset);
  if ((char === 'h' || char === 'H') && (i === 0 || !ALNUM.test(text[i - 1]))) return matchAutolink(text, i, offset);
  for (const [delimiter, type] of EMPHASIS) {
    if (text.startsWith(delimiter, i)) {
      const emphasis = matchEmphasis(text, i, delimiter, type, offset);
      if (emphasis) return emphasis;
    }
  }
  return null;
}

/** [[Title]] with nesting: [[Article: [[Writing]] tips]]. */
function matchPageRef(text, i, offset) {
  const close = findClosingBrackets(text, i + 2);
  if (close < 0) return null;
  const raw = text.slice(i + 2, close);
  const title = raw.trim();
  if (title === '') return null;
  return {
    node: {
      type: 'pageRef',
      title,
      children: parseInline(raw, offset + i + 2),
      start: offset + i,
      end: offset + close + 2,
      titleStart: offset + i + 2,
      titleEnd: offset + close,
    },
    end: close + 2,
  };
}

/** #tag or #[[Multi Word Tag]]. A tag must start the text or follow whitespace or "(". */
function matchTag(text, i, offset) {
  if (i > 0 && !/[\s(]/.test(text[i - 1])) return null;
  if (text.startsWith('#[[', i)) {
    const close = findClosingBrackets(text, i + 3);
    if (close < 0) return null;
    const title = text.slice(i + 3, close).trim();
    if (title === '') return null;
    return {
      node: { type: 'tag', title, bracketed: true, start: offset + i, end: offset + close + 2 },
      end: close + 2,
    };
  }
  let end = i + 1;
  while (end < text.length && TAG_CHAR.test(text[end])) end += 1;
  // "." and "/" may appear inside a tag (#v1.2, #work/admin) but not end it.
  while (end > i + 1 && /[./]/.test(text[end - 1])) end -= 1;
  const title = text.slice(i + 1, end);
  if (!LETTER.test(title)) return null;
  return {
    node: { type: 'tag', title, bracketed: false, start: offset + i, end: offset + end },
    end,
  };
}

/** [label](https://…) or the alias form [label]([[Page]]). */
function matchLink(text, i, offset) {
  const labelEnd = findClosing(text, i + 1, '[', ']');
  if (labelEnd < 0 || text[labelEnd + 1] !== '(') return null;
  const destinationEnd = findClosing(text, labelEnd + 2, '(', ')');
  if (destinationEnd < 0) return null;
  const rawDestination = text.slice(labelEnd + 2, destinationEnd);
  const destination = rawDestination.trim();
  const label = text.slice(i + 1, labelEnd);
  const children = parseInline(label, offset + i + 1);
  const start = offset + i;
  const end = offset + destinationEnd + 1;

  if (destination.startsWith('[[') && findClosingBrackets(destination, 2) === destination.length - 2) {
    const title = destination.slice(2, -2).trim();
    if (title === '') return null;
    const leading = rawDestination.length - rawDestination.trimStart().length;
    const titleStart = offset + labelEnd + 2 + leading + 2;
    return {
      node: { type: 'alias', title, children, start, end, titleStart, titleEnd: titleStart + destination.length - 4 },
      end: destinationEnd + 1,
      labelEnd,
    };
  }

  const url = safeUrl(destination);
  if (url === null) return null; // e.g. javascript: — the whole thing stays plain text
  return { node: { type: 'link', url, children, start, end }, end: destinationEnd + 1, labelEnd };
}

/** A bare https:// or http:// address in running text. */
function matchAutolink(text, i, offset) {
  const scheme = /^https?:\/\//i.exec(text.slice(i, i + 8));
  if (!scheme) return null;
  let end = i + scheme[0].length;
  while (end < text.length && !/[\s<>"]/.test(text[end])) end += 1;
  // Trailing punctuation usually belongs to the sentence, not the address.
  for (;;) {
    const last = text[end - 1];
    if (/[.,;:!?'\]*_]/.test(last)) {
      end -= 1;
    } else if (last === ')') {
      const candidate = text.slice(i, end);
      const opens = candidate.split('(').length - 1;
      const closes = candidate.split(')').length - 1;
      if (closes > opens) end -= 1;
      else break;
    } else {
      break;
    }
  }
  if (end <= i + scheme[0].length) return null;
  const source = text.slice(i, end);
  const url = safeUrl(source);
  if (url === null) return null;
  return { node: { type: 'autolink', url, text: source, start: offset + i, end: offset + end }, end };
}

/** **strong**, *emphasis*, ==highlight==, ^^highlight^^, ~~strike~~ and the _ forms. */
function matchEmphasis(text, i, delimiter, type, offset) {
  const contentStart = i + delimiter.length;
  if (contentStart >= text.length || /\s/.test(text[contentStart])) return null;
  const underscore = delimiter[0] === '_';
  if (underscore && i > 0 && WORD_CHAR.test(text[i - 1])) return null; // snake_case stays text
  const close = findClosingDelimiter(text, contentStart, delimiter);
  if (close <= contentStart) return null;
  return {
    node: {
      type,
      children: parseInline(text.slice(contentStart, close), offset + contentStart),
      start: offset + i,
      end: offset + close + delimiter.length,
    },
    end: close + delimiter.length,
  };
}

/**
 * Finds the closing delimiter, skipping code spans, page links and escapes, which can't contain
 * the end of an emphasis.
 */
function findClosingDelimiter(text, from, delimiter) {
  const underscore = delimiter[0] === '_';
  for (let j = from; j < text.length; j += 1) {
    const char = text[j];
    if (char === '\\') {
      j += 1;
      continue;
    }
    if (char === '`') {
      const code = matchCode(text, j);
      if (code) j = code.end - 1;
      else j += backtickRun(text, j) - 1;
      continue;
    }
    if (char === '[' && text[j + 1] === '[') {
      const close = findClosingBrackets(text, j + 2);
      if (close >= 0) {
        j = close + 1;
        continue;
      }
    }
    if (!text.startsWith(delimiter, j)) continue;
    if (delimiter.length === 1 && text[j + 1] === delimiter) {
      j += 1; // "**" inside "*…*" belongs to a nested strong
      continue;
    }
    if (/\s/.test(text[j - 1])) continue;
    if (underscore && j + delimiter.length < text.length && WORD_CHAR.test(text[j + delimiter.length])) continue;
    return j;
  }
  return -1;
}

/** `code` with any number of backticks; the closing run must have the same length. */
function matchCode(text, i) {
  const run = backtickRun(text, i);
  const fence = '`'.repeat(run);
  let search = i + run;
  for (;;) {
    const close = text.indexOf(fence, search);
    if (close < 0) return null;
    const closeRun = backtickRun(text, close);
    if (closeRun === run) {
      let value = text.slice(i + run, close);
      if (value.length >= 2 && value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '') {
        value = value.slice(1, -1);
      }
      return { value, end: close + run };
    }
    search = close + closeRun;
  }
}

function backtickRun(text, i) {
  let run = 0;
  while (text[i + run] === '`') run += 1;
  return run;
}

/** Index of the "]]" matching an opening "[[" whose inside starts at `from`, or -1. */
function findClosingBrackets(text, from) {
  let depth = 1;
  for (let j = from; j < text.length - 1; j += 1) {
    if (text[j] === '\n') return -1;
    if (text[j] === '[' && text[j + 1] === '[') {
      depth += 1;
      j += 1;
    } else if (text[j] === ']' && text[j + 1] === ']') {
      depth -= 1;
      if (depth === 0) return j;
      j += 1;
    }
  }
  return -1;
}

/** Index of the bracket closing an `open` whose inside starts at `from` (single line), or -1. */
function findClosing(text, from, open, close) {
  let depth = 1;
  for (let j = from; j < text.length; j += 1) {
    const char = text[j];
    if (char === '\n') return -1;
    if (char === '\\') {
      j += 1;
    } else if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/**
 * Normalises a link target and allows only http:, https: and mailto:.
 * @param {string} raw
 * @returns {string|null} the URL to use, or null if it must not become a link
 */
export function safeUrl(raw) {
  const trimmed = String(raw).trim();
  if (!/^(https?:\/\/|mailto:)/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
    if (url.protocol !== 'mailto:' && url.hostname === '') return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Whether a title can be written as a bare tag (#Title) instead of #[[Title]].
 * @param {string} title
 * @returns {boolean}
 */
export function isBareTagTitle(title) {
  return /^[\p{L}\p{M}\p{N}_\-./]+$/u.test(title) && LETTER.test(title) && !/[./]$/.test(title);
}

/**
 * Writes a tag for a page title in the shortest form that parses back to the same title.
 * @param {string} title
 * @returns {string} "#Books" or "#[[Modern Religion]]"
 */
export function formatTag(title) {
  return isBareTagTitle(title) ? `#${title}` : `#[[${title}]]`;
}

/**
 * The readable text of inline nodes without markup (breadcrumbs, search, tab titles).
 * Page links keep their title, tags their "#".
 * @param {Array<object>} nodes
 * @returns {string}
 */
export function inlineToPlainText(nodes) {
  let result = '';
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
      case 'code':
        result += node.value;
        break;
      case 'autolink':
        result += node.text;
        break;
      case 'tag':
        result += `#${node.title}`;
        break;
      case 'pageRef':
        result += inlineToPlainText(node.children);
        break;
      default:
        result += inlineToPlainText(node.children ?? []);
    }
  }
  return result;
}

/**
 * The readable text of a whole block, one line per source line.
 * @param {string} text
 * @returns {string}
 */
export function blockToPlainText(text) {
  const tree = parseBlock(text);
  const lines = tree.body.map((node) => {
    if (node.type === 'line') return inlineToPlainText(node.children);
    if (node.type === 'codeBlock') return node.value;
    return '';
  });
  const prefix = tree.attribute ? `${tree.attribute.name}: ` : '';
  return (prefix + lines.join('\n')).trim();
}
