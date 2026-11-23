// One-click Google consent for /api/google/connect and /api/google/callback.
// CONNECT_KEY gates the flow and signs the OAuth state; a matching cookie binds it to the browser.

const crypto = require("crypto");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REDIRECT_URI = "https://www.vijaypravin.com/api/google/callback";
const ACCOUNT_EMAIL = "hello@vijaypravin.com";
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];
// openid + email only let the callback confirm which account consented.
const SCOPES = ["openid", "email", ...CALENDAR_SCOPES];
const STATE_COOKIE = "__Host-gcal_state";
const STATE_TTL_MS = 10 * 60 * 1000;

const redirectUri = (env = process.env) => env.GOOGLE_REDIRECT_URI || REDIRECT_URI;
const accountEmail = (env = process.env) => (env.GOOGLE_ACCOUNT_EMAIL || ACCOUNT_EMAIL).toLowerCase();

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sign = (key, payload) => crypto.createHmac("sha256", key).update(`google-oauth-state.${payload}`).digest();

// Constant-time comparison of two strings of any length.
const safeEqual = (a, b) => {
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

const createState = (key, now = Date.now()) => {
  const nonce = b64url(crypto.randomBytes(24));
  const payload = b64url(JSON.stringify({ n: nonce, exp: now + STATE_TTL_MS }));
  return { nonce, state: `${payload}.${b64url(sign(key, payload))}` };
};

// The nonce inside a valid, unexpired state, or null.
const verifyState = (key, state, now = Date.now()) => {
  const [payload, sig] = String(state || "").split(".");
  if (!payload || !sig) return null;
  const expected = sign(key, payload);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const { n, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof n === "string" && typeof exp === "number" && exp > now ? n : null;
  } catch {
    return null;
  }
};

const authUrl = ({ env = process.env, state }) =>
  `${AUTH_URL}?${new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    login_hint: accountEmail(env),
    state,
  })}`;

const readCookie = (req, name) => {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
};

const stateCookie = (value, maxAgeSeconds) =>
  `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;

// Email claim from an ID token received directly from Google's token endpoint over TLS,
// which Google documents as safe to read without verifying the signature.
const idTokenEmail = (idToken) => {
  try {
    const claims = JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString("utf8"));
    return claims.email_verified === false ? null : String(claims.email || "").toLowerCase() || null;
  } catch {
    return null;
  }
};

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Small standalone page in the site's style. Never pass tokens or secrets in.
const sendPage = (res, status, { title, message, ok = false, cookie }) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex");
  if (cookie) res.setHeader("Set-Cookie", cookie);
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(title)} · Vijay Pravin</title>
  <link rel="icon" href="/img/avatar.jpg" type="image/jpeg" />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Baloo+2:wght@600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/calendar.css" />
</head>
<body class="subpage">
  <div class="sky" aria-hidden="true"><span class="cloud c1"></span><span class="cloud c2"></span><span class="cloud c3"></span></div>
  <header class="nav scrolled">
    <div class="container nav-inner">
      <a href="/" class="brand" aria-label="Vijay Pravin, home">
        <img class="avatar" src="/img/avatar.jpg" alt="" width="40" height="40" />
        <span class="brand-name">Vijay Pravin</span>
      </a>
    </div>
  </header>
  <main class="article-wrap">
    <div class="booking container-booking" style="grid-template-columns: 1fr; max-width: 560px;">
      <section class="bk-main bk-done" style="min-height: 0;">
        <img class="bk-avatar" src="/img/avatar.jpg" alt="" width="56" height="56" />
        <h1 class="bk-step-title">${escapeHtml(title)}</h1>
        <p class="bk-done-sub">${escapeHtml(message)}</p>
        ${ok ? '<a class="btn btn-ink" href="/calendar">Open the booking page</a>' : ""}
      </section>
    </div>
  </main>
</body>
</html>
`);
};

module.exports = {
  CALENDAR_SCOPES, SCOPES, STATE_COOKIE, STATE_TTL_MS,
  redirectUri, accountEmail, safeEqual, createState, verifyState, authUrl, readCookie, stateCookie, idTokenEmail, sendPage,
};
