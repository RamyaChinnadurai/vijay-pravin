// Booking rules, copied from cal.com/vijaypravin on 2026-11-23.
// Working hours were inferred from cal.com's public slots and still need Vijay's confirmation.

const HOST = {
  name: "Vijay Pravin",
  timeZone: "Europe/Berlin",
};

const EVENT_TYPES = {
  "15min": {
    slug: "15min",
    title: "quick meeting",
    length: 15,
    description: "If you want to convey something quickly",
    notesLabel: "Additional notes",
  },
  "30min": {
    slug: "30min",
    title: "30 minute meeting",
    length: 30,
    description: "",
    notesLabel: "Additional notes",
  },
  podcast: {
    slug: "podcast",
    title: "Podcast",
    length: 60,
    description: "For Podcast recording",
    notesLabel: "What is this meeting about?",
  },
};

// Shared by every event type. Slots start every `length` minutes from the window start
// (cal.com's default interval), and the whole meeting must end by the window end.
const RULES = {
  minimumNoticeMinutes: 120,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  maxRangeDays: 42,
  maxGuests: 10,
};

// Host-local wall-clock windows, keyed by ISO weekday (1 = Monday, 7 = Sunday).
const WORKING_HOURS = {
  1: [{ start: "09:30", end: "18:00" }],
  2: [{ start: "09:30", end: "18:00" }],
  3: [{ start: "09:30", end: "18:00" }],
  4: [{ start: "09:30", end: "18:00" }],
  5: [{ start: "09:30", end: "17:00" }],
  6: [{ start: "10:00", end: "12:30" }],
  7: [],
};

const publicEventTypes = () =>
  Object.values(EVENT_TYPES).map(({ slug, title, length, description, notesLabel }) => ({
    slug, title, length, description, notesLabel,
  }));

module.exports = { HOST, EVENT_TYPES, RULES, WORKING_HOURS, publicEventTypes };
