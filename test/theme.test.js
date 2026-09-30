"use strict";

// The theme, both halves:
// - main/theme.js: once the app is ready, kit.start() pushes each change of
//   the OS theme (nativeTheme's "updated") to every window on theme:changed;
// - page/theme.js: the head script stamps data-bs-theme on <html> from
//   prefers-color-scheme at once, follows the media query's changes, and
//   applies the push. It's run here in a context of its own, with a stand-in
//   page, as a classic script.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadMain } = require("./helpers/main");
const { PUSH } = require("../main/channels");

const THEME_JS = path.join(__dirname, "..", "page", "theme.js");

// -- The push (main) ---------------------------------------------------------

test("once ready, kit.start() pushes each OS theme change to every window", async () => {
    const { main, electron, openWindow } = loadMain();
    const windows = [openWindow(), openWindow()];
    await main.start().ready;

    electron.nativeTheme.switchTo("dark");
    electron.nativeTheme.switchTo("light");
    for (const win of windows) {
        assert.deepEqual(win.sent, [
            { channel: PUSH.THEME_CHANGED, args: ["dark"] },
            { channel: PUSH.THEME_CHANGED, args: ["light"] },
        ]);
    }
});

test("a window opened later gets the next change too, and a destroyed one is skipped", async () => {
    const { main, electron, openWindow } = loadMain();
    await main.start().ready;
    const later = openWindow();
    const destroyed = openWindow({ destroyed: true });

    electron.nativeTheme.switchTo("dark");
    assert.deepEqual(later.sent, [{ channel: PUSH.THEME_CHANGED, args: ["dark"] }]);
    assert.deepEqual(destroyed.sent, []);
});

test("kit.start() pushes nothing by itself, and follows nativeTheme once", async () => {
    const { main, electron, openWindow } = loadMain();
    const win = openWindow();
    await main.start().ready;
    assert.deepEqual(win.sent, []);
    assert.equal(electron.nativeTheme.listenerCount("updated"), 1);
});

// -- The head script (page) --------------------------------------------------

/**
 * Run theme.js as a page would, in a context of its own. The OS theme starts
 * as given; kitAPI is the kit's bridge, or absent for a window without it.
 */
function runThemeScript({ dark = false, kitAPI = true } = {}) {
    const attributes = new Map();
    const stamps = [];
    const documentElement = {
        getAttribute: (name) => attributes.get(name) ?? null,
        setAttribute: (name, value) => {
            stamps.push(value);
            attributes.set(name, String(value));
        },
    };
    const queries = [];
    const media = { matches: dark, listeners: [] };
    const push = { listeners: [] };

    const window = {
        matchMedia(query) {
            queries.push(query);
            return {
                get matches() { return media.matches; },
                addEventListener: (type, listener) => media.listeners.push({ type, listener }),
            };
        },
    };
    if (kitAPI) {
        window.kitAPI = {
            onThemeChanged(callback) {
                push.listeners.push(callback);
                return () => {};
            },
        };
    }
    vm.runInNewContext(fs.readFileSync(THEME_JS, "utf8"), { window, document: { documentElement } }, { filename: THEME_JS });

    return {
        /** The theme on <html>, or null. */
        theme: () => documentElement.getAttribute("data-bs-theme"),
        /** Every value set on <html>, in order. */
        stamps,
        queries,
        media,
        push,
        /** Change the OS theme as the media query sees it, and fire its change event. */
        mediaChangesTo(theme) {
            media.matches = theme === "dark";
            for (const { type, listener } of media.listeners) if (type === "change") listener({ matches: media.matches });
        },
        /** Deliver the kit's theme:changed push. */
        pushed(theme) {
            for (const listener of push.listeners) listener(theme);
        },
    };
}

test("theme.js stamps the OS theme on <html> at once, from prefers-color-scheme", () => {
    assert.equal(runThemeScript({ dark: true }).theme(), "dark");
    const page = runThemeScript({ dark: false });
    assert.equal(page.theme(), "light");
    assert.deepEqual(page.queries, ["(prefers-color-scheme: dark)"]);
});

test("theme.js follows the media query's changes", () => {
    const page = runThemeScript({ dark: false });
    page.mediaChangesTo("dark");
    assert.equal(page.theme(), "dark");
    page.mediaChangesTo("light");
    assert.equal(page.theme(), "light");
});

test("theme.js applies the kit's push, even when the media query never changes", () => {
    const page = runThemeScript({ dark: true });
    assert.equal(page.push.listeners.length, 1, "it listens on kitAPI.onThemeChanged");
    page.pushed("light");
    assert.equal(page.theme(), "light");
    assert.equal(page.media.matches, true, "the media query still says dark");
    page.pushed("dark");
    assert.equal(page.theme(), "dark");
});

test("theme.js applies whichever route arrives first, and the other does nothing", () => {
    const page = runThemeScript({ dark: false });
    page.pushed("dark");
    page.mediaChangesTo("dark");
    page.pushed("dark");
    assert.deepEqual(page.stamps, ["light", "dark"]);
});

test("theme.js ignores a push that isn't dark or light", () => {
    const page = runThemeScript({ dark: true });
    for (const junk of ["Light", "blue", "", undefined, null, 1, { theme: "light" }]) page.pushed(junk);
    assert.deepEqual(page.stamps, ["dark"]);
});

test("theme.js follows the media query alone in a window without the kit's bridge", () => {
    const page = runThemeScript({ dark: true, kitAPI: false });
    assert.equal(page.theme(), "dark");
    page.mediaChangesTo("light");
    assert.equal(page.theme(), "light");
});

test("theme.js is a classic script: no import or export, and no global of its own", () => {
    const source = fs.readFileSync(THEME_JS, "utf8");
    assert.doesNotMatch(source, /^\s*(import|export)\b/m);
    const context = { window: { matchMedia: () => ({ matches: false, addEventListener() {} }) }, document: { documentElement: { getAttribute: () => null, setAttribute() {} } } };
    const before = Object.keys(context);
    vm.runInNewContext(source, context);
    assert.deepEqual(Object.keys(context), before);
    assert.deepEqual(Object.keys(context.window), ["matchMedia"]);
});
