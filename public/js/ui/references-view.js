// Linked references (every bullet that points to the page, editable in place, with the filter)
// and unlinked references (plain mentions of the title with a "Link" button). One reference is
// one referencing bullet; groups are ordered newest first and keep that order during editing.

import { ancestorsOf, findBlock } from '../core/outline.js';
import { blockToPlainText } from '../core/markdown.js';
import { linkMention } from '../core/references.js';
import { TITLE_SOURCE } from '../core/page-index.js';
import { clear, h, icon } from './dom.js';
import { OutlineView } from './outline-view.js';
import { pageLink, renderBlock } from './render.js';

export class ReferencesView {
  /**
   * @param {object} app
   * @param {string} pageId
   * @param {{collapsed?: boolean}} [options] collapsed: show only "N linked references" until clicked
   */
  constructor(app, pageId, { collapsed = false } = {}) {
    this.app = app;
    this.pageId = pageId;
    this.collapsed = collapsed;
    /** Group order is fixed when the page opens, so references don't jump while they are edited. */
    this.groupOrder = null;
    /** @type {Map<string, OutlineView>} "pageId blockId" → view */
    this.blockViews = new Map();
    this.unlinkedOpen = false;
    this.unlinkedTimer = null;
    this.filterPopover = null;

    this.linkedHead = h('div', { class: 'refs-head' });
    this.linkedBody = h('div', { class: 'ref-groups' });
    this.linked = h('section', { class: 'refs linked' }, this.linkedHead, this.linkedBody);
    this.unlinkedHead = h('div', { class: 'refs-head' });
    this.unlinkedBody = h('div', { class: 'ref-groups' });
    this.unlinked = h('section', { class: 'refs unlinked' }, this.unlinkedHead, this.unlinkedBody);
    this.element = h('div', { class: 'references' }, this.linked, this.unlinked);
    this.update([], 'open');
  }

  get title() {
    return this.app.store.titleOf(this.pageId) ?? '';
  }

  get filter() {
    const filters = this.app.referenceFilters;
    if (!filters.has(this.title)) filters.set(this.title, { include: new Set(), exclude: new Set() });
    return filters.get(this.title);
  }

  /** Recomputes after a change somewhere. Existing reference outlines are kept, not rebuilt. */
  update(ids, origin) {
    if (origin === 'typing') return;
    const index = this.app.store.index;
    const title = this.title;
    const all = index.linkedReferences(title);
    const filter = this.filter;
    const passing = index.filterReferences(all, filter, title);
    const filtering = filter.include.size > 0 || filter.exclude.size > 0;

    this.renderLinkedHead(all.length, passing.length, filtering);
    this.linked.hidden = all.length === 0 && !filtering;
    if (this.collapsed) {
      this.destroyBlockViews(new Set());
      clear(this.linkedBody);
    } else {
      this.renderGroups(index.groupReferences(title, passing));
    }
    if (this.filterPopover) this.renderFilterPopover(all);
    this.scheduleUnlinked();
  }

  renderLinkedHead(total, shown, filtering) {
    clear(this.linkedHead);
    if (this.collapsed) {
      this.linkedHead.append(h('button', {
        class: 'refs-toggle',
        type: 'button',
        onclick: () => {
          this.collapsed = false;
          this.update([], 'open');
        },
      }, `${total} linked reference${total === 1 ? '' : 's'}`));
      return;
    }
    this.linkedHead.append(
      h('h4', null, 'Linked references', h('span', { class: 'count' }, filtering ? `${shown} of ${total}` : String(total))),
      h('button', {
        class: ['icon-btn', filtering && 'on'],
        type: 'button',
        'aria-label': 'Filter references',
        title: 'Filter: click a page to require it, Shift+click to exclude it',
        'aria-expanded': this.filterPopover ? 'true' : 'false',
        onclick: () => this.toggleFilter(),
      }, icon('filter')),
    );
  }

  renderGroups(groups) {
    // Keep the order from when the page was opened; new groups go to the end.
    if (!this.groupOrder) this.groupOrder = groups.map((group) => group.pageId);
    for (const group of groups) if (!this.groupOrder.includes(group.pageId)) this.groupOrder.push(group.pageId);
    const byPage = new Map(groups.map((group) => [group.pageId, group]));
    const ordered = this.groupOrder.map((id) => byPage.get(id)).filter(Boolean);

    const keep = new Set();
    const elements = [];
    for (const group of ordered) {
      const page = this.app.store.getPage(group.pageId);
      const section = h('div', { class: 'ref-group' },
        h('h5', null, pageLink(group.title, this.app.renderOptions(), [group.title], 'ref-title')));
      if (group.viaTitle) section.append(h('div', { class: 'crumbs' }, 'Linked in the page title'));
      for (const blockId of group.blockIds) {
        if (blockId === TITLE_SOURCE) continue;
        const key = `${group.pageId} ${blockId}`;
        keep.add(key);
        let view = this.blockViews.get(key);
        if (!view) {
          view = new OutlineView(this.app, { pageId: group.pageId, rootIds: [blockId] });
          this.blockViews.set(key, view);
        }
        const crumbs = ancestorsOf(page.blocks, blockId).map((block) => blockToPlainText(block.text)).filter(Boolean);
        section.append(h('div', { class: 'ref-item' },
          crumbs.length ? h('div', { class: 'crumbs' }, crumbs.map((text, i) => [i > 0 && h('span', { class: 'sep' }, '›'), h('span', null, text)])) : null,
          view.element));
      }
      elements.push(section);
    }
    this.destroyBlockViews(keep);
    // Existing outline elements are moved, not rebuilt; an editor open inside one is re-focused.
    const editor = this.app.editor;
    const editing = [...this.blockViews.values()].find((view) => editor.target?.view === view);
    if (editing) editor.beginMove();
    clear(this.linkedBody).append(...elements);
    if (editing) editor.reattach(editing);
    if (ordered.length === 0 && this.filter.include.size + this.filter.exclude.size > 0) {
      this.linkedBody.append(h('p', { class: 'empty-hint' }, 'No references match this filter.'));
    }
  }

  destroyBlockViews(keep) {
    for (const [key, view] of this.blockViews) {
      if (keep.has(key)) continue;
      view.destroy();
      this.blockViews.delete(key);
    }
  }

  // ── filter ──────────────────────────────────────────────────────────────────────────────

  toggleFilter() {
    if (this.filterPopover) {
      this.filterPopover.remove();
      this.filterPopover = null;
    } else {
      this.filterPopover = h('div', { class: 'popover filter-pop', role: 'dialog', 'aria-label': 'Filter references' });
      this.linked.append(this.filterPopover);
      this.renderFilterPopover(this.app.store.index.linkedReferences(this.title));
    }
    this.update([], 'filter');
  }

  renderFilterPopover(all) {
    const index = this.app.store.index;
    const title = this.title;
    const filter = this.filter;
    const passing = index.filterReferences(all, filter, title);
    const chips = index.filterChips(passing, title).filter((chip) => !filter.include.has(chip.title));
    const chip = (chipTitle, count, state) => h('button', {
      class: ['chip', state],
      type: 'button',
      title: state ? 'Click to remove' : 'Click to include, Shift+click to exclude',
      onclick: (event) => {
        if (state === 'inc') filter.include.delete(chipTitle);
        else if (state === 'exc') filter.exclude.delete(chipTitle);
        else if (event.shiftKey) filter.exclude.add(chipTitle);
        else filter.include.add(chipTitle);
        this.update([], 'filter');
      },
    }, chipTitle, count !== null && h('i', null, String(count)));

    clear(this.filterPopover).append(
      h('div', { class: 'filter-sel' },
        h('div', null,
          h('div', { class: 'mini-label' }, 'Include', h('span', null, 'click')),
          filter.include.size
            ? h('div', { class: 'chips' }, [...filter.include].map((t) => chip(t, null, 'inc')))
            : h('div', { class: 'empty-hint' }, 'Nothing included')),
        h('div', null,
          h('div', { class: 'mini-label' }, 'Exclude', h('span', null, 'shift-click')),
          filter.exclude.size
            ? h('div', { class: 'chips' }, [...filter.exclude].map((t) => chip(t, null, 'exc')))
            : h('div', { class: 'empty-hint' }, 'Nothing excluded'))),
      chips.length
        ? h('div', { class: 'chips' }, chips.map((c) => chip(c.title, c.count, null)))
        : h('div', { class: 'empty-hint' }, 'No other pages appear in these references.'),
    );
  }

  // ── unlinked references ─────────────────────────────────────────────────────────────────

  /** Counting mentions reads every page, so it waits until the browser is idle. */
  scheduleUnlinked() {
    clearTimeout(this.unlinkedTimer);
    this.unlinkedTimer = setTimeout(() => this.renderUnlinked(), this.unlinkedOpen ? 0 : 400);
  }

  renderUnlinked() {
    if (!this.element.isConnected || this.collapsed) {
      this.unlinked.hidden = true;
      return;
    }
    const found = this.app.store.index.unlinkedReferences(this.title);
    this.unlinked.hidden = found.length === 0 && !this.unlinkedOpen;
    clear(this.unlinkedHead).append(h('button', {
      class: 'refs-toggle head',
      type: 'button',
      'aria-expanded': this.unlinkedOpen ? 'true' : 'false',
      onclick: () => {
        this.unlinkedOpen = !this.unlinkedOpen;
        this.renderUnlinked();
      },
    }, icon('chevron'), h('h4', null, 'Unlinked references', h('span', { class: 'count' }, String(found.length)))));
    this.unlinkedHead.classList.toggle('open', this.unlinkedOpen);
    clear(this.unlinkedBody);
    if (!this.unlinkedOpen) return;

    let currentPage = null;
    for (const item of found) {
      const page = this.app.store.getPage(item.pageId);
      const block = findBlock(page.blocks, item.blockId)?.block;
      if (!block) continue;
      if (currentPage !== page.id) {
        currentPage = page.id;
        this.unlinkedBody.append(h('h5', { class: 'unlinked-title' }, pageLink(page.title, this.app.renderOptions(), [page.title], 'ref-title')));
      }
      const { element } = renderBlock(block.text, { ...this.app.renderOptions(), mentions: item.mentions });
      this.unlinkedBody.append(h('div', { class: 'unlinked-item' },
        h('div', { class: 'row static' }, h('span', { class: 'bullet', 'aria-hidden': 'true' }), element),
        h('button', {
          class: 'link-btn',
          type: 'button',
          title: `Turn this mention into a link to “${this.title}”`,
          onclick: () => this.link(item),
        }, 'Link')));
    }
  }

  link(item) {
    const title = this.title;
    this.app.store.updatePage(item.pageId, (blocks) => {
      const place = findBlock(blocks, item.blockId);
      if (place) place.block.text = linkMention(place.block.text, item.mentions[0], title);
    }, { origin: 'edit' });
  }

  destroy() {
    clearTimeout(this.unlinkedTimer);
    this.destroyBlockViews(new Set());
  }
}
