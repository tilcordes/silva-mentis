// A tiny element builder. All DOM in the app is created here or with document.createElement;
// text is always set as text, never parsed as HTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates an element.
 *   h('a', {class: 'ref', href: '#/p/1', onclick: fn, 'data-page-title': t}, 'label', childNode)
 * Attributes: `class`, `on<event>` (function), boolean true/false, everything else via
 * setAttribute. Children: strings (as text), nodes, arrays, null/false (skipped).
 * @param {string} tag
 * @param {Record<string, any>|null} [attributes]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, attributes = null, ...children) {
  const element = document.createElement(tag);
  applyAttributes(element, attributes);
  append(element, children);
  return element;
}

function applyAttributes(element, attributes) {
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2), value);
    } else if (name === 'class') {
      element.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    } else if (name === 'value' || name === 'checked' || name === 'disabled') {
      element[name] = value;
    } else {
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }
}

/**
 * Appends children (same rules as h()).
 * @param {Node} parent
 * @param {any[]} children
 */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Removes all children of an element. */
export function clear(element) {
  while (element.firstChild) element.firstChild.remove();
  return element;
}

/** Replaces all children of an element. */
export function replaceChildren(element, ...children) {
  clear(element);
  append(element, children);
  return element;
}

// Icons are drawn from path data at 16×16, stroked in the current text color.
const ICONS = {
  search: ['M7 12.5A5.5 5.5 0 1 0 7 1.5a5.5 5.5 0 0 0 0 11z', 'M11 11l3.5 3.5'],
  filter: ['M2 3h12l-4.5 5.5V13l-3-1.5V8.5z'],
  star: ['M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z'],
  close: ['M4 4l8 8', 'M12 4l-8 8'],
  more: ['M3.5 8h.01', 'M8 8h.01', 'M12.5 8h.01'],
  menu: ['M2.5 4h11', 'M2.5 8h11', 'M2.5 12h11'],
  chevron: ['M6 4l4 4-4 4'],
  plus: ['M8 3v10', 'M3 8h10'],
  minus: ['M3 8h10'],
  calendar: ['M2.5 3.5h11v10h-11z', 'M2.5 6.5h11', 'M5.5 2v3', 'M10.5 2v3'],
  sidebar: ['M2 3h12v10H2z', 'M10 3v10'],
  back: ['M10 4L6 8l4 4'],
  send: ['M3 8h9', 'M8.5 4.5L12 8l-3.5 3.5'],
};

/**
 * An inline SVG icon.
 * @param {keyof ICONS} name
 * @param {{filled?: boolean}} [options]
 * @returns {SVGElement}
 */
export function icon(name, { filled = false } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon icon-${name}`);
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', filled ? 'currentColor' : 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', name === 'more' ? '2.4' : '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

/** True on devices whose main pointer is a finger. */
export function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches;
}

/** Ctrl on Windows/Linux, ⌘ on Apple devices. */
export function isModKey(event) {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
}

/** "Ctrl K" or "⌘ K" for hints. */
export function modLabel() {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
}

/** Offers bytes as a download. */
export function downloadFile(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = h('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
