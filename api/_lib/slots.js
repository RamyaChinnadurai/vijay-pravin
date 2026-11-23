const { HOST, RULES, WORKING_HOURS } = require("./config");
const { MINUTE, zonedToUtc, parseDate, addDays, isoWeekday, daysBetween, localDate } = require("./time");

const hm = (s) => s.split(":").map(Number);

// Every slot start inside working hours within [fromMs, toMs), ignoring notice and busy time.
// Starts step by the event length from each window start; the meeting must end by the window end.
const candidateStarts = (eventType, fromMs, toMs, { workingHours = WORKING_HOURS, timeZone = HOST.timeZone } = {}) => {
  const lengthMs = eventType.length * MINUTE;
  const first = parseDate(localDate(fromMs, timeZone));
  const last = parseDate(localDate(toMs - 1, timeZone));
  const starts = [];
  for (let i = 0, n = daysBetween(first, last); i <= n; i++) {
    const date = addDays(first, i);
    for (const win of workingHours[isoWeekday(date)] || []) {
      const [sh, sm] = hm(win.start);
      const [eh, em] = hm(win.end);
      const winStart = zonedToUtc(date.year, date.month, date.day, sh, sm, timeZone);
      const winEnd = zonedToUtc(date.year, date.month, date.day, eh, em, timeZone);
      for (let t = winStart; t + lengthMs <= winEnd; t += lengthMs) {
        if (t >= fromMs && t < toMs) starts.push(t);
      }
    }
  }
  return starts;
};

const overlapsBusy = (startMs, endMs, busy) => busy.some((b) => startMs < b.end && endMs > b.start);

// Why a candidate start can't be booked, or null if it can.
const unavailableReason = (eventType, startMs, { now, busy, rules = RULES }) => {
  if (startMs < now + rules.minimumNoticeMinutes * MINUTE) return "notice";
  const endMs = startMs + eventType.length * MINUTE;
  const padded = [startMs - rules.bufferBeforeMinutes * MINUTE, endMs + rules.bufferAfterMinutes * MINUTE];
  if (overlapsBusy(padded[0], padded[1], busy)) return "busy";
  return null;
};

// Bookable starts in [fromMs, toMs): working hours minus notice window minus busy blocks.
// `busy` is a list of { start, end } in epoch ms.
const bookableStarts = (eventType, fromMs, toMs, { now, busy = [], rules = RULES, workingHours, timeZone } = {}) =>
  candidateStarts(eventType, fromMs, toMs, { workingHours, timeZone })
    .filter((t) => !unavailableReason(eventType, t, { now, busy, rules }));

// { "YYYY-MM-DD": [ISO strings] } keyed by the guest's local date.
const groupByDate = (starts, timeZone) => {
  const out = {};
  for (const t of starts) (out[localDate(t, timeZone)] ||= []).push(new Date(t).toISOString());
  return out;
};

module.exports = { candidateStarts, bookableStarts, unavailableReason, groupByDate };
