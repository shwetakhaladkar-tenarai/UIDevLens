/* Demo-site client script — INTENTIONALLY flawed. */

// INTENTIONAL: console warning + error on load
console.warn("[demo] Deprecation warning: legacy widget loader in use.");
console.error("[demo] Simulated non-fatal error: analytics beacon failed.");

// INTENTIONAL: duplicate API request — /api/products fetched multiple times
function loadProducts() {
  fetch("/api/products").then((r) => r.json()).then(() => {});
}
loadProducts();
loadProducts();          // duplicate #2
setTimeout(loadProducts, 300); // duplicate #3

// INTENTIONAL: intentionally slow API request (server delays ~2.5s)
fetch("/api/slow").then((r) => r.json()).then(() => {});

// INTENTIONAL: failed network request (404) — fixture for functional
// console_errors.py's failed-request/HTTP-error detection.
fetch("/api/does-not-exist").catch(() => {});

// INTENTIONAL: missing error state — this request (backing the "Loading
// widget stats…" spinner in index.html) fails (404), but no error UI is
// ever shown to the user; the spinner is simply left stuck instead of
// surfacing the failure. That omission IS the bug being demonstrated —
// fixture for functional/states.py's stuck-loading detector.
fetch("/api/widget-stats").catch(() => {});

// INTENTIONAL: cumulative layout shift — inject a tall banner after 800ms,
// pushing existing content down without reserved space.
setTimeout(() => {
  const late = document.getElementById("late-content");
  if (late) {
    late.innerHTML =
      '<div style="background:#fde68a;padding:40px;font-size:18px;">' +
      "Late-loading promo banner (causes layout shift)</div>";
  }
}, 800);

// INTENTIONAL: some busywork so there's a little main-thread activity
let acc = 0;
for (let i = 0; i < 200000; i++) acc += Math.sqrt(i);
window.__demoAcc = acc;

// INTENTIONAL: "Show details" IS wired up — a working control, proving the
// functional button validator doesn't false-positive on real interactivity.
const revealBtn = document.getElementById("reveal-btn");
const revealPanel = document.getElementById("reveal-panel");
if (revealBtn && revealPanel) {
  revealBtn.addEventListener("click", () => {
    revealPanel.hidden = false;
    revealBtn.setAttribute("aria-expanded", "true");
  });
}

// INTENTIONAL: "Refresh data" (#dead-btn) has NO handler — looks clickable
// but does nothing (dead-button fixture for functional validation).

// INTENTIONAL: "Delete Account" (#delete-account-btn) also has no handler —
// it must never be exercised by automated testing regardless (destructive-
// looking control fixture for the safe-interaction policy).
