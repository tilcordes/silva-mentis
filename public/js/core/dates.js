// Daily note titles: "October 20th, 2026". A page is a daily page exactly when
// its title parses as such a date, so formatting and parsing must agree to the character.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const DAILY_PATTERN = new RegExp(`^(${MONTHS.join('|')}) ([1-9]|[12][0-9]|3[01])(st|nd|rd|th), ([0-9]{4})$`);

/**
 * The English ordinal suffix of a day of the month: 1st, 2nd, 3rd, 4th, 11th, 21st…
 * @param {number} day
 * @returns {string}
 */
export function ordinalSuffix(day) {
  if (day >= 11 && day <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th';
}

/**
 * @param {Date} date
 * @returns {string} e.g. "October 20th, 2026"
 */
export function formatDailyTitle(date) {
  const day = date.getDate();
  return `${MONTHS[date.getMonth()]} ${day}${ordinalSuffix(day)}, ${date.getFullYear()}`;
}

/**
 * Parses a daily title strictly. "October 20th, 2026" works; "October 20, 2026",
 * "october 20th, 2026", "February 30th, 2026" and "October 21th, 2026" do not.
 * @param {string} title
 * @returns {Date|null} local midnight of that day
 */
export function parseDailyTitle(title) {
  const match = DAILY_PATTERN.exec(title);
  if (!match) return null;
  const [, monthName, dayText, suffix, yearText] = match;
  const day = Number(dayText);
  if (ordinalSuffix(day) !== suffix) return null;
  const month = MONTHS.indexOf(monthName);
  const date = new Date(Number(yearText), month, day);
  if (date.getMonth() !== month) return null; // February 30th rolls over into March
  return date;
}

/**
 * @param {string} title
 * @returns {boolean}
 */
export function isDailyTitle(title) {
  return parseDailyTitle(title) !== null;
}

/**
 * A sortable key for a day: "2026-10-20".
 * @param {Date} date
 * @returns {string}
 */
export function dateKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * @param {Date} date
 * @returns {Date} local midnight of the same day
 */
export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Calendar arithmetic that survives daylight-saving changes (adds days, not hours).
 * @param {Date} date
 * @param {number} days may be negative
 * @returns {Date} local midnight
 */
export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Month names, for the date picker. */
export const MONTH_NAMES = MONTHS;
