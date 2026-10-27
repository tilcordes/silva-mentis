// The in-memory index over all decrypted pages: titles, who references whom, virtual pages,
// reference filters and the graph. Everything associative in the app is answered from here.

import { newId } from './ids.js';
import { dateKey, parseDailyTitle } from './dates.js';
import { blockReferences, findMentions, titleReferences } from './references.js';
import { walkBlocks } from './outline.js';
import { TEMPLATES_TITLE } from './templates.js';

/** The source key used when a page's title (not a block) references another page. */
export const TITLE_SOURCE = '#title';

/** A block that starts with "Key::" (the same rule as core/markdown.js, without a task box). */
const ATTRIBUTE_START = /^([^\n`:[\]]+|\[\[[^\n\]]+\]\])::(?: |$)/;

/**
 * @typedef {object} Page
 * @property {'page'} kind
 * @property {string} id
 * @property {string} title
 * @property {number} created
 * @property {number} updated
 * @property {import('./outline.js').Block[]} blocks
 */

/**
 * @typedef {object} Reference one block (or the title) of one page that refers to a page
 * @property {string} pageId
 * @property {string} blockId block id, or TITLE_SOURCE
 */

export class PageIndex {
  constructor() {
    /** @type {Map<string, Page>} */
    this.pages = new Map();
    /** @type {Map<string, string>} title → page id, real pages only */
    this.idsByTitle = new Map();
    /** @type {Map<string, string>} page id → the title it is indexed under (pages are edited in place) */
    this.indexedTitles = new Map();
    /** @type {Map<string, string>} title → id for pages that exist only through references */
    this.virtualIds = new Map();
    /** @type {Map<string, Map<string, string[]>>} page id → (block id → referenced titles) */
    this.outgoing = new Map();
    /** @type {Map<string, Map<string, Set<string>>>} title → (page id → block ids) */
    this.incoming = new Map();
    /** Parsing is the expensive part; most block texts don't change between updates. */
    this.referenceCache = new Map();
  }

  /**
   * Adds or replaces a page and re-indexes its references.
   * @param {Page} page
   */
  setPage(page) {
    if (this.pages.has(page.id)) this.unindex(page.id);
    this.pages.set(page.id, page);
    this.idsByTitle.set(page.title, page.id);
    this.indexedTitles.set(page.id, page.title);
    this.virtualIds.delete(page.title);

    const sources = new Map();
    const titleRefs = titleReferences(page.title);
    if (titleRefs.length) sources.set(TITLE_SOURCE, titleRefs);
    // Templates are blueprints, not notes: "Type:: #Books" in the Book template is no reference.
    if (page.title !== TEMPLATES_TITLE) {
      walkBlocks(page.blocks, (block) => {
        const titles = this.referencesOf(block.text);
        if (titles.length) sources.set(block.id, titles);
      });
    }
    this.outgoing.set(page.id, sources);
    for (const [blockId, titles] of sources) {
      for (const title of titles) {
        if (!this.incoming.has(title)) this.incoming.set(title, new Map());
        const byPage = this.incoming.get(title);
        if (!byPage.has(page.id)) byPage.set(page.id, new Set());
        byPage.get(page.id).add(blockId);
      }
    }
  }

  /**
   * Removes a page. If others still reference its title, it lives on as a virtual page.
   * @param {string} id
   */
  removePage(id) {
    if (!this.pages.has(id)) return;
    this.unindex(id);
    this.pages.delete(id);
  }

  unindex(id) {
    const title = this.indexedTitles.get(id);
    if (this.idsByTitle.get(title) === id) this.idsByTitle.delete(title);
    this.indexedTitles.delete(id);
    for (const [, titles] of this.outgoing.get(id) ?? []) {
      for (const referenced of titles) {
        const byPage = this.incoming.get(referenced);
        byPage?.delete(id);
        if (byPage?.size === 0) this.incoming.delete(referenced);
      }
    }
    this.outgoing.delete(id);
  }

  referencesOf(text) {
    let titles = this.referenceCache.get(text);
    if (!titles) {
      titles = blockReferences(text);
      if (this.referenceCache.size > 20000) this.referenceCache.clear();
      this.referenceCache.set(text, titles);
    }
    return titles;
  }

  /** @returns {Page|undefined} */
  getPage(id) {
    return this.pages.get(id);
  }

  /** @returns {Page|undefined} the real page with exactly this title */
  pageByTitle(title) {
    const id = this.idsByTitle.get(title);
    return id ? this.pages.get(id) : undefined;
  }

  /**
   * The id under which a title is shown: the real page's id, or a stable in-memory id for a
   * virtual page (that id becomes the document id once the user writes into it).
   * @param {string} title
   * @returns {string}
   */
  idForTitle(title) {
    const id = this.idsByTitle.get(title);
    if (id) return id;
    if (!this.virtualIds.has(title)) {
      // Daily pages get a predictable id, so two devices writing into "today" meet in the same
      // document (and resolve it as a conflict) instead of creating two pages with one title.
      const day = parseDailyTitle(title);
      const dailyId = day ? `d${dateKey(day)}` : null;
      this.virtualIds.set(title, dailyId && !this.pages.has(dailyId) ? dailyId : newId('p'));
    }
    return this.virtualIds.get(title);
  }

  /**
   * The title for any id handed out by idForTitle(), real or virtual.
   * @param {string} id
   * @returns {string|undefined}
   */
  titleForId(id) {
    const page = this.pages.get(id);
    if (page) return page.title;
    for (const [title, virtualId] of this.virtualIds) if (virtualId === id) return title;
    return undefined;
  }

  /**
   * Titles referenced anywhere that have no page yet, plus real pages: every title in the graph.
   * @returns {string[]}
   */
  allTitles() {
    const titles = new Set(this.idsByTitle.keys());
    for (const [title, byPage] of this.incoming) if (byPage.size) titles.add(title);
    return [...titles];
  }

  /**
   * One row per page for All Pages (virtual pages included).
   * @returns {Array<{id: string, title: string, virtual: boolean, daily: boolean,
   *   references: number, created: number|null, updated: number|null}>}
   */
  listPages() {
    return this.allTitles().map((title) => {
      const page = this.pageByTitle(title);
      return {
        id: this.idForTitle(title),
        title,
        virtual: !page,
        daily: parseDailyTitle(title) !== null,
        references: this.referenceCount(title),
        created: page?.created ?? null,
        updated: page?.updated ?? null,
      };
    });
  }

  /**
   * All references to a title from other pages: one per referencing block (or title).
   * @param {string} title
   * @returns {Reference[]}
   */
  linkedReferences(title) {
    const ownId = this.idsByTitle.get(title);
    const result = [];
    for (const [pageId, blockIds] of this.incoming.get(title) ?? []) {
      if (pageId === ownId) continue;
      for (const blockId of blockIds) result.push({ pageId, blockId });
    }
    return result;
  }

  /** @param {string} title */
  referenceCount(title) {
    return this.linkedReferences(title).length;
  }

  /**
   * Linked references grouped by source page, newest first (daily pages by date, others by
   * last edit). Blocks keep their outline order within a group.
   * @param {string} title
   * @param {Reference[]} [references] defaults to all linked references
   * @returns {Array<{pageId: string, title: string, blockIds: string[], viaTitle: boolean}>}
   */
  groupReferences(title, references = this.linkedReferences(title)) {
    const byPage = new Map();
    for (const reference of references) {
      if (!byPage.has(reference.pageId)) byPage.set(reference.pageId, new Set());
      byPage.get(reference.pageId).add(reference.blockId);
    }
    const groups = [];
    for (const [pageId, ids] of byPage) {
      const page = this.pages.get(pageId);
      if (!page) continue;
      const blockIds = [];
      walkBlocks(page.blocks, (block) => {
        if (ids.has(block.id)) blockIds.push(block.id);
      });
      groups.push({ pageId, title: page.title, blockIds, viaTitle: ids.has(TITLE_SOURCE) });
    }
    return groups.sort((a, b) => this.recency(b.pageId) - this.recency(a.pageId) || a.title.localeCompare(b.title));
  }

  /** Sort key "how recent is this page": a daily page's date, otherwise its last edit. */
  recency(pageId) {
    const page = this.pages.get(pageId);
    const day = parseDailyTitle(page.title);
    return day ? day.getTime() : page.updated;
  }

  /**
   * The context of a reference for filtering: pages referenced by the block, its ancestors, its
   * descendants and the source page's title, plus the source page itself.
   * @param {Reference} reference
   * @param {string} viewedTitle excluded from the result
   * @returns {Set<string>}
   */
  referenceContext(reference, viewedTitle) {
    const page = this.pages.get(reference.pageId);
    const context = new Set([page.title, ...titleReferences(page.title), ...this.metadataReferences(page)]);
    if (reference.blockId !== TITLE_SOURCE) {
      walkBlocks(page.blocks, (block, ancestors) => {
        if (block.id !== reference.blockId) return true;
        for (const ancestor of ancestors) for (const title of this.referencesOf(ancestor.text)) context.add(title);
        walkBlocks([block], (inner) => {
          for (const title of this.referencesOf(inner.text)) context.add(title);
        });
        return false;
      });
    }
    context.delete(viewedTitle);
    return context;
  }

  /**
   * Pages referenced by a page's metadata: attribute blocks ("Type:: #Books") that sit at the top
   * level or only under other attribute blocks ("Metadata::"). They describe the whole page, so
   * every reference from that page carries them.
   * @param {Page} page
   * @returns {string[]}
   */
  metadataReferences(page) {
    const titles = [];
    walkBlocks(page.blocks, (block) => {
      if (!ATTRIBUTE_START.test(block.text)) return false; // not metadata: skip it and its children
      titles.push(...this.referencesOf(block.text));
      return true;
    });
    return titles;
  }

  /**
   * Applies a reference filter: every included page must be in a reference's context and no
   * removed page may be.
   * @param {Reference[]} references
   * @param {{include: Set<string>, exclude: Set<string>}} filter
   * @param {string} viewedTitle
   * @returns {Reference[]}
   */
  filterReferences(references, filter, viewedTitle) {
    if (filter.include.size === 0 && filter.exclude.size === 0) return references;
    return references.filter((reference) => {
      const context = this.referenceContext(reference, viewedTitle);
      for (const title of filter.include) if (!context.has(title)) return false;
      for (const title of filter.exclude) if (context.has(title)) return false;
      return true;
    });
  }

  /**
   * Filter chips: every page in the context of the given references, with how many of them
   * contain it. Most frequent first, then alphabetical.
   * @param {Reference[]} references
   * @param {string} viewedTitle
   * @returns {Array<{title: string, count: number}>}
   */
  filterChips(references, viewedTitle) {
    const counts = new Map();
    for (const reference of references) {
      for (const title of this.referenceContext(reference, viewedTitle)) counts.set(title, (counts.get(title) ?? 0) + 1);
    }
    return [...counts]
      .map(([title, count]) => ({ title, count }))
      .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  }

  /**
   * Plain-text mentions of a title in other pages' blocks that don't already reference it.
   * @param {string} title
   * @returns {Array<{pageId: string, blockId: string, mentions: Array<{start: number, end: number}>}>}
   */
  unlinkedReferences(title) {
    const ownId = this.idsByTitle.get(title);
    const results = [];
    const groups = [];
    for (const page of this.pages.values()) {
      if (page.id === ownId) continue;
      const found = [];
      walkBlocks(page.blocks, (block) => {
        if (this.referencesOf(block.text).includes(title)) return;
        const mentions = findMentions(block.text, title);
        if (mentions.length) found.push({ pageId: page.id, blockId: block.id, mentions });
      });
      if (found.length) groups.push({ pageId: page.id, found });
    }
    groups.sort((a, b) => this.recency(b.pageId) - this.recency(a.pageId));
    for (const group of groups) results.push(...group.found);
    return results;
  }

  /**
   * Every title a page refers to (in blocks or its title).
   * @param {string} pageId
   * @returns {Set<string>}
   */
  outgoingTitles(pageId) {
    const titles = new Set();
    for (const [, refs] of this.outgoing.get(pageId) ?? []) for (const title of refs) titles.add(title);
    return titles;
  }

  /**
   * Ids of pages that refer to a title anywhere (used by rename).
   * @param {string} title
   * @returns {string[]}
   */
  pagesReferencing(title) {
    return [...(this.incoming.get(title)?.keys() ?? [])];
  }

  /**
   * The link graph: one node per title, one undirected link per pair of pages that refer to
   * each other in either direction.
   * @returns {{nodes: Array<{id: string, title: string, daily: boolean, virtual: boolean, degree: number}>,
   *   links: Array<{source: string, target: string}>}}
   */
  graph() {
    const nodes = new Map();
    const node = (title) => {
      if (!nodes.has(title)) {
        nodes.set(title, {
          id: this.idForTitle(title),
          title,
          daily: parseDailyTitle(title) !== null,
          virtual: !this.idsByTitle.has(title),
          degree: 0,
        });
      }
      return nodes.get(title);
    };
    const seen = new Set();
    const links = [];
    for (const title of this.allTitles()) node(title);
    for (const page of this.pages.values()) {
      for (const target of this.outgoingTitles(page.id)) {
        if (target === page.title) continue;
        const a = node(page.title);
        const b = node(target);
        const key = a.id < b.id ? `${a.id} ${b.id}` : `${b.id} ${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        a.degree += 1;
        b.degree += 1;
        links.push({ source: a.id, target: b.id });
      }
    }
    return { nodes: [...nodes.values()], links };
  }
}
