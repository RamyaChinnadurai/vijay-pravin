const { isConfigured, createGoogleCalendar } = require("./google");
const { createMockCalendar } = require("./mock");

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

const fail = (res, status, error, message) => send(res, status, { error, message });

// One calendar per warm instance: the real one when credentials exist, otherwise the mock.
let current = null;
const resolveCalendar = (env = process.env) => {
  const mode = isConfigured(env) ? "google" : "mock";
  if (!current || current.mode !== mode) {
    current = { mode, calendar: mode === "google" ? createGoogleCalendar({ env }) : createMockCalendar() };
  }
  return current;
};

const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";

// Fixed-window limiter per warm instance. Best effort only: instances don't share memory.
const createRateLimiter = ({ limit, windowMs, now = Date.now }) => {
  const hits = new Map();
  return (key) => {
    const t = now();
    const entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      if (hits.size > 5000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
};

const readJson = async (req) => {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
};

module.exports = { send, fail, resolveCalendar, clientIp, createRateLimiter, readJson };
