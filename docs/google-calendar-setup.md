# Connecting `/calendar` to Vijay's Google Calendar

Until Google is connected, `/api/slots` serves simulated availability (`"mode": "mock"`) and `/api/book` returns `503 booking_not_configured`. Nothing in this repo holds credentials. They live in Vercel project env vars and in a private Vercel Blob, plus an untracked local `.env` for development.

Vijay connects his calendar by opening a single link and approving Google's consent screen. The callback saves his refresh token on the server, so nobody ever copies or pastes a token.

## Environment variables

| Name | Required | Value |
|---|---|---|
| `GOOGLE_CLIENT_ID` | yes | OAuth client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client secret |
| `CONNECT_KEY` | to connect | Long random string that unlocks `/api/google/connect`. While it's unset, both `/api/google/*` routes return 404 |
| `BLOB_READ_WRITE_TOKEN` | to connect | Added automatically when the Blob store is connected to the project (see below). Newer stores may inject `BLOB_STORE_ID` and use OIDC instead; both work |
| `GOOGLE_REFRESH_TOKEN` | no | Manual override. If set, it wins over the stored token. Leave it unset when using the connect link |
| `GOOGLE_CALENDAR_ID` | no | Calendar to read and write. Defaults to `primary` (the consenting account's main calendar) |
| `HOST_EMAIL` | no | Public host address, e.g. `hello@vijaypravin.com`. Added as an attendee unless it equals `GOOGLE_CALENDAR_ID` |
| `GOOGLE_ACCOUNT_EMAIL` | no | Account the callback accepts. Defaults to `hello@vijaypravin.com` |
| `GOOGLE_REDIRECT_URI` | local only | Overrides `https://www.vijaypravin.com/api/google/callback`, e.g. `http://localhost:3000/api/google/callback`. Never set it in Vercel |
| `BOOKING_MOCK` | local only | `1` lets `/api/book` simulate bookings when Google is not configured. Never set it in Vercel |

The refresh token is looked up in this order: the `GOOGLE_REFRESH_TOKEN` env var, then the token store. Each warm function instance re-reads the store at most once a minute.

## Where the token is stored, and why

The token goes in a **private Vercel Blob** at `google/refresh-token.json`, written with `@vercel/blob`. Of the options considered, it needs the least setup and grants the least access:

- **Vercel Blob (private).** It's first-party and creating the store takes one click. Vercel injects its credentials into the project's functions, and private blobs can't be fetched by URL. Only a store-scoped token is needed, and the site picks up a new token without a redeploy.
- **Vercel REST API rewriting `GOOGLE_REFRESH_TOKEN` and redeploying.** This would put a team-wide `VERCEL_API_TOKEN` (deploy and env access to every project) into a public-facing function, and each connect would trigger a production deploy.
- **Edge Config.** Reading is easy, but writing still needs a Vercel API token, so it has the same problem.
- **Upstash Redis through the Marketplace.** It works, but it adds a third-party account and integration for one value.

A refresh token is useless without `GOOGLE_CLIENT_SECRET`, which lives only in env vars. A leak of the Blob store alone therefore doesn't give access to the calendar.

## One-time setup

1. **Google Cloud project.** In the [Google Cloud console](https://console.cloud.google.com/), create a project (or reuse one) and enable the **Google Calendar API**.
2. **OAuth consent screen.** User type *Internal* if `vijaypravin.com` is a Google Workspace domain, otherwise *External*. Add the scopes:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.freebusy`
   - `openid` and `.../auth/userinfo.email` (used only to confirm the right account consented)

   For *External*, **publish the app to "In production"**. Refresh tokens for apps left in *Testing* expire after 7 days.
3. **OAuth client.** Create credentials → OAuth client ID → *Web application*. Add this authorised redirect URI exactly:
   `https://www.vijaypravin.com/api/google/callback`
4. **Blob store.** In Vercel (project `vijay-pravin`, team `gigahertz-innovations`), go to **Storage → Create → Blob**, choose **private** access and connect it to the project for Production (and Preview if you want). That adds `BLOB_READ_WRITE_TOKEN`.
5. **Env vars.**

   ```sh
   vercel env add GOOGLE_CLIENT_ID production preview
   vercel env add GOOGLE_CLIENT_SECRET production preview
   vercel env add HOST_EMAIL production preview           # optional

   CONNECT_KEY=$(openssl rand -hex 32)                    # keep it for the link in step 6; don't commit or paste it in chats
   printf %s "$CONNECT_KEY" | vercel env add CONNECT_KEY production
   ```

   Redeploy so the functions see the new values.
6. **Vijay's consent.** Send Vijay this link privately:

   `https://www.vijaypravin.com/api/google/connect?key=<CONNECT_KEY>`

   He signs in as `hello@vijaypravin.com`, ticks both calendar permissions and clicks *Continue*. He should then see **Calendar connected**. Within a minute, `/calendar` shows his real availability.

   Use the `www` URL. The anti-forgery cookie is set on the host that served the link, and Google always returns to `www`.

   After he's connected, you can delete `CONNECT_KEY` (and redeploy) to switch both routes back to 404. Set it again whenever he needs to reconnect.

The callback refuses to save anything, and says why, when:
- the link is expired (older than 10 minutes) or was opened in a different browser
- Vijay signs in with another Google account
- he unticks a calendar permission
- Google doesn't return a refresh token

## Checking it works

1. `GET /api/slots?eventType=30min&timeZone=Europe/Berlin` should return `"mode": "google"`, and the slots should leave gaps where Vijay's calendar is busy.
2. Make one test booking with your own email address and confirm:
   - the event appears on Vijay's calendar with a Google Meet link
   - the guest gets the invite email
   - booking the same slot again returns `409 slot_unavailable`
3. Delete the test event.

## Reconnecting and revoking

- **Reconnect** (new password, revoked access, different account): set `CONNECT_KEY` if it was removed and open the link again. The new token overwrites the stored one.
- **Revoke**: remove the app at <https://myaccount.google.com/permissions> on Vijay's account. Then delete `google/refresh-token.json` from the Blob store (Vercel → Storage → the store → Browser). Until it's deleted, `/api/slots` returns `502` because the stored token no longer works.

## Local development

```sh
npm install                  # @vercel/blob
npm run dev                  # http://localhost:3000, mock availability, booking returns 503
BOOKING_MOCK=1 npm run dev   # also simulates bookings (no Google calls, no email)
npm test                     # Google and Blob are mocked; no network calls
```

To test against Google locally, put the variables in an untracked `.env` file at the repo root (`.env` is gitignored and excluded from deploys). To try the connect flow locally, also set `GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback`, add that URI to the OAuth client, and use a separate Blob store. `vercel env pull` brings down the project's `BLOB_READ_WRITE_TOKEN`, but that's the production store.
