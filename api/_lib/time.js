// Time-zone helpers built on Intl, so the functions need no date library.

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const formatters = new Map();
const partsFormatter = (timeZone) => {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }));
  }
  return formatters.get(timeZone);
};

const isValidTimeZone = (timeZone) => {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
};

// Wall-clock fields of an instant in a time zone.
const zonedParts = (ms, timeZone) => {
  const p = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(new Date(ms))) p[type] = value;
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second };
};

const offsetMs = (ms, timeZone) => {
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};

// UTC instant for a wall-clock time in a time zone. Times skipped by a DST jump resolve forward.
const zonedToUtc = (year, month, day, hour, minute, timeZone) => {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall - offsetMs(wall, timeZone);
  guess = wall - offsetMs(guess, timeZone);
  return guess;
};

const parseDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const [year, month, day] = [+m[1], +m[2], +m[3]];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
};

const pad = (n) => String(n).padStart(2, "0");
const formatDate = ({ year, month, day }) => `${year}-${pad(month)}-${pad(day)}`;

const addDays = ({ year, month, day }, n) => {
  const d = new Date(Date.UTC(year, month - 1, day) + n * DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

// 1 = Monday ... 7 = Sunday
const isoWeekday = ({ year, month, day }) => new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;

const daysBetween = (a, b) =>
  Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY);

const localDate = (ms, timeZone) => formatDate(zonedParts(ms, timeZone));

module.exports = {
  MINUTE, DAY, isValidTimeZone, zonedParts, zonedToUtc, parseDate, formatDate, addDays, isoWeekday, daysBetween, localDate,
};
