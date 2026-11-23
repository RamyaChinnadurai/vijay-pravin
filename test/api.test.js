const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createSlotsHandler } = require("../api/slots");
const { createBookHandler } = require("../api/book");
const { createGoogleCalendar } = require("../api/_lib/google");
const { createMockCalendar } = require("../api/_lib/mock");
const { publicEventTypes } = require("../api/_lib/config");
const { zonedToUtc } = require("../api/_lib/time");

const berlin = (y, mo, d, h, mi) => zonedToUtc(y, mo, d, h, mi, "Europe/Berlin");
const NOW = berlin(2026, 11, 23, 15, 0); // Monday afternoon
const iso = (ms) => new Date(ms).toISOString();

const call = async (handler, { method = "GET", url = "/", body, ip = "1.2.3.4" } = {}) => {
  const req = { method, url, body, headers: { "x-forwarded-for": ip }, socket: {} };
  const res = {
    statusCode: 200, headers: {}, payload: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.payload = s; },
  };
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.payload) };
};

const fakeCalendar = (busy = []) => {
  const created = [];
  return {
    created,
    calendarId: "vijay@example.com",
    freeBusy: async (from, to) => busy.filter((b) => b.start < to && b.end > from),
    createEvent: async (event) => {
      created.push(event);
      return { id: "evt1", meetUrl: "https://meet.google.com/abc-defg-hij" };
    },
  };
};

const booking = (overrides = {}) => ({
  eventType: "30min", start: iso(berlin(2026, 11, 24, 10, 0)), name: "Ada Lovelace", email: "ada@example.com", ...overrides,
});

test("GET /api/slots returns only bookable starts", async () => {
  const cal = fakeCalendar([{ start: berlin(2026, 11, 24, 10, 0), end: berlin(2026, 11, 24, 11, 0) }]);
  const handler = createSlotsHandler({ now: () => NOW, getCalendar: () => ({ mode: "google", calendar: cal }) });
  const { status, json } = await call(handler, { url: "/api/slots?eventType=30min&start=2026-11-23&end=2026-11-29&timeZone=Europe/Berlin" });
  assert.equal(status, 200);
  assert.equal(json.mode, "google");
  // Monday 23rd: now 15:00 + 2h notice -> first slot 17:00, last 17:30.
  assert.deepEqual(json.slots["2026-11-23"], [iso(berlin(2026, 11, 23, 17, 0)), iso(berlin(2026, 11, 23, 17, 30))]);
  const tue = json.slots["2026-11-24"];
  assert.ok(!tue.includes(iso(berlin(2026, 11, 24, 10, 0))));
  assert.ok(!tue.includes(iso(berlin(2026, 11, 24, 10, 30))));
  assert.ok(tue.includes(iso(berlin(2026, 11, 24, 11, 0))));
  assert.equal(json.slots["2026-11-29"], undefined); // Sunday closed
  assert.equal(JSON.stringify(json).includes("busy"), false);
});

test("GET /api/slots validates input", async () => {
  const handler = createSlotsHandler({ now: () => NOW, getCalendar: () => ({ mode: "mock", calendar: createMockCalendar() }) });
  assert.equal((await call(handler, { url: "/api/slots?eventType=nope" })).status, 400);
  assert.equal((await call(handler, { url: "/api/slots?eventType=15min&timeZone=Mars/Base" })).status, 400);
  assert.equal((await call(handler, { url: "/api/slots?eventType=15min&start=2026-11-01&end=2027-02-01" })).status, 400);
  assert.equal((await call(handler, { method: "POST", url: "/api/slots?eventType=15min" })).status, 405);
});

test("GET /api/slots falls back to mock free/busy without credentials", async () => {
  const handler = createSlotsHandler({ now: () => NOW });
  const { status, json } = await call(handler, { url: "/api/slots?eventType=15min&start=2026-11-24&end=2026-11-24&timeZone=Europe/Berlin" });
  assert.equal(status, 200);
  assert.equal(json.mode, "mock");
  assert.ok(!json.slots["2026-11-24"].includes(iso(berlin(2026, 11, 24, 12, 30)))); // mock lunch block
});

test("POST /api/book creates a Meet event and invites guest and host", async () => {
  const cal = fakeCalendar();
  const handler = createBookHandler({
    now: () => NOW, env: { HOST_EMAIL: "hello@vijaypravin.com" }, getCalendar: () => ({ mode: "google", calendar: cal }),
  });
  const { status, json } = await call(handler, { method: "POST", body: booking({ notes: "Hi", guests: "bob@example.com, ADA@example.com" }) });
  assert.equal(status, 200);
  assert.equal(json.booking.meetUrl, "https://meet.google.com/abc-defg-hij");
  assert.equal(json.booking.end, iso(berlin(2026, 11, 24, 10, 30)));
  const event = cal.created[0];
  assert.deepEqual(event.attendees.map((a) => a.email), ["ada@example.com", "bob@example.com", "hello@vijaypravin.com"]);
  assert.match(event.description, /Additional notes:\nHi/);
});

test("POST /api/book does not re-invite the host when the host owns the calendar", async () => {
  const cal = { ...fakeCalendar(), calendarId: "hello@vijaypravin.com" };
  cal.created = [];
  cal.createEvent = async (e) => (cal.created.push(e), { id: "x", meetUrl: "https://meet.google.com/x" });
  const handler = createBookHandler({ now: () => NOW, env: { HOST_EMAIL: "hello@vijaypravin.com" }, getCalendar: () => ({ mode: "google", calendar: cal }) });
  assert.equal((await call(handler, { method: "POST", body: booking() })).status, 200);
  assert.deepEqual(cal.created[0].attendees.map((a) => a.email), ["ada@example.com"]);
});

test("POST /api/book rejects a conflicting slot with 409 and creates nothing", async () => {
  const cal = fakeCalendar([{ start: berlin(2026, 11, 24, 10, 15), end: berlin(2026, 11, 24, 10, 45) }]);
  const handler = createBookHandler({ now: () => NOW, env: {}, getCalendar: () => ({ mode: "google", calendar: cal }) });
  const { status, json } = await call(handler, { method: "POST", body: booking() });
  assert.equal(status, 409);
  assert.equal(json.error, "slot_unavailable");
  assert.equal(cal.created.length, 0);
});

test("POST /api/book rejects a stale slot inside the notice window with 409", async () => {
  const cal = fakeCalendar();
  const handler = createBookHandler({ now: () => berlin(2026, 11, 24, 8, 30), env: {}, getCalendar: () => ({ mode: "google", calendar: cal }) });
  const { status } = await call(handler, { method: "POST", body: booking() });
  assert.equal(status, 409);
  assert.equal(cal.created.length, 0);
});

test("POST /api/book rejects a second booking of the same mock slot with 409", async () => {
  const mock = createMockCalendar();
  const handler = createBookHandler({ now: () => NOW, env: { BOOKING_MOCK: "1" }, getCalendar: () => ({ mode: "mock", calendar: mock }) });
  const body = booking({ start: iso(berlin(2026, 11, 24, 17, 0)) });
  assert.equal((await call(handler, { method: "POST", body })).status, 200);
  assert.equal((await call(handler, { method: "POST", body: { ...body, email: "other@example.com" } })).status, 409);
});

test("POST /api/book validates input", async () => {
  const handler = createBookHandler({
    now: () => NOW, env: {}, rateLimit: () => true, getCalendar: () => ({ mode: "google", calendar: fakeCalendar() }),
  });
  const post = (body) => call(handler, { method: "POST", body });
  assert.equal((await post(booking({ email: "not-an-email" }))).json.error, "invalid_email");
  assert.equal((await post(booking({ name: "  " }))).json.error, "invalid_name");
  assert.equal((await post(booking({ eventType: "2h" }))).json.error, "invalid_event_type");
  assert.equal((await post(booking({ start: iso(berlin(2026, 11, 24, 10, 10)) }))).json.error, "invalid_slot"); // off-grid
  assert.equal((await post(booking({ start: iso(berlin(2026, 11, 29, 10, 0)) }))).json.error, "invalid_slot"); // Sunday
  assert.equal((await post(booking({ guests: "bad@" }))).json.error, "invalid_guests");
  assert.equal((await post(booking({ website: "spam" }))).status, 400);
  assert.equal((await call(handler, { method: "GET" })).status, 405);
});

test("POST /api/book returns 503 when Google is not configured", async () => {
  const handler = createBookHandler({ now: () => NOW, env: {}, getCalendar: () => ({ mode: "mock", calendar: createMockCalendar() }) });
  const { status, json } = await call(handler, { method: "POST", body: booking() });
  assert.equal(status, 503);
  assert.equal(json.error, "booking_not_configured");
});

test("POST /api/book rate-limits repeated attempts", async () => {
  const handler = createBookHandler({ now: () => NOW, env: {}, getCalendar: () => ({ mode: "google", calendar: fakeCalendar() }) });
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await call(handler, { method: "POST", body: booking({ email: "x" }), ip: "9.9.9.9" })).status);
  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
});

test("Google client sends a Meet request with sendUpdates=all and never exposes tokens", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    if (url.includes("oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    if (url.includes("/freeBusy")) {
      return { ok: true, status: 200, json: async () => ({ calendars: { primary: { busy: [{ start: "2026-11-24T09:00:00Z", end: "2026-11-24T10:00:00Z" }] } } }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: "e1", hangoutLink: "https://meet.google.com/aaa-bbbb-ccc", organizer: { email: "v@example.com" } }) };
  };
  const env = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_REFRESH_TOKEN: "refresh" };
  const g = createGoogleCalendar({ env, fetchImpl });
  assert.deepEqual(await g.freeBusy(0, 1), [{ start: Date.parse("2026-11-24T09:00:00Z"), end: Date.parse("2026-11-24T10:00:00Z") }]);
  const out = await g.createEvent({ summary: "s", start: {}, end: {}, attendees: [] });
  assert.equal(out.meetUrl, "https://meet.google.com/aaa-bbbb-ccc");
  const insert = requests.find((r) => r.url.includes("/events"));
  assert.match(insert.url, /conferenceDataVersion=1/);
  assert.match(insert.url, /sendUpdates=all/);
  assert.equal(JSON.parse(insert.init.body).conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
  assert.equal(requests.filter((r) => r.url.includes("oauth2")).length, 1); // token cached
  assert.equal(JSON.stringify(out).includes("tok"), false);
});

test("calendar.html lists exactly the configured event types", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "calendar.html"), "utf8");
  const slugs = [...html.matchAll(/data-event-type="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(slugs, publicEventTypes().map((e) => e.slug));
  for (const e of publicEventTypes()) {
    assert.ok(html.includes(`data-length="${e.length}"`), `${e.slug} length`);
    assert.ok(html.includes(`data-notes-label="${e.notesLabel}"`), `${e.slug} notes label`);
  }
});

test("vercel.json keeps cleanUrls", () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.equal(cfg.cleanUrls, true);
});
