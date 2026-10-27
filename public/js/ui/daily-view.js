// The daily notes stream: today first (with its linked references open, so tasks filed under
// this date resurface), then every earlier day that has content, newest first, loaded in
// batches while scrolling. Phones get a capture field to add a bullet to today quickly.

import { addDays, formatDailyTitle, parseDailyTitle, startOfDay } from '../core/dates.js';
import { createBlock } from '../core/outline.js';
import { h, icon } from './dom.js';
import { PageView } from './page-view.js';

const BATCH = 7;

export class DailyView {
  /** @param {object} app */
  constructor(app) {
    this.app = app;
    this.today = startOfDay(new Date());
    this.todayTitle = formatDailyTitle(this.today);
    this.todayId = app.store.idForTitle(this.todayTitle);
    this.pageViews = [];
    this.list = h('div', { class: 'daily-list' });
    this.sentinel = h('div', { class: 'daily-more', 'aria-hidden': 'true' });
    this.element = h('div', { class: 'daily' }, this.list, this.sentinel, this.captureForm());

    this.pastDays = this.findPastDays();
    this.shown = 0;
    this.addDay(this.todayId, 'expanded');
    this.loadMore();
    this.observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) this.loadMore();
    }, { rootMargin: '600px' });
    this.observer.observe(this.sentinel);
  }

  /** Daily pages before today that have something in them, newest first. */
  findPastDays() {
    const days = [];
    for (const page of this.app.store.index.pages.values()) {
      const date = parseDailyTitle(page.title);
      if (!date || date >= this.today) continue;
      if (!page.blocks.some((block) => block.text.trim() !== '' || block.children.length)) continue;
      days.push({ id: page.id, time: date.getTime() });
    }
    return days.sort((a, b) => b.time - a.time);
  }

  addDay(pageId, references) {
    const view = new PageView(this.app, pageId, { references, titleLevel: 'h1' });
    view.element.classList.add('day');
    this.pageViews.push(view);
    this.list.append(view.element);
  }

  loadMore() {
    const next = this.pastDays.slice(this.shown, this.shown + BATCH);
    this.shown += next.length;
    for (const day of next) this.addDay(day.id, 'collapsed');
    this.sentinel.hidden = this.shown >= this.pastDays.length;
  }

  /** Puts the caret into today's first bullet (keyboard users start typing right away). */
  focusToday() {
    const outline = this.pageViews[0].outline;
    const first = outline.visibleIds()[0];
    if (first) this.app.editor.open(outline, first);
    else outline.startWriting();
  }

  /** Whether the day changed since the stream was built (e.g. the laptop slept overnight). */
  isStale() {
    return startOfDay(new Date()).getTime() !== this.today.getTime();
  }

  captureForm() {
    const input = h('input', { class: 'input', type: 'text', placeholder: 'Add to today…', 'aria-label': 'Add a bullet to today', enterkeyhint: 'send' });
    const form = h('form', { class: 'capture' },
      input,
      h('button', { class: 'round-btn', type: 'submit', 'aria-label': 'Add' }, icon('send')));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      this.app.store.updatePage(this.todayId, (blocks) => {
        const last = blocks[blocks.length - 1];
        if (last && last.text === '' && last.children.length === 0) last.text = text;
        else blocks.push(createBlock(text));
      }, { origin: 'edit' });
      input.value = '';
    });
    return form;
  }

  destroy() {
    this.observer.disconnect();
    for (const view of this.pageViews) view.destroy();
  }
}

/** Title of the day `offset` days from today (used by the date navigation). */
export function dailyTitleFromToday(offset) {
  return formatDailyTitle(addDays(new Date(), offset));
}
