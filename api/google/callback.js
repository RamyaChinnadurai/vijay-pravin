// GET /api/google/callback?code=...&state=...
// Exchanges the consent code, checks the account and scopes, and saves the refresh token
// in the token store. The page only ever says whether it worked; the token is never shown or logged.

const { hasClientCredentials, TOKEN_URL } = require("../_lib/google");
const { tokenStore } = require("../_lib/http");
const {
  CALENDAR_SCOPES, STATE_COOKIE, verifyState, redirectUri, accountEmail, readCookie, stateCookie, idTokenEmail, sendPage,
} = require("../_lib/oauth");

const START_AGAIN = "Please open your connect link again to retry.";

const createCallbackHandler = ({ env = process.env, store = tokenStore, fetchImpl = fetch, now = Date.now } = {}) => async (req, res) => {
  if (!env.CONNECT_KEY) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.end("Not found");
  }
  const clear = stateCookie("", 0);
  const page = (status, title, message, ok = false) => sendPage(res, status, { title, message, ok, cookie: clear });

  if (req.method !== "GET") return page(405, "Not connected", START_AGAIN);
  const q = new URL(req.url, "http://localhost").searchParams;

  const nonce = verifyState(env.CONNECT_KEY, q.get("state"), now());
  const cookieNonce = readCookie(req, STATE_COOKIE);
  if (!nonce || !cookieNonce || nonce !== cookieNonce) {
    return page(400, "Link expired", `This sign-in link is no longer valid. ${START_AGAIN}`);
  }
  if (q.get("error")) {
    return page(400, "Not connected", `Google didn't grant access, so nothing was saved. ${START_AGAIN}`);
  }
  if (!q.get("code") || !hasClientCredentials(env) || !store.isAvailable()) {
    return page(400, "Not connected", `Something was missing, so nothing was saved. ${START_AGAIN}`);
  }

  let tokens;
  try {
    const r = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: q.get("code"),
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri(env),
        grant_type: "authorization_code",
      }),
    });
    tokens = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`google-callback: code exchange failed (${r.status} ${String(tokens.error || "").slice(0, 40)})`);
      return page(502, "Not connected", `Google didn't accept the sign-in. ${START_AGAIN}`);
    }
  } catch (err) {
    console.error("google-callback: code exchange failed:", err.message);
    return page(502, "Not connected", `Couldn't reach Google. ${START_AGAIN}`);
  }

  const expected = accountEmail(env);
  const email = idTokenEmail(tokens.id_token);
  if (email !== expected) {
    return page(403, "Wrong Google account", `Please sign in with ${expected}. Nothing was saved. ${START_AGAIN}`);
  }
  const granted = String(tokens.scope || "").split(/\s+/);
  if (!CALENDAR_SCOPES.every((s) => granted.includes(s))) {
    return page(400, "Calendar access missing", `Please tick both calendar permissions on Google's consent screen. Nothing was saved. ${START_AGAIN}`);
  }
  if (!tokens.refresh_token) {
    return page(502, "Not connected", `Google didn't return long-lived access. ${START_AGAIN}`);
  }

  try {
    await store.write({ refreshToken: tokens.refresh_token, scope: CALENDAR_SCOPES.join(" ") });
  } catch (err) {
    console.error("google-callback: saving the token failed:", err.message);
    return page(500, "Not connected", `Google said yes, but saving the connection failed. ${START_AGAIN}`);
  }

  const note = env.GOOGLE_REFRESH_TOKEN
    ? " Note: a GOOGLE_REFRESH_TOKEN env var is also set and still takes priority; remove it to use this connection."
    : " The booking page switches to your real availability within a minute.";
  return page(200, "Calendar connected", `${expected} is now connected to vijaypravin.com/calendar.${note}`, true);
};

module.exports = createCallbackHandler();
module.exports.createCallbackHandler = createCallbackHandler;
