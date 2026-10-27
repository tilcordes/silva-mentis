// Turns the markdown syntax tree (core/markdown.js) into DOM. This is the only place where note
// text becomes visible elements, and it only ever creates text nodes and known elements.

import { parseBlock, parseInline } from '../core/markdown.js';
import { h } from './dom.js';

/**
 * @typedef {object} RenderOptions
 * @property {(title: string) => string} idForTitle page id for a title (for link hrefs)
 * @property {boolean} [showBrackets=true] faint [[ ]] around page links
 * @property {Array<{start: number, end: number}>} [mentions] ranges to underline (unlinked references)
 */

/**
 * Renders a whole block's content (the part next to the bullet).
 * @param {string} text
 * @param {RenderOptions} options
 * @returns {{element: HTMLElement, tree: import('../core/markdown.js').BlockTree}}
 */
export function renderBlock(text, options) {
  const tree = parseBlock(text);
  const content = h('div', { class: ['content', tree.heading && `h${tree.heading}`, tree.quote && 'quote', tree.task === 'done' && 'done'] });
  if (tree.task) {
    content.append(h('span', {
      class: ['check', tree.task === 'done' && 'on'],
      role: 'checkbox',
      'aria-checked': tree.task === 'done' ? 'true' : 'false',
      'aria-label': tree.task === 'done' ? 'Done' : 'To do',
      'data-action': 'toggle-task',
    }));
  }
  const body = h('span', { class: 't' });
  if (tree.attribute) {
    body.append(h('strong', { class: 'attr' }, pageLink(tree.attribute.name, options, [tree.attribute.name], 'attr-link'), ':'), ' ');
  }
  tree.body.forEach((node, index) => {
    if (index > 0 && node.type === 'line' && tree.body[index - 1].type === 'line') body.append(h('br'));
    if (node.type === 'line') body.append(...renderInline(node.children, options));
    else if (node.type === 'codeBlock') body.append(h('pre', { class: 'code-block', 'data-language': node.language || null }, h('code', null, node.value)));
    else if (node.type === 'rule') body.append(h('hr'));
  });
  if (text.trim() === '') body.append(h('span', { class: 'empty' }, '\u200b'));
  content.append(body);
  return { element: content, tree };
}

/**
 * Renders inline nodes.
 * @param {Array<object>} nodes
 * @param {RenderOptions} options
 * @param {boolean} [insideLink=false] links can't contain links; their inner links render as text
 * @returns {Node[]}
 */
export function renderInline(nodes, options, insideLink = false) {
  const result = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        result.push(...renderText(node, options));
        break;
      case 'pageRef':
        if (insideLink) {
          result.push(...renderInline(node.children, options, true));
        } else {
          const label = renderInline(node.children, options, true);
          const showBrackets = options.showBrackets !== false;
          result.push(pageLink(node.title, options, [
            showBrackets && h('span', { class: 'br' }, '[['),
            ...label,
            showBrackets && h('span', { class: 'br' }, ']]'),
          ]));
        }
        break;
      case 'tag':
        result.push(insideLink ? document.createTextNode(`#${node.title}`) : pageLink(node.title, options, [`#${node.title}`], 'tag'));
        break;
      case 'alias':
        result.push(insideLink
          ? h('span', null, ...renderInline(node.children, options, true))
          : pageLink(node.title, options, renderInline(node.children, options, true), 'ref alias'));
        break;
      case 'link':
        result.push(insideLink
          ? h('span', null, ...renderInline(node.children, options, true))
          : externalLink(node.url, node.children.length ? renderInline(node.children, options, true) : [node.url]));
        break;
      case 'autolink':
        result.push(insideLink ? document.createTextNode(node.text) : externalLink(node.url, [node.text]));
        break;
      case 'strong':
        result.push(h('strong', null, ...renderInline(node.children, options, insideLink)));
        break;
      case 'emphasis':
        result.push(h('em', null, ...renderInline(node.children, options, insideLink)));
        break;
      case 'highlight':
        result.push(h('mark', null, ...renderInline(node.children, options, insideLink)));
        break;
      case 'strike':
        result.push(h('s', null, ...renderInline(node.children, options, insideLink)));
        break;
      case 'code':
        result.push(h('code', null, node.value));
        break;
      default:
        break;
    }
  }
  return result;
}

/** Text, with the unlinked mentions from `options.mentions` underlined. */
function renderText(node, options) {
  const mentions = (options.mentions ?? []).filter((m) => m.start >= node.start && m.end <= node.end);
  // Offsets map 1:1 onto the value only when the source had no escapes.
  if (mentions.length === 0 || node.end - node.start !== node.value.length) return [document.createTextNode(node.value)];
  const parts = [];
  let position = node.start;
  for (const mention of mentions.sort((a, b) => a.start - b.start)) {
    if (mention.start > position) parts.push(document.createTextNode(node.value.slice(position - node.start, mention.start - node.start)));
    parts.push(h('span', { class: 'mention' }, node.value.slice(mention.start - node.start, mention.end - node.start)));
    position = mention.end;
  }
  if (position < node.end) parts.push(document.createTextNode(node.value.slice(position - node.start)));
  return parts;
}

/**
 * A link to a page. Clicks are handled by event delegation in app.js via data-page-title.
 * @param {string} title
 * @param {RenderOptions} options
 * @param {any[]} children
 * @param {string} [className='ref']
 */
export function pageLink(title, options, children, className = 'ref') {
  return h('a', { class: className, href: `#/p/${options.idForTitle(title)}`, 'data-page-title': title }, ...children);
}

function externalLink(url, children) {
  return h('a', { class: 'external', href: url, target: '_blank', rel: 'noopener noreferrer nofollow' }, ...children);
}

/**
 * A title as inline DOM. Only [[links]] inside a title are special; everything else is shown as
 * written ("C# notes" has no tag, "**x**" stays as typed).
 * @param {string} title
 * @param {RenderOptions} options
 * @returns {Node[]}
 */
export function renderTitle(title, options) {
  const nodes = [];
  let position = 0;
  for (const node of parseInline(title)) {
    if (node.type !== 'pageRef') continue;
    if (node.start > position) nodes.push(document.createTextNode(title.slice(position, node.start)));
    nodes.push(...renderInline([node], options));
    position = node.end;
  }
  if (position < title.length) nodes.push(document.createTextNode(title.slice(position)));
  return nodes;
}
