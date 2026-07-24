// alwaysActive.js — keeps the tab alive even when backgrounded
// Runs in MAIN world to override visibility API

(() => {
  // Override visibilityState so the page always thinks it's visible
  try {
    Object.defineProperty(document, "visibilityState", {
      get: () => "visible",
      configurable: true,
    });
    Object.defineProperty(document, "hidden", {
      get: () => false,
      configurable: true,
    });
  } catch (e) {}

  // Override requestAnimationFrame to keep running at full speed
  const _raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => _raf(cb);

  // Prevent visibilitychange from firing "hidden"
  document.addEventListener("visibilitychange", e => {
    e.stopImmediatePropagation();
  }, true);
})();
