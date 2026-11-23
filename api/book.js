// POST /api/book  { eventType, start, name, email, notes?, guests?, timeZone? }
// Re-checks free/busy, then creates the event with a Google Meet link and invites the guest.

const { HOST, EVENT_TYPES, RULES } = require("./_lib/config");
const { candidateStarts, unavailableReason } = require("./_lib/slots");
const { MINUTE, isValidTimeZone } = require("./_lib/time");
const { send, fail, resolveCalendar, clientIp, createRateLimiter, readJson } = require("./_lib/http");

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
const isEmail = (s) => typeof s === "string" && s.length <= 254 && EMAIL.test(s);
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const parseGuests = (v) => {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,;]+/) : [];
  return [...new Set(list.map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
};

const createBookHandler = ({
  now = Date.now,
  getCalendar = resolveCalendar,
  env = process.env,
  rateLimit = createRateLimiter({ limit: 5, windowMs: 10 * 60 * 1000 }),
} = {}) => {
  const inFlight = new Set();

  return async (req, res) => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return fail(res, 405, "method_not_allowed", "Use POST.");
    }
    if (!rateLimit(clientIp(req))) return fail(res, 429, "rate_limited", "Too many booking attempts. Please try again later.");

    let body;
    try {
      body = await readJson(req);
    } catch {
      return fail(res, 400, "invalid_json", "Request body must be JSON.");
    }
    if (!body || typeof body !== "object") return fail(res, 400, "invalid_json", "Request body must be JSON.");
    if (body.website) return fail(res, 400, "invalid_request", "Invalid request."); // honeypot

    const eventType = EVENT_TYPES[body.eventType];
    if (!eventType) return fail(res, 400, "invalid_event_type", "Unknown eventType.");
    const name = text(body.name, 100);
    if (!name) return fail(res, 400, "invalid_name", "Please enter your name.");
    const email = text(body.email, 254).toLowerCase();
    if (!isEmail(email)) return fail(res, 400, "invalid_email", "Please enter a valid email address.");
    const notes = text(body.notes, 2000);
    const guests = parseGuests(body.guests).filter((g) => g !== email);
    if (guests.length > RULES.maxGuests) return fail(res, 400, "invalid_guests", `At most ${RULES.maxGuests} extra guests.`);
    if (!guests.every(isEmail)) return fail(res, 400, "invalid_guests", "One of the guest emails is not valid.");
    const guestTimeZone = isValidTimeZone(body.timeZone) ? body.timeZone : HOST.timeZone;

    const startMs = typeof body.start === "string" ? Date.parse(body.start) : NaN;
    if (!Number.isFinite(startMs)) return fail(res, 400, "invalid_slot", "start must be an ISO timestamp.");
    const endMs = startMs + eventType.length * MINUTE;
    if (!candidateStarts(eventType, startMs, startMs + 1).includes(startMs)) {
      return fail(res, 400, "invalid_slot", "That time is outside Vijay's booking hours.");
    }

    const { mode, calendar } = getCalendar();
    if (mode === "mock" && env.BOOKING_MOCK !== "1") {
      return fail(res, 503, "booking_not_configured", "Online booking isn't connected yet. Please email hello@vijaypravin.com.");
    }

    const lockKey = `${startMs}`;
    if (inFlight.has(lockKey)) return fail(res, 409, "slot_unavailable", "That time was just taken. Please pick another slot.");
    inFlight.add(lockKey);
    try {
      let busy;
      try {
        busy = await calendar.freeBusy(startMs - RULES.bufferBeforeMinutes * MINUTE, endMs + RULES.bufferAfterMinutes * MINUTE);
      } catch (err) {
        console.error("book: free/busy failed:", err.message);
        return fail(res, 502, "calendar_unavailable", "Could not check availability. Please try again shortly.");
      }
      if (unavailableReason(eventType, startMs, { now: now(), busy })) {
        return fail(res, 409, "slot_unavailable", "That time is no longer available. Please pick another slot.");
      }

      const hostEmail = text(env.HOST_EMAIL, 254).toLowerCase();
      const attendees = [{ email, displayName: name }, ...guests.map((g) => ({ email: g }))];
      // The OAuth account is the organizer; invite the public host address too unless it is that calendar.
      if (isEmail(hostEmail) && hostEmail !== String(calendar.calendarId).toLowerCase() && !attendees.some((a) => a.email === hostEmail)) {
        attendees.push({ email: hostEmail });
      }

      const description = [
        `${eventType.title} booked via vijaypravin.com/calendar`,
        `Guest: ${name} <${email}>`,
        `Guest time zone: ${guestTimeZone}`,
        notes && `\n${eventType.notesLabel}:\n${notes}`,
      ].filter(Boolean).join("\n");

      let created;
      try {
        created = await calendar.createEvent({
          summary: `${eventType.title} between ${HOST.name} and ${name}`,
          description,
          start: { dateTime: new Date(startMs).toISOString(), timeZone: HOST.timeZone },
          end: { dateTime: new Date(endMs).toISOString(), timeZone: HOST.timeZone },
          attendees,
          guestsCanModify: false,
          reminders: { useDefault: true },
          extendedProperties: { private: { source: "vijaypravin.com/calendar", eventType: eventType.slug } },
        });
      } catch (err) {
        console.error("book: event insert failed:", err.message);
        return fail(res, 502, "calendar_unavailable", "Could not create the booking. Please try again shortly.");
      }

      return send(res, 200, {
        ok: true,
        mode,
        booking: {
          id: created.id,
          eventType: eventType.slug,
          title: eventType.title,
          start: new Date(startMs).toISOString(),
          end: new Date(endMs).toISOString(),
          meetUrl: created.meetUrl,
          name,
          email,
          guests,
        },
      });
    } finally {
      inFlight.delete(lockKey);
    }
  };
};

module.exports = createBookHandler();
module.exports.createBookHandler = createBookHandler;
