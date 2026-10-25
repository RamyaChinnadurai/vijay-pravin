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
