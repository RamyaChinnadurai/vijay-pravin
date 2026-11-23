const test = require("node:test");
const assert = require("node:assert/strict");

const { createConnectHandler } = require("../api/google/connect");
const { createCallbackHandler } = require("../api/google/callback");
const { createTokenStore, PATHNAME } = require("../api/_lib/token-store");
const { resolveCalendar } = require("../api/_lib/http");
const { createState, verifyState, STATE_COOKIE } = require("../api/_lib/oauth");

const KEY = "connect-key-for-tests";
const REFRESH = "1//refresh-token-SECRET";
const ACCESS = "ya29.access-token-SECRET";
const ENV = { CONNECT_KEY: KEY, GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "client-SECRET", BLOB_READ_WRITE_TOKEN: "blob-SECRET" };
const SCOPE = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy";
const NOW = Date.UTC(2026, 10, 23, 12, 0);

const call = async (handler, { method = "GET", url = "/", cookie } = {}) => {
  const req = { method, url, headers: cookie ? { cookie } : {}, socket: {} };
  const res = {
    statusCode: 200, headers: {}, payload: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s = "") { this.payload = s; },
  };
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, body: res.payload };
};

const fakeStore = ({ available = true, fail = false } = {}) => {
  const writes = [];
  return {
    writes,
    isAvailable: () => available,
    read: async () => writes.at(-1)?.refreshToken || null,
    write: async (record) => {
      if (fail) throw new Error("blob unavailable");
      writes.push(record);
    },
  };
};

const idToken = (claims) => ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

const googleToken = (overrides = {}) => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, body: Object.fromEntries(new URLSearchParams(String(init.body))) });
    return {
      ok: overrides.status ? overrides.status < 400 : true,
      status: overrides.status || 200,
      json: async () => ({
        access_token: ACCESS, expires_in: 3599, refresh_token: REFRESH, scope: SCOPE, token_type: "Bearer",
        id_token: idToken({ email: "hello@vijaypravin.com", email_verified: true }),
        ...overrides.body,
      }),
    };
  };
  return { requests, fetchImpl };
};

// Logged lines during fn(), so tests can assert nothing secret is printed.
const captureLogs = async (fn) => {
  const lines = [];
  const orig = { error: console.error, log: console.log, warn: console.warn };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    Object.assign(console, orig);
  }
};

const noSecrets = (text) => {
  for (const s of [REFRESH, ACCESS, "client-SECRET", "blob-SECRET", KEY]) assert.equal(text.includes(s), false, `leaked ${s}`);
};

const validCallback = (overrides = {}) => {
  const { nonce, state } = createState(KEY, NOW);
  return { url: `/api/google/callback?code=auth-code&state=${encodeURIComponent(state)}`, cookie: `${STATE_COOKIE}=${nonce}`, ...overrides };
};

test("GET /api/google/connect is a 404 without CONNECT_KEY or with the wrong key", async () => {
  const store = fakeStore();
  const { CONNECT_KEY, ...noKey } = ENV;
  assert.equal((await call(createConnectHandler({ env: noKey, store }), { url: `/api/google/connect?key=${KEY}` })).status, 404);
  const handler = createConnectHandler({ env: ENV, store });
  assert.equal((await call(handler, { url: "/api/google/connect" })).status, 404);
  assert.equal((await call(handler, { url: "/api/google/connect?key=wrong" })).status, 404);
  assert.equal((await call(handler, { url: `/api/google/connect?key=${KEY}x` })).status, 404);
  assert.equal((await call(handler, { method: "POST", url: `/api/google/connect?key=${KEY}` })).status, 404);
});

test("GET /api/google/connect redirects to Google consent with offline access and a signed state", async () => {
  const { status, headers } = await call(createConnectHandler({ env: ENV, store: fakeStore(), now: () => NOW }), {
    url: `/api/google/connect?key=${KEY}`,
  });
  assert.equal(status, 302);
  const loc = new URL(headers.location);
  assert.equal(loc.origin + loc.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const p = loc.searchParams;
  assert.equal(p.get("client_id"), "client-id");
  assert.equal(p.get("redirect_uri"), "https://www.vijaypravin.com/api/google/callback");
  assert.equal(p.get("response_type"), "code");
  assert.equal(p.get("access_type"), "offline");
  assert.equal(p.get("prompt"), "consent");
  assert.equal(p.get("login_hint"), "hello@vijaypravin.com");
  const scopes = p.get("scope").split(" ");
  assert.ok(scopes.includes("https://www.googleapis.com/auth/calendar.events"));
  assert.ok(scopes.includes("https://www.googleapis.com/auth/calendar.freebusy"));
  noSecrets(headers.location);

  const nonce = verifyState(KEY, p.get("state"), NOW);
  assert.ok(nonce);
  assert.equal(verifyState("other-key", p.get("state"), NOW), null);
  assert.equal(verifyState(KEY, p.get("state"), NOW + 11 * 60 * 1000), null); // expired
  const cookie = headers["set-cookie"];
  assert.ok(cookie.startsWith(`${STATE_COOKIE}=${nonce};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(headers["cache-control"], "no-store");
});

test("GET /api/google/connect refuses to start when the client or the store is missing", async () => {
  const noStore = await call(createConnectHandler({ env: ENV, store: fakeStore({ available: false }) }), { url: `/api/google/connect?key=${KEY}` });
  assert.equal(noStore.status, 503);
  assert.equal(noStore.headers.location, undefined);
  const { GOOGLE_CLIENT_SECRET, ...noClient } = ENV;
  const noCreds = await call(createConnectHandler({ env: noClient, store: fakeStore() }), { url: `/api/google/connect?key=${KEY}` });
  assert.equal(noCreds.status, 503);
});

test("GET /api/google/callback exchanges the code, stores the refresh token and never shows it", async () => {
  const store = fakeStore();
  const google = googleToken();
  const handler = createCallbackHandler({ env: ENV, store, fetchImpl: google.fetchImpl, now: () => NOW });
  const { result, lines } = await captureLogs(() => call(handler, validCallback()));

  assert.equal(result.status, 200);
  assert.match(result.body, /Calendar connected/);
  assert.match(result.body, /href="\/calendar"/);
  assert.match(result.body, /\/styles\.css/);
  noSecrets(result.body);
  noSecrets(JSON.stringify(result.headers));
  noSecrets(lines.join("\n"));
  assert.deepEqual(store.writes.map((w) => w.refreshToken), [REFRESH]);

  assert.equal(google.requests.length, 1);
  assert.equal(google.requests[0].url, "https://oauth2.googleapis.com/token");
  assert.deepEqual(google.requests[0].body, {
    code: "auth-code", client_id: "client-id", client_secret: "client-SECRET",
    redirect_uri: "https://www.vijaypravin.com/api/google/callback", grant_type: "authorization_code",
  });
  assert.match(result.headers["set-cookie"], new RegExp(`^${STATE_COOKIE}=; .*Max-Age=0`)); // state cookie cleared
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["referrer-policy"], "no-referrer");
});

test("GET /api/google/callback rejects a forged, expired or unbound state without calling Google", async () => {
  const store = fakeStore();
  const google = googleToken();
  const handler = createCallbackHandler({ env: ENV, store, fetchImpl: google.fetchImpl, now: () => NOW });
  const forged = createState("not-the-key", NOW);
  const good = validCallback();
  const cases = [
    { url: `/api/google/callback?code=c&state=${forged.state}`, cookie: `${STATE_COOKIE}=${forged.nonce}` },
    { url: good.url }, // no cookie: state started in another browser
    { url: good.url, cookie: `${STATE_COOKIE}=someone-elses-nonce` },
    { url: "/api/google/callback?code=c&state=garbage", cookie: good.cookie },
  ];
  for (const c of cases) assert.equal((await call(handler, c)).status, 400);
  const late = createCallbackHandler({ env: ENV, store, fetchImpl: google.fetchImpl, now: () => NOW + 11 * 60 * 1000 });
  assert.equal((await call(late, good)).status, 400);
  assert.equal(google.requests.length, 0);
  assert.equal(store.writes.length, 0);
});

test("GET /api/google/callback saves nothing for the wrong account, missing scopes, denial or Google errors", async () => {
  const run = async (googleOverrides, req = validCallback()) => {
    const store = fakeStore();
    const google = googleToken(googleOverrides);
    const { result, lines } = await captureLogs(() =>
      call(createCallbackHandler({ env: ENV, store, fetchImpl: google.fetchImpl, now: () => NOW }), req));
    noSecrets(result.body);
    noSecrets(lines.join("\n"));
    assert.equal(store.writes.length, 0);
    return result;
  };
  const wrong = await run({ body: { id_token: idToken({ email: "vijay.personal@gmail.com", email_verified: true }) } });
  assert.equal(wrong.status, 403);
  assert.match(wrong.body, /hello@vijaypravin\.com/);
  assert.equal((await run({ body: { id_token: undefined } })).status, 403);
  assert.equal((await run({ body: { scope: "openid email https://www.googleapis.com/auth/calendar.freebusy" } })).status, 400);
  assert.equal((await run({ body: { refresh_token: undefined } })).status, 502);
  assert.equal((await run({ status: 400, body: { error: "invalid_grant" } })).status, 502);
  const denied = validCallback();
  assert.equal((await run({}, { ...denied, url: denied.url.replace("code=auth-code", "error=access_denied") })).status, 400);
});

test("GET /api/google/callback reports a storage failure and is a 404 without CONNECT_KEY", async () => {
  const google = googleToken();
  const failing = createCallbackHandler({ env: ENV, store: fakeStore({ fail: true }), fetchImpl: google.fetchImpl, now: () => NOW });
  const { result, lines } = await captureLogs(() => call(failing, validCallback()));
  assert.equal(result.status, 500);
  noSecrets(result.body + lines.join("\n"));

  const { CONNECT_KEY, ...noKey } = ENV;
  const off = createCallbackHandler({ env: noKey, store: fakeStore(), fetchImpl: google.fetchImpl, now: () => NOW });
  assert.equal((await call(off, validCallback())).status, 404);
});

test("calendar resolution uses the env refresh token first, then the token store", async () => {
  const { CONNECT_KEY, BLOB_READ_WRITE_TOKEN, ...creds } = ENV;
  let reads = 0;
  const store = (token) => ({ read: async () => (reads++, token) });

  assert.equal((await resolveCalendar(creds, store(null))).mode, "mock");
  assert.equal((await resolveCalendar(creds, store(REFRESH))).mode, "google");
  reads = 0;
  assert.equal((await resolveCalendar({ ...creds, GOOGLE_REFRESH_TOKEN: "env-token" }, store(REFRESH))).mode, "google");
  assert.equal(reads, 0); // env var wins; store not consulted
  assert.equal((await resolveCalendar({ GOOGLE_CLIENT_ID: "id" }, store(REFRESH))).mode, "mock"); // no client secret
});

test("token store writes a private blob, reads it back and survives a read failure", async () => {
  const blobs = new Map();
  let failReads = false;
  const blob = {
    put: async (pathname, body, opts) => blobs.set(pathname, { body, opts }),
    get: async (pathname, opts) => {
      assert.equal(opts.access, "private");
      if (failReads) throw new Error("blob down");
      const b = blobs.get(pathname);
      return b ? { statusCode: 200, stream: new Blob([b.body]).stream() } : null;
    },
  };
  let t = NOW;
  const store = createTokenStore({ env: { BLOB_READ_WRITE_TOKEN: "x" }, blob: () => blob, now: () => t });
  assert.equal(await store.read(), null);

  await store.write({ refreshToken: REFRESH, scope: "s" });
  const saved = blobs.get(PATHNAME);
  assert.equal(saved.opts.access, "private");
  assert.equal(saved.opts.addRandomSuffix, false);
  assert.equal(saved.opts.allowOverwrite, true);
  assert.equal(JSON.parse(saved.body).refreshToken, REFRESH);

  const fresh = createTokenStore({ env: { BLOB_READ_WRITE_TOKEN: "x" }, blob: () => blob, now: () => t });
  assert.equal(await fresh.read(), REFRESH);
  failReads = true;
  t += 5 * 60 * 1000;
  const { result, lines } = await captureLogs(() => fresh.read());
  assert.equal(result, REFRESH); // last known value kept
  noSecrets(lines.join("\n"));

  const off = createTokenStore({ env: {}, blob: () => { throw new Error("must not load"); } });
  assert.equal(off.isAvailable(), false);
  assert.equal(await off.read(), null);
});
