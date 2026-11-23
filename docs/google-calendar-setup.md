# Connecting `/calendar` to Vijay's Google Calendar

Until these variables are set, `/api/slots` serves simulated availability (`"mode": "mock"`) and `/api/book` returns `503 booking_not_configured`. Nothing in this repo holds credentials; they live only in Vercel project env vars (and an untracked local `.env`).

## Environment variables

| Name | Required | Value |
|---|---|---|
| `GOOGLE_CLIENT_ID` | yes | OAuth client ID from Google Cloud |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | yes | Refresh token from Vijay's one-time consent |
| `GOOGLE_CALENDAR_ID` | no | Calendar to read and write. Defaults to `primary` (the consenting account's main calendar) |
| `HOST_EMAIL` | no | Public host address, e.g. `hello@vijaypravin.com`. Added as an attendee unless it equals `GOOGLE_CALENDAR_ID` |
| `BOOKING_MOCK` | local only | `1` lets `/api/book` simulate bookings when Google is not configured. Never set it in Vercel |

The Google account that grants consent becomes the **organizer** of every booked event and the account that creates the Meet link. Use the account whose calendar cal.com checks today.

## One-time setup

1. **Google Cloud project.** In the [Google Cloud console](https://console.cloud.google.com/), create a project (or reuse one) and enable the **Google Calendar API**.
2. **OAuth consent screen.** User type *External* (or *Internal* for Workspace). Add the scopes:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.freebusy`

   Then **publish the app to "In production"**. Refresh tokens for apps left in *Testing* expire after 7 days.
3. **OAuth client.** Create credentials → OAuth client ID → *Web application*. Add `https://developers.google.com/oauthplayground` as an authorised redirect URI.
4. **Vijay's consent (one time).** Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), click the gear icon, tick *Use your own OAuth credentials* and paste the client ID and secret. Enter the two scopes above, click *Authorize APIs*, and have Vijay sign in with the calendar account. Click *Exchange authorization code for tokens* and copy the **refresh token**. Don't paste it anywhere except the next step.
5. **Store in Vercel** (project `vijay-pravin`, team `gigahertz-innovations`):

   ```sh
   vercel env add GOOGLE_CLIENT_ID production preview
   vercel env add GOOGLE_CLIENT_SECRET production preview
   vercel env add GOOGLE_REFRESH_TOKEN production preview
   vercel env add GOOGLE_CALENDAR_ID production preview   # optional, e.g. primary
   vercel env add HOST_EMAIL production preview           # optional
   ```

   Redeploy so the functions pick up the new values.

## Checking it works

1. `GET /api/slots?eventType=30min&timeZone=Europe/Berlin` should return `"mode": "google"`, and the slots should leave gaps where Vijay's calendar is busy.
2. Make one test booking with your own email address and confirm:
   - the event appears on Vijay's calendar with a Google Meet link
   - the guest gets the invite email
   - booking the same slot again returns `409 slot_unavailable`
3. Delete the test event.

To revoke access, remove the app at <https://myaccount.google.com/permissions> on Vijay's account and delete the env vars.

## Local development

```sh
npm run dev                  # http://localhost:3000, mock availability, booking returns 503
BOOKING_MOCK=1 npm run dev   # also simulates bookings (no Google calls, no email)
npm test
```

To test against Google locally, put the variables in an untracked `.env` file at the repo root (`.env` is gitignored and excluded from deploys).
