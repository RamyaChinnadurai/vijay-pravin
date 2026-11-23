// Minimal Google Calendar client over fetch, authorised with Vijay's stored OAuth refresh token.
// Credentials are read from the environment at call time and never logged or returned.

const crypto = require("crypto");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

class GoogleError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const isConfigured = (env = process.env) =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);

const createGoogleCalendar = ({ env = process.env, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) => {
  const calendarId = env.GOOGLE_CALENDAR_ID || "primary";
  let cached = null;

  const accessToken = async () => {
    if (cached && cached.expires > Date.now() + 60_000) return cached.token;
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new GoogleError(`token refresh failed (${res.status})`, res.status);
    const body = await res.json();
    cached = { token: body.access_token, expires: Date.now() + (body.expires_in || 3600) * 1000 };
    return cached.token;
  };

  const call = async (method, path, { query, body } = {}) => {
    const url = `${API}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
    const res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new GoogleError(`${method} ${path.split("?")[0]} failed (${res.status})`, res.status);
    return res.status === 204 ? null : res.json();
  };

  const cal = encodeURIComponent(calendarId);

  // Busy intervals only; free/busy never exposes titles or attendees.
  const freeBusy = async (fromMs, toMs) => {
    const body = await call("POST", "/freeBusy", {
      body: { timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(), items: [{ id: calendarId }] },
    });
    const entry = body.calendars && body.calendars[calendarId];
    if (!entry || (entry.errors && entry.errors.length)) throw new GoogleError("free/busy lookup failed", 502);
    return entry.busy.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
  };

  const meetUrl = (event) =>
    event.hangoutLink ||
    ((event.conferenceData && event.conferenceData.entryPoints) || []).find((e) => e.entryPointType === "video")?.uri ||
    null;

  const createEvent = async (event) => {
    let created = await call("POST", `/calendars/${cal}/events`, {
      query: { conferenceDataVersion: "1", sendUpdates: "all" },
      body: {
        ...event,
        conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
      },
    });
    // Meet creation is usually synchronous but may report "pending"; poll briefly.
    for (let i = 0; i < 3 && !meetUrl(created) && created.conferenceData?.createRequest?.status?.statusCode === "pending"; i++) {
      await sleep(700);
      created = await call("GET", `/calendars/${cal}/events/${encodeURIComponent(created.id)}`);
    }
    return { id: created.id, htmlLink: created.htmlLink, meetUrl: meetUrl(created), organizer: created.organizer?.email };
  };

  return { calendarId, freeBusy, createEvent };
};

module.exports = { isConfigured, createGoogleCalendar, GoogleError };
