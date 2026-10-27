// The editor for one block: a textarea that takes the place of the rendered text while a block
// is being edited. It implements the outline keyboard model (see showShortcuts() in app.js) and the
// [[, # and / menus. There is one editor for the whole app; it moves from block to block.

import {
  findBlock, indent, insertBlocks, mergeIntoPrevious, mergeNextInto, moveDown, moveUp, outdent,
  removeBlocks, splitBlock,
} from '../core/outline.js';
import { formatTag } from '../core/markdown.js';
import { parseOutlineText } from '../core/markdown-file.js';
import { searchTitles } from '../core/search.js';
import { addDays, formatDailyTitle } from '../core/dates.js';
import { instantiateTemplate, listTemplates, TEMPLATES_TITLE } from '../core/templates.js';
import { h, isModKey } from './dom.js';
import { caretRect, isOnFirstLine, isOnLastLine } from './caret.js';
import { SuggestionMenu } from './suggestions.js';

/** Characters that wrap a selection instead of replacing it. */
const WRAPPERS = { '*': '*', _: '_', '=': '=', '^': '^', '~': '~', '`': '`', '[': ']', '(': ')', '"': '"' };

const SLASH_COMMANDS = [
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'date', label: 'Date…' },
  { id: 'task', label: 'Task' },
  { id: 'h1', label: 'Heading 1' },
  { id: 'h2', label: 'Heading 2' },
  { id: 'h3', label: 'Heading 3' },
  { id: 'quote', label: 'Quote' },
  { id: 'code', label: 'Code block' },
  { id: 'time', label: 'Current time' },
  { id: 'template', label: 'Template…' },
];

export class BlockEditor {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    this.textarea = h('textarea', { class: 'editor', rows: '1', spellcheck: 'true', 'aria-label': 'Bullet text' });
    /** @type {{view: import('./outline-view.js').OutlineView, pageId: string, blockId: string}|null} */
    this.target = null;
    this.menu = new SuggestionMenu();
    this.autocomplete = null;
    this.suppressMenuAt = -1;
    this.moving = false;
    this.savedSelection = null;

    this.textarea.addEventListener('input', (event) => this.onInput(event));
    this.textarea.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.textarea.addEventListener('paste', (event) => this.onPaste(event));
    this.textarea.addEventListener('blur', () => this.onBlur());
    this.textarea.addEventListener('click', () => this.updateAutocomplete());
  }

  // ── opening and closing ─────────────────────────────────────────────────────────────────

  /**
   * Starts editing a block.
   * @param {import('./outline-view.js').OutlineView} view
   * @param {string} blockId
   * @param {number} [caret] defaults to the end of the text
   */
  open(view, blockId, caret) {
    const block = findBlock(view.page?.blocks ?? [], blockId)?.block;
    if (!block) return;
    if (this.target && (this.target.view !== view || this.target.blockId !== blockId)) this.close();
    this.app.selection.clear();
    this.target = { view, pageId: view.pageId, blockId };
    this.textarea.value = block.text;
    const position = Math.min(caret ?? block.text.length, block.text.length);
    this.savedSelection = [position, position];
    this.reattach(view);
    this.app.touchToolbar?.show();
  }

  /** Stops editing; the block is rendered again everywhere it appears. */
  close() {
    if (!this.target) return;
    const { pageId } = this.target;
    this.target = null;
    this.menu.hide();
    this.autocomplete = null;
    const row = this.textarea.closest('.row');
    this.textarea.remove();
    row?.classList.remove('editing');
    this.app.touchToolbar?.hide();
    this.app.store.emit('pages', { ids: [pageId], origin: 'commit' });
  }

  isEditing(view, blockId) {
    return this.target?.view === view && this.target.blockId === blockId;
  }

  /** Called by a view right before it rebuilds its DOM (the textarea is about to be detached). */
  beginMove() {
    this.moving = true;
    if (this.textarea.isConnected) this.savedSelection = [this.textarea.selectionStart, this.textarea.selectionEnd];
  }

  /** Puts the textarea into the (re-rendered) row of the edited block and focuses it. */
  reattach(view) {
    this.moving = false;
    if (!this.target || this.target.view !== view) return;
    const row = view.rowFor(this.target.blockId);
    if (!row) {
      // The block disappeared (deleted elsewhere): stop editing quietly.
      this.target = null;
      this.textarea.remove();
      this.menu.hide();
      return;
    }
    const content = row.querySelector('.content');
    if (content) content.hidden = true;
    row.classList.add('editing');
    row.append(this.textarea);
    this.autosize();
    this.textarea.focus({ preventScroll: true });
    if (this.savedSelection) this.textarea.setSelectionRange(...this.savedSelection);
    row.scrollIntoView?.({ block: 'nearest' });
  }

  onBlur() {
    setTimeout(() => {
      if (this.moving || !this.target || document.activeElement === this.textarea) return;
      if (document.activeElement?.closest?.('.touch-toolbar, .suggestions, .date-picker')) return;
      this.close();
    }, 0);
  }

  autosize() {
    this.textarea.style.height = 'auto';
    this.textarea.style.height = `${this.textarea.scrollHeight}px`;
  }

  get caret() {
    return this.textarea.selectionStart;
  }

  get focus() {
    return this.target ? { blockId: this.target.blockId, caret: this.caret } : null;
  }

  // ── changing the store ──────────────────────────────────────────────────────────────────

  /** Saves the textarea's text into the block. */
  commitText(history = 'typing') {
    const { pageId, blockId } = this.target;
    const value = this.textarea.value;
    this.app.store.updatePage(pageId, (blocks) => {
      const place = findBlock(blocks, blockId);
      if (place) place.block.text = value;
    }, { history, focus: this.focus, origin: 'typing' });
  }

  /**
   * Runs an outline operation on the edited page, then edits `focusId` at `caret`.
   * @param {(blocks: object[]) => ({focusId: string, caret: number}|boolean|null|void)} operation
   */
  structural(operation) {
    const { view, pageId, blockId } = this.target;
    const before = this.focus;
    let result;
    this.app.store.updatePage(pageId, (blocks) => {
      result = operation(blocks);
    }, { history: 'structure', focus: before, origin: 'edit' });
    if (result && typeof result === 'object') {
      this.open(view, result.focusId, result.caret);
    } else if (this.target) {
      this.open(view, blockId, before.caret);
    }
  }

  /** Replaces the textarea text (and the block's) and puts the caret at `caret`. */
  setText(text, caret, history = 'structure') {
    this.textarea.value = text;
    this.textarea.setSelectionRange(caret, caret);
    this.savedSelection = [caret, caret];
    this.commitText(history);
    this.autosize();
    this.updateAutocomplete();
  }

  // ── typing ──────────────────────────────────────────────────────────────────────────────

  onInput(event) {
    if (!this.target) return;
    const value = this.textarea.value;
    const caret = this.caret;
    // Typing "[[" adds the closing "]]" and opens page suggestions.
    if (event.inputType === 'insertText' && event.data === '[' && value.slice(caret - 2, caret) === '[['
      && value.slice(caret, caret + 2) !== ']]') {
      this.textarea.value = `${value.slice(0, caret)}]]${value.slice(caret)}`;
      this.textarea.setSelectionRange(caret, caret);
    }
    this.commitText('typing');
    this.autosize();
    this.updateAutocomplete();
  }

  onKeyDown(event) {
    if (!this.target || event.isComposing) return;
    if (this.menu.isOpen && this.handleMenuKey(event)) return;

    const mod = isModKey(event);
    const { selectionStart: start, selectionEnd: end, value } = this.textarea;
    const key = event.key;

    const handled = (() => {
      if (key === 'Enter' && mod) return this.cycleTask();
      if (key === 'Enter' && !event.shiftKey && !event.altKey) return this.enter();
      if (key === 'Tab') return this.tab(event.shiftKey);
      if (key === 'Escape') return this.escape();
      if (key === 'Backspace' && start === 0 && end === 0 && !mod) return this.backspaceAtStart();
      if (key === 'Delete' && start === value.length && end === start && !mod) return this.deleteAtEnd();
      if ((key === 'ArrowUp' || key === 'ArrowDown') && event.shiftKey && (event.altKey || mod)) {
        return this.move(key === 'ArrowUp' ? -1 : 1);
      }
      if ((key === 'ArrowUp' || key === 'ArrowDown') && mod && !event.shiftKey) return this.collapse(key === 'ArrowUp');
      if (key === 'ArrowUp' && !event.shiftKey && !event.altKey && isOnFirstLine(this.textarea)) return this.navigate(-1, 'column');
      if (key === 'ArrowDown' && !event.shiftKey && !event.altKey && isOnLastLine(this.textarea)) return this.navigate(1, 'column');
      if (key === 'ArrowLeft' && !event.shiftKey && !mod && start === 0 && end === 0) return this.navigate(-1, 'end');
      if (key === 'ArrowRight' && !event.shiftKey && !mod && start === value.length && end === start) return this.navigate(1, 'start');
      if (mod && !event.altKey && (key === 'z' || key === 'Z')) return this.undo(event.shiftKey ? 'redo' : 'undo');
      if (mod && !event.altKey && (key === 'y' || key === 'Y')) return this.undo('redo');
      if (mod && !event.shiftKey && (key === 'b' || key === 'B')) return this.wrap('**', '**');
      if (mod && !event.shiftKey && (key === 'i' || key === 'I')) return this.wrap('*', '*');
      if (mod && !event.shiftKey && (key === 'h' || key === 'H')) return this.wrap('==', '==');
      if (!mod && !event.altKey && start !== end && WRAPPERS[key] !== undefined) return this.wrap(key, WRAPPERS[key], true);
      return false;
    })();
    if (handled) event.preventDefault();
  }

  enter() {
    const { blockId } = this.target;
    const place = findBlock(this.target.view.page.blocks, blockId);
    // Enter in an empty nested bullet moves it out one level, as in most outliners.
    if (place && place.block.text === '' && place.parent && place.block.children.length === 0) {
      this.structural((blocks) => outdent(blocks, blockId));
      return true;
    }
    const caret = this.caret;
    const selectionEnd = this.textarea.selectionEnd;
    if (selectionEnd > caret) {
      this.textarea.setRangeText('', caret, selectionEnd, 'start');
      this.commitText('structure');
    }
    this.structural((blocks) => splitBlock(blocks, blockId, caret));
    return true;
  }

  tab(back) {
    const { blockId } = this.target;
    this.structural((blocks) => (back ? outdent(blocks, blockId) : indent(blocks, blockId)));
    return true;
  }

  escape() {
    const { view, blockId } = this.target;
    this.close();
    this.app.selection.select(view, [blockId]);
    return true;
  }

  backspaceAtStart() {
    const { blockId } = this.target;
    const page = this.target.view.page;
    const place = findBlock(page.blocks, blockId);
    if (!place) return false;
    const visible = this.target.view.visibleIds();
    if (visible[0] === blockId) {
      // First block of this view: an empty one may go if something else remains.
      if (place.block.text === '' && place.block.children.length === 0 && visible.length > 1) {
        const next = visible[1];
        this.structural((blocks) => {
          removeBlocks(blocks, [blockId]);
          return { focusId: next, caret: 0 };
        });
        return true;
      }
      return place.block.text === '';
    }
    this.structural((blocks) => mergeIntoPrevious(blocks, blockId));
    return true;
  }

  deleteAtEnd() {
    const { blockId } = this.target;
    this.structural((blocks) => mergeNextInto(blocks, blockId));
    return true;
  }

  move(direction) {
    const { blockId } = this.target;
    this.structural((blocks) => (direction < 0 ? moveUp(blocks, blockId) : moveDown(blocks, blockId)));
    return true;
  }

  collapse(fold) {
    const { blockId } = this.target;
    this.structural((blocks) => {
      const { block } = findBlock(blocks, blockId);
      if (fold && block.children.length) block.collapsed = true;
      else delete block.collapsed;
    });
    return true;
  }

  /**
   * Moves the caret to the previous or next block in the same panel (main column, a sidebar
   * card), crossing from a page into its references and back.
   * @param {-1|1} direction
   * @param {'column'|'start'|'end'} where
   */
  navigate(direction, where) {
    const rows = this.panelRows();
    const current = this.target.view.rowFor(this.target.blockId);
    const index = rows.indexOf(current);
    const next = rows[index + direction];
    if (!next) return where !== 'column';
    const view = next.closest('ul.root').outlineView;
    const blockId = next.parentElement.dataset.blockId;
    const text = findBlock(view.page.blocks, blockId)?.block.text ?? '';
    let caret = where === 'start' ? 0 : text.length;
    if (where === 'column') {
      const value = this.textarea.value;
      const column = this.caret - (value.lastIndexOf('\n', this.caret - 1) + 1);
      if (direction > 0) caret = Math.min(column, text.indexOf('\n') < 0 ? text.length : text.indexOf('\n'));
      else caret = Math.min(text.lastIndexOf('\n') + 1 + column, text.length);
    }
    this.open(view, blockId, caret);
    return true;
  }

  panelRows() {
    const panel = this.target.view.element.closest('.panel') ?? document;
    return [...panel.querySelectorAll('ul.root li.block:not(.placeholder) > .row')];
  }

  undo(direction) {
    const { view, pageId } = this.target;
    const focus = this.app.store.undo(pageId, direction, this.focus);
    if (focus === false) return true;
    if (focus && findBlock(view.page?.blocks ?? [], focus.blockId)) this.open(view, focus.blockId, focus.caret);
    else this.close();
    return true;
  }

  /** Wraps the selection in before/after, or unwraps it if it is already wrapped that way. */
  wrap(before, after, typed = false) {
    const { selectionStart: start, selectionEnd: end, value } = this.textarea;
    const selected = value.slice(start, end);
    if (!typed && value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
      this.textarea.value = value.slice(0, start - before.length) + selected + value.slice(end + after.length);
      this.textarea.setSelectionRange(start - before.length, end - before.length);
    } else {
      this.textarea.value = value.slice(0, start) + before + selected + after + value.slice(end);
      this.textarea.setSelectionRange(start + before.length, end + before.length);
    }
    this.commitText('structure');
    return true;
  }

  // ── tasks and prefixes ──────────────────────────────────────────────────────────────────

  /** Ctrl+Enter: none → [ ] → [x] → none. */
  cycleTask() {
    const value = this.textarea.value;
    const caret = this.caret;
    const match = /^\[([ xX])\] ?/.exec(value);
    let text;
    let shift;
    if (!match) {
      text = `[ ] ${value}`;
      shift = 4;
    } else if (match[1] === ' ') {
      text = `[x] ${value.slice(match[0].length)}`;
      shift = 4 - match[0].length;
    } else {
      text = value.slice(match[0].length);
      shift = -match[0].length;
    }
    this.setText(text, Math.max(0, caret + shift));
    return true;
  }

  /** Clicking a checkbox in rendered text. */
  toggleTask(view, blockId) {
    this.app.store.updatePage(view.pageId, (blocks) => {
      const { block } = findBlock(blocks, blockId);
      const match = /^\[([ xX])\]/.exec(block.text);
      if (!match) return;
      block.text = (match[1] === ' ' ? '[x]' : '[ ]') + block.text.slice(3);
    }, { history: 'structure', origin: 'edit' });
  }

  /** Replaces a heading/quote prefix (or adds one), keeping a task box in front. */
  setPrefix(prefix) {
    const value = this.textarea.value;
    const task = /^\[[ xX]\] ?/.exec(value)?.[0] ?? '';
    const rest = value.slice(task.length).replace(/^(#{1,3} |> )/, '');
    const caret = Math.max(0, this.caret - (value.length - (task + prefix + rest).length));
    this.setText(task + prefix + rest, caret);
  }

  // ── paste ───────────────────────────────────────────────────────────────────────────────

  onPaste(event) {
    const text = event.clipboardData?.getData('text/plain');
    if (!text || !/\n/.test(text.trim())) return; // single line: the browser pastes it
    const pasted = parseOutlineText(text);
    if (pasted.length === 0) return;
    event.preventDefault();
    const { blockId } = this.target;
    const current = this.textarea.value;
    const last = lastDescendant(pasted);
    this.structural((blocks) => {
      const place = findBlock(blocks, blockId);
      if (current.trim() === '') {
        // Replace the empty bullet with the pasted outline.
        place.block.text = pasted[0].text;
        place.block.children.push(...pasted[0].children);
        if (pasted.length > 1) insertBlocks(blocks, blockId, 'after', pasted.slice(1));
        return { focusId: last === pasted[0] ? blockId : last.id, caret: last.text.length };
      }
      insertBlocks(blocks, blockId, 'after', pasted);
      return { focusId: last.id, caret: last.text.length };
    });
  }

  // ── suggestions: [[ # / ─────────────────────────────────────────────────────────────────

  handleMenuKey(event) {
    switch (event.key) {
      case 'ArrowDown':
        this.menu.move(1);
        break;
      case 'ArrowUp':
        this.menu.move(-1);
        break;
      case 'Enter':
      case 'Tab':
        this.menu.pick();
        break;
      case 'Escape':
        this.menu.hide();
        this.suppressMenuAt = this.autocomplete?.start ?? -1;
        this.autocomplete = null;
        break;
      default:
        return false;
    }
    event.preventDefault();
    return true;
  }

  /** Looks at the text before the caret and shows the matching menu (or hides it). */
  updateAutocomplete() {
    if (!this.target || this.textarea.selectionStart !== this.textarea.selectionEnd) {
      this.menu.hide();
      return;
    }
    const value = this.textarea.value;
    const caret = this.caret;
    const before = value.slice(0, caret);
    const context = findAutocompleteContext(before);
    if (!context || context.start === this.suppressMenuAt) {
      if (!context) this.suppressMenuAt = -1;
      this.autocomplete = null;
      this.menu.hide();
      return;
    }
    this.autocomplete = context;
    const anchor = caretRect(this.textarea, context.start);
    if (context.kind === 'slash') {
      const query = context.query.toLowerCase();
      const items = SLASH_COMMANDS.filter((command) => command.label.toLowerCase().includes(query))
        .map((command) => ({ label: command.label, value: command.id }));
      this.menu.show({ anchor, items, onPick: (item) => this.runSlashCommand(item.value) });
      return;
    }
    this.menu.show({
      anchor,
      items: this.pageSuggestions(context.query),
      onPick: (item) => this.insertPage(item.value),
    });
  }

  pageSuggestions(query) {
    const index = this.app.store.index;
    const trimmed = query.trim();
    const { pageId, blockId } = this.target;
    // While typing "[[Mind", the block already links to "Mind"; such half-typed titles are no suggestion.
    const onlyHere = (title) => !index.pageByTitle(title)
      && index.linkedReferences(title).every((ref) => ref.pageId === pageId && ref.blockId === blockId);
    let items;
    if (trimmed === '') {
      items = [...index.pages.values()]
        .filter((page) => page.blocks.length)
        .sort((a, b) => b.updated - a.updated)
        .slice(0, 8)
        .map((page) => ({ label: page.title, detail: index.referenceCount(page.title), value: page.title }));
    } else {
      items = searchTitles(index, trimmed, 12)
        .filter((result) => !onlyHere(result.title))
        .slice(0, 8)
        .map((result) => ({ label: result.title, detail: result.references, value: result.title }));
    }
    if (trimmed !== '' && !items.some((item) => item.value === trimmed)) {
      items.push({ label: `Create page “${trimmed}”`, create: true, value: trimmed });
    }
    return items;
  }

  /** Puts the picked title into the text in the right form for [[ or #. */
  insertPage(title) {
    const { kind, start } = this.autocomplete;
    const value = this.textarea.value;
    const caret = this.caret;
    if (kind === 'page') {
      const close = value.indexOf(']]', caret);
      const closeOk = close >= 0 && !/\n|\[\[/.test(value.slice(caret, close));
      const end = closeOk ? close : caret;
      const text = `${value.slice(0, start)}${title}]]${value.slice(closeOk ? end + 2 : end)}`;
      this.setText(text, start + title.length + 2, 'typing');
    } else {
      const tag = formatTag(title);
      const tail = value.slice(caret);
      const space = tail.startsWith(' ') ? '' : ' ';
      this.setText(`${value.slice(0, start)}${tag}${space}${tail}`, start + tag.length + 1, 'typing');
    }
    this.menu.hide();
    this.autocomplete = null;
  }

  /** Removes "/query" and runs the command. */
  runSlashCommand(id) {
    const { start } = this.autocomplete;
    const value = this.textarea.value;
    const caret = this.caret;
    const text = value.slice(0, start) + value.slice(caret);
    this.autocomplete = null;
    this.menu.hide();
    this.textarea.value = text;
    this.textarea.setSelectionRange(start, start);
    const insert = (snippet, caretOffset = snippet.length) => {
      const current = this.textarea.value;
      const at = this.caret;
      this.setText(current.slice(0, at) + snippet + current.slice(at), at + caretOffset);
    };
    const today = new Date();
    switch (id) {
      case 'today': insert(`[[${formatDailyTitle(today)}]]`); break;
      case 'tomorrow': insert(`[[${formatDailyTitle(addDays(today, 1))}]]`); break;
      case 'yesterday': insert(`[[${formatDailyTitle(addDays(today, -1))}]]`); break;
      case 'task': this.setText(text, start); this.cycleTask(); break;
      case 'h1': this.setText(text, start); this.setPrefix('# '); break;
      case 'h2': this.setText(text, start); this.setPrefix('## '); break;
      case 'h3': this.setText(text, start); this.setPrefix('### '); break;
      case 'quote': this.setText(text, start); this.setPrefix('> '); break;
      case 'code': insert('```\n\n```', 4); break;
      case 'time': insert(today.toTimeString().slice(0, 5)); break;
      case 'date': {
        this.setText(text, start);
        this.app.datePicker.open({
          anchor: caretRect(this.textarea),
          onPick: (date) => {
            if (this.target) {
              this.textarea.focus();
              insert(`[[${formatDailyTitle(date)}]]`);
            }
          },
        });
        break;
      }
      case 'template': this.setText(text, start); this.chooseTemplate(); break;
      default: break;
    }
  }

  chooseTemplate() {
    const templates = listTemplates(this.app.store.index.pageByTitle(TEMPLATES_TITLE));
    this.autocomplete = { kind: 'template', start: this.caret, query: '' };
    this.menu.show({
      anchor: caretRect(this.textarea),
      items: templates.map((template) => ({ label: template.name, value: template })),
      emptyText: `Add templates to the page “${TEMPLATES_TITLE}”: one bullet per template, its children are the template.`,
      onPick: (item) => this.insertTemplate(item.value),
    });
  }

  insertTemplate(template) {
    const { blockId } = this.target;
    const empty = this.textarea.value.trim() === '';
    const copies = instantiateTemplate(template);
    if (copies.length === 0) return;
    const last = lastDescendant(copies);
    this.structural((blocks) => {
      const place = findBlock(blocks, blockId);
      if (empty) {
        place.block.text = copies[0].text;
        place.block.children.push(...copies[0].children);
        insertBlocks(blocks, blockId, 'after', copies.slice(1));
        return { focusId: last === copies[0] ? blockId : last.id, caret: last.text.length };
      }
      insertBlocks(blocks, blockId, 'inside', copies);
      return { focusId: last.id, caret: last.text.length };
    });
  }

  // ── commands for the touch toolbar ──────────────────────────────────────────────────────

  /** @param {'indent'|'outdent'|'up'|'down'|'task'|'bold'|'highlight'|'link'|'tag'|'done'} name */
  command(name) {
    if (!this.target) return;
    this.textarea.focus();
    switch (name) {
      case 'indent': this.tab(false); break;
      case 'outdent': this.tab(true); break;
      case 'up': this.move(-1); break;
      case 'down': this.move(1); break;
      case 'task': this.cycleTask(); break;
      case 'bold': this.wrap('**', '**'); break;
      case 'highlight': this.wrap('==', '=='); break;
      case 'link': {
        const { selectionStart: start, selectionEnd: end, value } = this.textarea;
        this.setText(`${value.slice(0, start)}[[${value.slice(start, end)}]]${value.slice(end)}`, start + 2 + (end - start), 'structure');
        break;
      }
      case 'tag': {
        const { selectionStart: start, value } = this.textarea;
        const space = start > 0 && !/\s/.test(value[start - 1]) ? ' ' : '';
        this.setText(`${value.slice(0, start)}${space}#${value.slice(start)}`, start + space.length + 1, 'typing');
        break;
      }
      case 'done': this.close(); break;
      default: break;
    }
  }
}

/**
 * Finds an unfinished [[link, #tag or /command right before the caret.
 * @param {string} before text before the caret
 * @returns {{kind: 'page'|'tag'|'slash', start: number, query: string}|null}
 *   start: where the replaced text begins (after "[[", at "#", at "/")
 */
export function findAutocompleteContext(before) {
  const open = before.lastIndexOf('[[');
  if (open >= 0) {
    const query = before.slice(open + 2);
    if (!query.includes(']]') && !query.includes('\n') && !query.includes('[[')) {
      return { kind: 'page', start: open + 2, query };
    }
  }
  const tag = /(^|[\s(])#([^\s#[\]()]+)$/.exec(before);
  if (tag) return { kind: 'tag', start: before.length - tag[2].length - 1, query: tag[2] };
  const slash = /(^|\s)\/([A-Za-z0-9 ]{0,20})$/.exec(before);
  if (slash && !slash[2].endsWith('  ')) return { kind: 'slash', start: before.length - slash[2].length - 1, query: slash[2].trim() };
  return null;
}

function lastDescendant(blocks) {
  let block = blocks[blocks.length - 1];
  while (block.children.length) block = block.children[block.children.length - 1];
  return block;
}

