// Booking flow: event type -> day and time -> details -> confirmation.
// Times are shown in the guest's time zone; the API works in UTC instants.

const $ = (id) => document.getElementById(id);
const steps = document.querySelectorAll(".bk-step");
const types = Object.fromEntries([...document.querySelectorAll(".bk-type")].map((a) => [a.dataset.eventType, { ...a.dataset }]));

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const state = {
  type: null,
  tz: detectedTz,
  view: null, // { year, month } shown in the month grid
  slots: {}, // "YYYY-MM-DD" -> [ISO]
  date: null,
  start: null,
  mode: null,
  loadToken: 0,
};

const todayIn = (tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day };
};

const fmtTime = (iso) => new Intl.DateTimeFormat(undefined, { timeZone: state.tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const fmtDay = (date, opts) => new Intl.DateTimeFormat(undefined, { timeZone: "UTC", ...opts }).format(new Date(`${date}T12:00:00Z`));
const fmtLongDate = (iso) => new Intl.DateTimeFormat(undefined, { timeZone: state.tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

// ---------- Steps ----------
const show = (name) => {
  steps.forEach((s) => (s.hidden = s.dataset.step !== name));
  $("bk-back").hidden = name === "types" || name === "done";
  const t = types[state.type];
  $("bk-title").textContent = t ? t.title : "Book a call";
  $("bk-desc").textContent = t ? t.description : "Pick the kind of call, then a time that suits you.";
  $("bk-length").hidden = !t;
  if (t) $("bk-length").querySelector("span").textContent = `${t.length} min`;
  const showWhen = (name === "details" || name === "done") && state.start;
  $("bk-when").hidden = !showWhen;
  if (showWhen) $("bk-when").querySelector("span").textContent = `${fmtLongDate(state.start)}, ${fmtTime(state.start)}`;
  document.querySelector(".bk-main").dataset.step = name;
};

const selectType = (slug, push = true) => {
  if (!types[slug]) return showTypes(push);
  state.type = slug;
  state.date = null;
  state.start = null;
  const today = todayIn(state.tz);
  state.view = { year: today.year, month: today.month };
  if (push) history.pushState({ type: slug }, "", `/calendar/${slug}`);
  $("bk-notes-label").textContent = types[slug].notesLabel;
  show("slots");
  loadMonth();
};

const showTypes = (push = true) => {
  state.type = null;
  if (push) history.pushState({}, "", "/calendar");
  show("types");
};

document.querySelectorAll(".bk-type").forEach((a) =>
  a.addEventListener("click", (e) => {
    e.preventDefault();
    selectType(a.dataset.eventType);
  })
);

$("bk-back").addEventListener("click", () => {
  const current = [...steps].find((s) => !s.hidden)?.dataset.step;
  if (current === "details") {
    state.start = null;
    show("slots");
  } else showTypes();
});

window.addEventListener("popstate", () => route(false));

// ---------- Month grid ----------
const weekdayRow = document.querySelector(".bk-weekdays");
weekdayRow.innerHTML = [...Array(7)].map((_, i) => `<span>${fmtDay(ymd(2026, 11, 23 + i), { weekday: "short" })}</span>`).join("");

const renderMonth = () => {
  const { year, month } = state.view;
  const today = todayIn(state.tz);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  $("bk-month-label").textContent = fmtDay(ymd(year, month, 1), { month: "long", year: "numeric" });
  $("bk-prev").disabled = year === today.year && month === today.month;
  const maxView = today.year * 12 + today.month + 11;
  $("bk-next").disabled = year * 12 + month >= maxView;

  const cells = [...Array(lead)].map(() => `<span></span>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = ymd(year, month, d);
    const open = Boolean(state.slots[date]?.length);
    const cls = ["bk-day", open && "open", date === state.date && "selected", date === ymd(today.year, today.month, today.day) && "today"].filter(Boolean).join(" ");
    const label = fmtDay(date, { weekday: "long", day: "numeric", month: "long" }) + (open ? "" : ", no times available");
    cells.push(`<button type="button" class="${cls}" data-date="${date}" ${open ? "" : "disabled"} aria-label="${label}" aria-pressed="${date === state.date}">${d}</button>`);
  }
  $("bk-days").innerHTML = cells.join("");
};

const renderTimes = () => {
  const list = $("bk-time-list");
  if (!state.date) {
    $("bk-times-label").textContent = "";
    list.innerHTML = `<p class="bk-empty">${Object.keys(state.slots).length ? "Pick a day to see times." : "No open times this month."}</p>`;
    return;
  }
  $("bk-times-label").textContent = fmtDay(state.date, { weekday: "short", day: "numeric", month: "short" });
  list.innerHTML = (state.slots[state.date] || [])
    .map((iso) => `<button type="button" class="bk-time" data-start="${iso}">${fmtTime(iso)}</button>`).join("");
};

const loadMonth = async () => {
  const token = ++state.loadToken;
  const { year, month } = state.view;
  const today = todayIn(state.tz);
  const isCurrent = year === today.year && month === today.month;
  const start = ymd(year, month, isCurrent ? today.day : 1);
  const end = ymd(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
  state.slots = {};
  renderMonth();
  $("bk-days").classList.add("loading");
  $("bk-time-list").innerHTML = `<p class="bk-empty">Loading times…</p>`;
  try {
    const qs = new URLSearchParams({ eventType: state.type, start, end, timeZone: state.tz });
    const res = await fetch(`/api/slots?${qs}`);
    const body = await res.json();
    if (token !== state.loadToken) return;
    if (!res.ok) throw new Error(body.message || "Could not load times.");
    state.slots = body.slots;
    state.mode = body.mode;
    $("bk-mode-note").hidden = body.mode !== "mock";
  } catch (err) {
    if (token !== state.loadToken) return;
    $("bk-time-list").innerHTML = `<p class="bk-empty">${err.message}</p>`;
    $("bk-days").classList.remove("loading");
    return;
  }
  $("bk-days").classList.remove("loading");
  if (!state.slots[state.date]) state.date = Object.keys(state.slots).sort()[0] || null;
  renderMonth();
  renderTimes();
};

$("bk-days").addEventListener("click", (e) => {
  const btn = e.target.closest(".bk-day.open");
  if (!btn) return;
  state.date = btn.dataset.date;
  renderMonth();
  renderTimes();
});

$("bk-time-list").addEventListener("click", (e) => {
  const btn = e.target.closest(".bk-time");
  if (!btn) return;
  state.start = btn.dataset.start;
  $("bk-error").hidden = true;
  show("details");
  $("bk-form").elements.name.focus();
});

const shiftMonth = (delta) => {
  const n = state.view.year * 12 + (state.view.month - 1) + delta;
  state.view = { year: Math.floor(n / 12), month: (n % 12) + 1 };
  state.date = null;
  loadMonth();
};
$("bk-prev").addEventListener("click", () => shiftMonth(-1));
$("bk-next").addEventListener("click", () => shiftMonth(1));

// ---------- Time zone ----------
const tzSelect = $("bk-tz");
const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
if (!zones.includes(detectedTz)) zones.unshift(detectedTz);
tzSelect.innerHTML = zones.map((z) => `<option value="${z}">${z.replace(/_/g, " ")}</option>`).join("");
tzSelect.value = detectedTz;
tzSelect.addEventListener("change", () => {
  state.tz = tzSelect.value;
  if (state.type) {
    state.start = null;
    show("slots");
    loadMonth();
  }
});

// ---------- Booking ----------
const showError = (msg) => {
  $("bk-error").textContent = msg;
  $("bk-error").hidden = false;
};

$("bk-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.currentTarget.elements;
  const name = f.name.value.trim();
  const email = f.email.value.trim();
  if (!name) return showError("Please enter your name.");
  if (!f.email.checkValidity() || !email) return showError("Please enter a valid email address.");
  $("bk-error").hidden = true;
  $("bk-submit").disabled = true;
  $("bk-submit").textContent = "Booking…";
  try {
    const res = await fetch("/api/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: state.type, start: state.start, name, email,
        notes: f.notes.value, guests: f.guests.value, website: f.website.value, timeZone: state.tz,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) {
      state.start = null;
      show("slots");
      await loadMonth();
      $("bk-time-list").insertAdjacentHTML("afterbegin", `<p class="bk-error">${body.message || "That time was just taken."}</p>`);
      return;
    }
    if (!res.ok) return showError(body.message || "Something went wrong. Please try again.");
    showDone(body);
  } catch {
    showError("Network error. Please try again.");
  } finally {
    $("bk-submit").disabled = false;
    $("bk-submit").textContent = "Confirm booking";
  }
});

const showDone = ({ booking, mode }) => {
  state.start = booking.start;
  $("bk-done-sub").textContent = mode === "mock"
    ? "Preview booking: Google Calendar isn't connected, so no invite was sent."
    : `A calendar invite is on its way to ${booking.email}.`;
  $("bk-done-what").textContent = `${booking.title} between Vijay Pravin and ${booking.name}`;
  $("bk-done-when").textContent = `${fmtLongDate(booking.start)}, ${fmtTime(booking.start)} – ${fmtTime(booking.end)} (${state.tz.replace(/_/g, " ")})`;
  $("bk-done-where").textContent = booking.meetUrl || "Google Meet (link in your calendar invite)";
  $("bk-meet").hidden = !booking.meetUrl;
  if (booking.meetUrl) $("bk-meet").href = booking.meetUrl;
  show("done");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ---------- Routing ----------
const route = (push) => {
  const fromPath = location.pathname.split("/")[2];
  const fromQuery = new URLSearchParams(location.search).get("type");
  const slug = fromPath || fromQuery;
  if (slug && types[slug]) selectType(slug, push);
  else showTypes(false);
};
route(false);
