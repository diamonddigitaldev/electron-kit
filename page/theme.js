"use strict";

// electron-kit's theme script: it stamps data-bs-theme on <html>, "dark" or
// "light", so Bootstrap and kit.css draw the OS theme. Load it in <head>, after
// the stylesheets, as a plain script (not async, defer or a module):
//
//     <script src="../node_modules/@diamonddigitaldev/electron-kit/page/theme.js"></script>
//
// There it runs before the body parses, so the first paint is already in the
// OS theme, with no flash of the other one. Then it follows the OS theme two
// ways, and applies whichever change arrives first:
// - prefers-color-scheme's change event, the route that's meant to carry a
//   live change;
// - the kit's theme:changed push (kitAPI.onThemeChanged), which the main
//   process sends from nativeTheme. A tester on real Windows saw an app stay
//   dark after switching Windows to Light, the media query's change never
//   arriving; the push doesn't depend on it.
// Applying the theme already in force does nothing.
//
// It has no import or export and sets no global, so it runs as a classic
// script beside any page, module or not. In a window without the kit's bridge
// (another session), it follows the media query alone.

(() => {
    const root = document.documentElement;

    /** Stamp a theme on <html>: "dark" or "light", and nothing else. */
    const apply = (theme) => {
        if (theme !== "dark" && theme !== "light") return;
        if (root.getAttribute("data-bs-theme") !== theme) root.setAttribute("data-bs-theme", theme);
    };

    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const fromMedia = () => apply(dark.matches ? "dark" : "light");
    fromMedia();
    dark.addEventListener("change", fromMedia);

    window.kitAPI?.onThemeChanged(apply);
})();
