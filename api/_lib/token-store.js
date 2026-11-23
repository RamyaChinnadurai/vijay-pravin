// Durable home for the Google refresh token captured by /api/google/callback.
// A private Vercel Blob (one JSON file) holds it; only this project's functions can read it.
// The GOOGLE_REFRESH_TOKEN env var, when set, always wins over the stored value.

const PATHNAME = "google/refresh-token.json";
const CACHE_MS = 60_000;

const isAvailable = (env = process.env) => Boolean(env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID);

const createTokenStore = ({ env = process.env, blob = () => require("@vercel/blob"), now = Date.now } = {}) => {
  let cached = null; // { refreshToken, at }

  const read = async () => {
    if (!isAvailable(env)) return null;
    if (cached && now() - cached.at < CACHE_MS) return cached.refreshToken;
    try {
      const found = await blob().get(PATHNAME, { access: "private", useCache: false });
      const record = found && found.statusCode === 200 ? JSON.parse(await new Response(found.stream).text()) : null;
      cached = { refreshToken: (record && record.refreshToken) || null, at: now() };
    } catch (err) {
      // Keep serving the last known value; a Blob hiccup shouldn't drop the site to mock mode.
      console.error("token-store: read failed:", err.message);
      if (!cached) return null;
    }
    return cached.refreshToken;
  };

  const write = async ({ refreshToken, scope }) => {
    await blob().put(PATHNAME, JSON.stringify({ refreshToken, scope, connectedAt: new Date(now()).toISOString() }), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
    cached = { refreshToken, at: now() };
  };

  return { read, write, isAvailable: () => isAvailable(env) };
};

module.exports = { createTokenStore, isAvailable, PATHNAME };
