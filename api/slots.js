// GET /api/slots?eventType=30min&start=2026-11-24&end=2026-11-30&timeZone=Europe/London
// Returns bookable start instants (UTC ISO) grouped by the guest's local date.

const { EVENT_TYPES, RULES } = require("./_lib/config");
const { bookableStarts, groupByDate } = require("./_lib/slots");
const { isValidTimeZone, parseDate, formatDate, addDays, daysBetween, localDate, zonedToUtc } = require("./_lib/time");
const { send, fail, resolveCalendar } = require("./_lib/http");

const createSlotsHandler = ({ now = Date.now, getCalendar = resolveCalendar } = {}) => async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return fail(res, 405, "method_not_allowed", "Use GET.");
  }
  const q = new URL(req.url, "http://localhost").searchParams;
  const eventType = EVENT_TYPES[q.get("eventType")];
  if (!eventType) return fail(res, 400, "invalid_event_type", "Unknown eventType.");
  const timeZone = q.get("timeZone") || "UTC";
  if (!isValidTimeZone(timeZone)) return fail(res, 400, "invalid_time_zone", "Unknown timeZone.");

  const nowMs = now();
  const start = q.get("start") ? parseDate(q.get("start")) : parseDate(localDate(nowMs, timeZone));
  const end = q.get("end") ? parseDate(q.get("end")) : start && addDays(start, 6);
  if (!start || !end) return fail(res, 400, "invalid_range", "start and end must be YYYY-MM-DD.");
  const span = daysBetween(start, end);
  if (span < 0 || span >= RULES.maxRangeDays) {
    return fail(res, 400, "invalid_range", `Range must be 1-${RULES.maxRangeDays} days.`);
  }

  const dayAfter = addDays(end, 1);
  const fromMs = Math.max(zonedToUtc(start.year, start.month, start.day, 0, 0, timeZone), nowMs);
  const toMs = zonedToUtc(dayAfter.year, dayAfter.month, dayAfter.day, 0, 0, timeZone);
  const { mode, calendar } = getCalendar();

  let slots = {};
  if (fromMs < toMs) {
    let busy;
    try {
      busy = await calendar.freeBusy(fromMs, toMs);
    } catch (err) {
      console.error("slots: free/busy failed:", err.message);
      return fail(res, 502, "calendar_unavailable", "Could not load availability. Please try again shortly.");
    }
    slots = groupByDate(bookableStarts(eventType, fromMs, toMs, { now: nowMs, busy }), timeZone);
  }

  return send(res, 200, {
    eventType: eventType.slug,
    length: eventType.length,
    timeZone,
    start: formatDate(start),
    end: formatDate(end),
    mode,
    slots,
  });
};

module.exports = createSlotsHandler();
module.exports.createSlotsHandler = createSlotsHandler;
