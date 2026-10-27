import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dateKey, formatDailyTitle, isDailyTitle, parseDailyTitle } from '../../public/js/core/dates.js';

test('daily titles with English ordinals', () => {
  const cases = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 11: '11th', 12: '12th', 13: '13th', 21: '21st', 22: '22nd', 23: '23rd', 31: '31st' };
  for (const [day, text] of Object.entries(cases)) {
    assert.equal(formatDailyTitle(new Date(2026, 0, Number(day))), `January ${text}, 2026`);
  }
  assert.equal(formatDailyTitle(new Date(2026, 9, 20)), 'October 20th, 2026');
});

test('strict parsing round-trips and rejects near misses', () => {
  for (let day = 0; day < 400; day += 1) {
    const date = addDays(new Date(2024, 0, 1), day);
    assert.equal(parseDailyTitle(formatDailyTitle(date)).getTime(), date.getTime());
  }
  for (const title of ['October 20, 2026', 'october 20th, 2026', 'October 21th, 2026', 'February 30th, 2026',
    'October 20th 2026', ' October 20th, 2026', 'October 020th, 2026', 'Oct 20th, 2026', 'February 29th, 2026']) {
    assert.equal(isDailyTitle(title), false, title);
  }
  assert.equal(isDailyTitle('February 29th, 2028'), true);
});

test('date keys and day arithmetic across DST changes', () => {
  assert.equal(dateKey(new Date(2026, 2, 5)), '2026-03-05');
  assert.equal(dateKey(addDays(new Date(2026, 2, 28), 2)), '2026-03-30');
  assert.equal(dateKey(addDays(new Date(2026, 9, 24), 3)), '2026-10-27');
});
