// Stand-in calendar used when Google credentials are not configured.
// Busy blocks are deterministic per day so the UI looks realistic; nothing leaves the server.

const { HOST } = require("./config");
const { zonedToUtc, parseDate, addDays, daysBetween, localDate, isoWeekday } = require("./time");

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

const mockBusyForDay = (date) => {
  const at = (h, m) => zonedToUtc(date.year, date.month, date.day, h, m, HOST.timeZone);
  const wd = isoWeekday(date);
  if (wd > 5) return [];
  const h = hash(`${date.year}-${date.month}-${date.day}`);
  const startHour = 10 + (h % 6); // one 1h block between 10:00 and 16:00
  return [
    { start: at(12, 30), end: at(13, 30) },
    { start: at(startHour, 0), end: at(startHour + 1, 0) },
  ];
};

const createMockCalendar = () => {
  const booked = [];

  const freeBusy = async (fromMs, toMs) => {
    const first = parseDate(localDate(fromMs, HOST.timeZone));
    const last = parseDate(localDate(toMs - 1, HOST.timeZone));
    const busy = [...booked];
    for (let i = 0, n = daysBetween(first, last); i <= n; i++) busy.push(...mockBusyForDay(addDays(first, i)));
    return busy.filter((b) => b.start < toMs && b.end > fromMs);
  };

  const createEvent = async (event) => {
    booked.push({ start: Date.parse(event.start.dateTime), end: Date.parse(event.end.dateTime) });
    return { id: `mock-${booked.length}`, htmlLink: null, meetUrl: null, organizer: null };
  };

  return { calendarId: "mock", freeBusy, createEvent };
};

module.exports = { createMockCalendar, mockBusyForDay };
