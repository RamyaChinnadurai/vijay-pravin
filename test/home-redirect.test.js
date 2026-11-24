const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "calendar.html"), "utf8");
const js = fs.readFileSync(path.join(root, "calendar.js"), "utf8");
const css = fs.readFileSync(path.join(root, "calendar.css"), "utf8");

test("confirmation has a Back to home button and a live countdown", () => {
  assert.match(html, /id="bk-home"[^>]*href="\/"/);
  assert.match(html, />Back to home</);
  assert.match(html, /id="bk-home-countdown"[^>]*aria-live="polite"/);
  assert.match(css, /\.bk-home-countdown/);
});

test("successful booking starts a 10s home redirect that can be cancelled", () => {
  assert.match(js, /const HOME_REDIRECT_SECONDS = 10/);
  assert.match(js, /Taking you home in \$\{secondsLeft\}s/);
  assert.match(js, /window\.location\.assign\("\/"\)/);
  assert.match(js, /startHomeRedirect\(\)/);
  assert.match(js, /\$\("bk-home"\)\.addEventListener\("click", \(\) => stopHomeRedirect\(\)\)/);
  assert.match(js, /\$\("bk-again"\)\.addEventListener\("click", \(\) => stopHomeRedirect\(\)\)/);
  assert.match(js, /if \(name !== "done"\) stopHomeRedirect\(\)/);
});
