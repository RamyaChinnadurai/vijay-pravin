// GET /api/google/connect?key=<CONNECT_KEY>
// Sends Vijay to Google's consent screen. 404 unless CONNECT_KEY is set and matches.

const { hasClientCredentials } = require("../_lib/google");
const { tokenStore } = require("../_lib/http");
const { safeEqual, createState, authUrl, stateCookie, sendPage, STATE_TTL_MS } = require("../_lib/oauth");

const notFound = (res) => {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end("Not found");
};

const createConnectHandler = ({ env = process.env, store = tokenStore, now = Date.now } = {}) => async (req, res) => {
  const key = new URL(req.url, "http://localhost").searchParams.get("key");
  if (!env.CONNECT_KEY || req.method !== "GET" || !key || !safeEqual(key, env.CONNECT_KEY)) return notFound(res);

  if (!hasClientCredentials(env)) {
    return sendPage(res, 503, { title: "Not ready yet", message: "The Google OAuth client isn't configured on the server yet. Nothing was changed." });
  }
  if (!store.isAvailable()) {
    return sendPage(res, 503, { title: "Not ready yet", message: "Token storage isn't set up on the server yet, so the connection couldn't be saved. Nothing was changed." });
  }

  const { nonce, state } = createState(env.CONNECT_KEY, now());
  res.statusCode = 302;
  res.setHeader("Location", authUrl({ env, state }));
  res.setHeader("Set-Cookie", stateCookie(nonce, STATE_TTL_MS / 1000));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end();
};

module.exports = createConnectHandler();
module.exports.createConnectHandler = createConnectHandler;
