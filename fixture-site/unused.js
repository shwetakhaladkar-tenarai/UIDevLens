/* unused.js — INTENTIONAL unnecessary JavaScript.
 * This defines a large library that is never invoked by the page, so Lighthouse
 * flags it as unused JavaScript. Padded to be meaningfully large. */
(function () {
  const UnusedWidgetLibrary = {};
  function make(n) {
    UnusedWidgetLibrary["widget_" + n] = function (a, b, c) {
      // Pointless computation that is never called.
      const data = [];
      for (let i = 0; i < 50; i++) {
        data.push({ id: i, v: (a || 1) * (b || 2) + (c || 3) + Math.sin(i) * Math.cos(i) });
      }
      return data.reduce((s, x) => s + x.v, 0);
    };
  }
  for (let n = 0; n < 300; n++) make(n);

  // Large unused string blob to inflate the bundle size.
  UnusedWidgetLibrary.__blob = new Array(2000)
    .fill("lorem-ipsum-dolor-sit-amet-consectetur-adipiscing-elit-")
    .join("");

  window.UnusedWidgetLibrary = UnusedWidgetLibrary; // assigned, never used
})();
