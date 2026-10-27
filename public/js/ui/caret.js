// Where the caret of a textarea is on screen. Browsers don't tell, so a hidden copy of the
// textarea ("mirror") with the same text and styles is measured instead.

const COPIED_STYLES = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight',
  'fontStretch', 'fontSize', 'lineHeight', 'fontFamily', 'fontFeatureSettings', 'textAlign', 'textTransform',
  'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize', 'overflowWrap', 'wordBreak',
];

let mirror = null;

/**
 * Caret position relative to the textarea's top-left corner.
 * @param {HTMLTextAreaElement} textarea
 * @param {number} position character offset
 * @returns {{top: number, left: number, height: number}}
 */
export function caretCoordinates(textarea, position) {
  if (!mirror) {
    mirror = document.createElement('div');
    mirror.setAttribute('aria-hidden', 'true');
    mirror.className = 'caret-mirror';
    document.body.append(mirror);
  }
  const computed = getComputedStyle(textarea);
  for (const property of COPIED_STYLES) mirror.style[property] = computed[property];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflow = 'hidden';
  mirror.textContent = textarea.value.slice(0, position);
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(position) || '.';
  mirror.append(marker);
  const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.5;
  return { top: marker.offsetTop - textarea.scrollTop, left: marker.offsetLeft - textarea.scrollLeft, height: lineHeight };
}

/**
 * Caret position in viewport coordinates, for placing popups.
 * @param {HTMLTextAreaElement} textarea
 * @param {number} [position] defaults to the selection start
 * @returns {{left: number, top: number, bottom: number}}
 */
export function caretRect(textarea, position = textarea.selectionStart) {
  const box = textarea.getBoundingClientRect();
  const caret = caretCoordinates(textarea, position);
  return { left: box.left + caret.left, top: box.top + caret.top, bottom: box.top + caret.top + caret.height };
}

/** Whether the caret is on the first visual line (so ↑ should leave the block). */
export function isOnFirstLine(textarea) {
  const position = textarea.selectionStart;
  if (!textarea.value.slice(0, position).includes('\n') && position < 2) return true;
  return caretCoordinates(textarea, position).top <= caretCoordinates(textarea, 0).top + 2;
}

/** Whether the caret is on the last visual line (so ↓ should leave the block). */
export function isOnLastLine(textarea) {
  const position = textarea.selectionEnd;
  return caretCoordinates(textarea, position).top >= caretCoordinates(textarea, textarea.value.length).top - 2;
}
