"use strict";

// The theme push: when the OS theme changes, the kit tells every window, on
// theme:changed, "dark" or "light". The page's theme.js applies it.
//
// theme.js also follows the OS theme through prefers-color-scheme, the route
// that's meant to carry a live change. A tester on real Windows saw an app stay
// dark after switching Windows to Light, so the main process pushes the change
// as well: nativeTheme is its own view of the OS setting, and doesn't depend on
// the media query's change reaching the page. The page applies whichever
// arrives first; applying the theme already in force does nothing.

const { BrowserWindow, nativeTheme } = require("electron");
const { PUSH } = require("./channels");

/** The theme in force: "dark" or "light". */
function currentTheme() {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

/** Push the theme in force to every window. */
function broadcastTheme() {
    const theme = currentTheme();
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(PUSH.THEME_CHANGED, theme);
    }
}

/** Push each change of the OS theme to every window, from now on. */
function followTheme() {
    nativeTheme.on("updated", broadcastTheme);
}

module.exports = { currentTheme, broadcastTheme, followTheme };
