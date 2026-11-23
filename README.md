<img src="assets/icon.svg" width="64" height="64" alt="">

# Vijay Pravin

Founder profile website for Vijay Pravin Maharajan, Founder and CEO of HeyUla. Served at [vijaypravin.com](https://vijaypravin.com).

Static site (HTML/CSS/JS, no build step), deployed on Vercel.

```sh
npx serve .   # local preview
```

## Booking page (`/calendar`)

`calendar.html` is the booking page, and it's backed by two Vercel functions: `api/slots.js` and `api/book.js`. Event types and working hours live in `api/_lib/config.js`. The functions read live free/busy from Google Calendar. Without Google credentials they serve simulated availability and refuse to book. See [docs/google-calendar-setup.md](docs/google-calendar-setup.md).

```sh
npm run dev   # static site + API on http://localhost:3000
npm test      # slot and booking tests (node:test, no dependencies)
```

Created in [T3 Code](https://t3.codes).
