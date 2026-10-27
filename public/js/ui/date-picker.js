// A month calendar in a popover, for opening any day's note or inserting a date link.

import { addDays, MONTH_NAMES, startOfDay } from '../core/dates.js';
import { clear, h, icon } from './dom.js';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export class DatePicker {
  constructor() {
    this.element = h('div', { class: 'popover date-picker', role: 'dialog', 'aria-label': 'Choose a date', hidden: true });
    this.element.addEventListener('mousedown', (event) => {
      if (!event.target.closest('button')) event.preventDefault();
    });
    this.month = startOfDay(new Date());
    this.onPick = null;
    this.outside = (event) => {
      if (!this.element.contains(event.target)) this.close();
    };
    this.keys = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
    };
    document.body.append(this.element);
  }

  /**
   * @param {{anchor: {left: number, top?: number, bottom: number}, onPick: (date: Date) => void}} options
   */
  open({ anchor, onPick }) {
    this.onPick = onPick;
    const today = startOfDay(new Date());
    this.month = new Date(today.getFullYear(), today.getMonth(), 1);
    this.render();
    this.element.hidden = false;
    this.element.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - this.element.offsetWidth - 8))}px`;
    const below = anchor.bottom + 6;
    this.element.style.top = `${below + this.element.offsetHeight > window.innerHeight - 8 ? Math.max(8, (anchor.top ?? anchor.bottom) - this.element.offsetHeight - 6) : below}px`;
    setTimeout(() => {
      document.addEventListener('pointerdown', this.outside, true);
      document.addEventListener('keydown', this.keys, true);
    }, 0);
    this.element.querySelector('.day.today')?.focus();
  }

  close() {
    this.element.hidden = true;
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('keydown', this.keys, true);
  }

  render() {
    const year = this.month.getFullYear();
    const month = this.month.getMonth();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7; // weeks start on Monday
    const today = startOfDay(new Date()).getTime();
    const days = [];
    for (let i = 0; i < 42; i += 1) {
      const date = addDays(first, i - offset);
      days.push(h('button', {
        type: 'button',
        class: ['day', date.getMonth() !== month && 'other', date.getTime() === today && 'today'],
        'aria-label': date.toDateString(),
        onclick: () => {
          const pick = this.onPick;
          this.close();
          pick?.(date);
        },
      }, String(date.getDate())));
    }
    const shift = (delta) => {
      this.month = new Date(year, month + delta, 1);
      this.render();
    };
    clear(this.element).append(
      h('div', { class: 'dp-head' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shift(-1) }, icon('back')),
        h('span', { class: 'dp-title' }, `${MONTH_NAMES[month]} ${year}`),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next month', onclick: () => shift(1) }, icon('chevron'))),
      h('div', { class: 'dp-grid' }, WEEKDAYS.map((day) => h('span', { class: 'dp-weekday' }, day)), days),
      h('button', {
        type: 'button',
        class: 'text-btn dp-today',
        onclick: () => {
          const pick = this.onPick;
          this.close();
          pick?.(startOfDay(new Date()));
        },
      }, 'Today'));
  }
}
