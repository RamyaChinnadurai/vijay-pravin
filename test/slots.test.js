const test = require("node:test");
const assert = require("node:assert/strict");

const { EVENT_TYPES } = require("../api/_lib/config");
const { candidateStarts, bookableStarts, groupByDate } = require("../api/_lib/slots");
const { zonedToUtc, localDate } = require("../api/_lib/time");

const berlin = (y, mo, d, h, mi) => zonedToUtc(y, mo, d, h, mi, "Europe/Berlin");
const berlinHm = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(ms);
const day = (y, mo, d) => [berlin(y, mo, d, 0, 0), berlin(y, mo, d + 1, 0, 0)];
const longAgo = Date.UTC(2020, 0, 1);

test("zonedToUtc handles Berlin winter and summer offsets", () => {
  assert.equal(new Date(berlin(2026, 11, 24, 9, 30)).toISOString(), "2026-11-24T08:30:00.000Z");
  assert.equal(new Date(berlin(2026, 7, 14, 9, 30)).toISOString(), "2026-07-14T07:30:00.000Z");
});

test("Mon-Thu 15min slots run 09:30 to a last start of 17:45", () => {
  const starts = candidateStarts(EVENT_TYPES["15min"], ...day(2026, 11, 24)); // Tuesday
  assert.equal(berlinHm(starts[0]), "09:30");
  assert.equal(berlinHm(starts.at(-1)), "17:45");
  assert.equal(starts.length, 34);
});

test("Friday window ends at 17:00", () => {
  const starts = candidateStarts(EVENT_TYPES["15min"], ...day(2026, 11, 27));
  assert.equal(berlinHm(starts.at(-1)), "16:45");
});

test("Saturday is 10:00-12:30 and Sunday is closed", () => {
  const sat = candidateStarts(EVENT_TYPES["15min"], ...day(2026, 11, 28));
  assert.equal(berlinHm(sat[0]), "10:00");
  assert.equal(berlinHm(sat.at(-1)), "12:15");
  assert.deepEqual(candidateStarts(EVENT_TYPES["15min"], ...day(2026, 11, 29)), []);
});

test("duration must fit before the window ends", () => {
  const sat = candidateStarts(EVENT_TYPES.podcast, ...day(2026, 11, 28));
  assert.deepEqual(sat.map(berlinHm), ["10:00", "11:00"]); // 12:00-13:00 would overrun 12:30
  const fri = candidateStarts(EVENT_TYPES["30min"], ...day(2026, 11, 27));
  assert.equal(berlinHm(fri.at(-1)), "16:30");
});

test("2-hour minimum notice drops near-term slots", () => {
  const now = berlin(2026, 11, 24, 10, 5);
  const starts = bookableStarts(EVENT_TYPES["30min"], ...day(2026, 11, 24), { now });
  assert.equal(berlinHm(starts[0]), "12:30"); // 12:05 is the cutoff; 11:30 and 12:00 are too soon
  const exact = bookableStarts(EVENT_TYPES["30min"], ...day(2026, 11, 24), { now: berlin(2026, 11, 24, 10, 30) });
  assert.equal(berlinHm(exact[0]), "12:30"); // a start exactly 2h out is allowed
});

test("busy blocks remove every overlapping slot but keep adjacent ones", () => {
  const busy = [{ start: berlin(2026, 11, 24, 11, 0), end: berlin(2026, 11, 24, 12, 15) }];
  const starts = bookableStarts(EVENT_TYPES["30min"], ...day(2026, 11, 24), { now: longAgo, busy }).map(berlinHm);
  assert.ok(starts.includes("10:30")); // ends 11:00, touching busy start
  assert.ok(!starts.includes("11:00"));
  assert.ok(!starts.includes("11:30"));
  assert.ok(!starts.includes("12:00")); // overlaps 12:00-12:15
  assert.ok(starts.includes("12:30"));
});

test("a 60min slot is blocked by a short busy block in its second half", () => {
  const busy = [{ start: berlin(2026, 11, 24, 10, 45), end: berlin(2026, 11, 24, 11, 0) }];
  const starts = bookableStarts(EVENT_TYPES.podcast, ...day(2026, 11, 24), { now: longAgo, busy }).map(berlinHm);
  assert.ok(!starts.includes("10:30"));
  assert.deepEqual(starts.slice(0, 2), ["09:30", "11:30"]);
});

test("DST change week keeps Berlin wall-clock hours", () => {
  const starts = candidateStarts(EVENT_TYPES["30min"], ...day(2027, 3, 29)); // Monday after spring forward
  assert.equal(new Date(starts[0]).toISOString(), "2027-03-29T07:30:00.000Z");
});

test("groupByDate keys slots by the guest's local date", () => {
  const starts = candidateStarts(EVENT_TYPES["30min"], ...day(2026, 11, 24));
  const tokyo = groupByDate(starts, "Asia/Tokyo"); // 09:30 Berlin = 17:30 Tokyo, 17:30 Berlin = 01:30 next day
  assert.deepEqual(Object.keys(tokyo), ["2026-11-24", "2026-11-25"]);
  assert.equal(localDate(Date.parse(tokyo["2026-11-25"][0]), "Asia/Tokyo"), "2026-11-25");
});
