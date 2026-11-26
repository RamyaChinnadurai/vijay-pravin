// Sticky nav border on scroll
const nav = document.querySelector(".nav");
const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

// Mobile menu
const toggle = document.querySelector(".nav-toggle");
const menu = document.querySelector(".mobile-menu");
toggle.addEventListener("click", () => {
  const open = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!open));
  menu.hidden = open;
});
menu.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    toggle.setAttribute("aria-expanded", "false");
    menu.hidden = true;
  })
);

// Count-up for stats
const countUp = (el) => {
  const target = Number(el.dataset.count);
  const prefix = el.dataset.prefix || "";
  const suffix = el.dataset.suffix || "";
  const start = performance.now();
  const duration = 1400;
  const tick = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = prefix + Math.round(target * eased) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

// Reveal on scroll, staggered within each parent
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const siblings = [...el.parentElement.children].filter((c) => c.classList.contains("reveal"));
      el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 6) * 70}ms`;
      el.classList.add("in");
      const num = el.querySelector("[data-count]");
      if (num && !reduce) countUp(num);
      io.unobserve(el);
    });
  },
  { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

document.getElementById("year").textContent = new Date().getFullYear();

// Split-flap departures board
const FLAP_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$.";
document.querySelectorAll(".flap").forEach((el) => {
  const text = el.dataset.text.padEnd(Number(el.dataset.pad) || 0, " ");
  el.setAttribute("aria-label", el.dataset.text);
  el.innerHTML = [...text].map((c) => `<span class="ch" aria-hidden="true" data-c="${c}">${reduce ? c : " "}</span>`).join("");
});

const runBoard = (board) => {
  board.querySelectorAll(".flap").forEach((flap, f) => {
    flap.querySelectorAll(".ch").forEach((ch, i) => {
      const final = ch.dataset.c;
      let steps = 4 + i + (f % 4) * 2 + Math.floor(Math.random() * 4);
      const tick = () => {
        if (steps-- <= 0) { ch.textContent = final; return; }
        ch.textContent = FLAP_CHARS[Math.floor(Math.random() * FLAP_CHARS.length)];
        ch.classList.remove("flip"); void ch.offsetWidth; ch.classList.add("flip");
        setTimeout(tick, 55);
      };
      if (final === " ") return;
      setTimeout(tick, f * 40);
    });
  });
};

const boardIo = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    if (!reduce) runBoard(e.target);
    boardIo.unobserve(e.target);
  });
}, { threshold: 0.3 });
document.querySelectorAll(".board").forEach((b) => boardIo.observe(b));

// Passport stamps thump in one by one
const stampIo = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const stamps = [...e.target.querySelectorAll(".stamp")];
    stamps.forEach((s, i) => setTimeout(() => s.classList.add("in"), reduce ? 0 : 250 + i * 180));
    stampIo.unobserve(e.target);
  });
}, { threshold: 0.25 });
document.querySelectorAll(".passport").forEach((p) => stampIo.observe(p));

// ---------- Hero ----------
const hero = document.querySelector(".hero");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

// Live Munich clock
const clock = document.querySelector("[data-munich-time]");
if (clock) {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  const tickClock = () => (clock.textContent = fmt.format(new Date()));
  tickClock();
  setInterval(tickClock, 15000);
}

// "Data scientist." decodes from noise
const scramble = document.querySelector("[data-scramble]");
if (scramble && !reduce) {
  const final = scramble.dataset.scramble;
  const glyphs = "01<>/{}[]#$%&*+=?ABCDEFXYZ";
  const start = performance.now() + 450;
  const duration = 1300;
  const frame = (now) => {
    const p = Math.max(0, Math.min((now - start) / duration, 1));
    const solved = Math.floor(p * final.length);
    let html = final.slice(0, solved);
    for (let i = solved; i < final.length; i++) {
      const ch = final[i];
      html += ch === " " ? " " : `<span class="sc">${glyphs[(Math.random() * glyphs.length) | 0]}</span>`;
    }
    scramble.innerHTML = html;
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

if (hero && finePointer && !reduce) {
  // Spotlight follows the cursor
  hero.addEventListener("pointermove", (e) => {
    const r = hero.getBoundingClientRect();
    hero.style.setProperty("--mx", `${e.clientX - r.left}px`);
    hero.style.setProperty("--my", `${e.clientY - r.top + 76}px`);
  });

  // Magnetic buttons
  hero.querySelectorAll(".magnetic").forEach((btn) => {
    btn.addEventListener("pointermove", (e) => {
      const r = btn.getBoundingClientRect();
      btn.style.setProperty("--tx", `${(e.clientX - r.left - r.width / 2) * 0.25}px`);
      btn.style.setProperty("--ty", `${(e.clientY - r.top - r.height / 2) * 0.35}px`);
    });
    btn.addEventListener("pointerleave", () => {
      btn.style.setProperty("--tx", "0px");
      btn.style.setProperty("--ty", "0px");
    });
  });

  // 3D tilt on the boarding pass
  const card = hero.querySelector(".tilt");
  if (card) {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.classList.add("tilting");
      card.style.setProperty("--ry", `${(x - 0.5) * 12}deg`);
      card.style.setProperty("--rx", `${(0.5 - y) * 10}deg`);
      card.style.setProperty("--gx", `${x * 100}%`);
      card.style.setProperty("--gy", `${y * 100}%`);
    });
    card.addEventListener("pointerleave", () => {
      card.classList.remove("tilting");
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    });
  }
}
