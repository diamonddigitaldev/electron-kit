"use strict";

// The theme in real Electron: the kit's theme.js, in the demo's <head>, draws
// the page in the OS theme from the start, and the page follows the OS theme
// as it changes while the app runs, by either route on its own: the kit's
// theme:changed push (nativeTheme, from main) and the page's own
// prefers-color-scheme.

const { test, expect, showsTheme } = require("./helpers/demo");

/** Bootstrap's page background in each theme. */
const BACKGROUND = { light: "rgb(255, 255, 255)", dark: "rgb(33, 37, 41)" };

/** How the page is drawn: the theme on <html>, the page's background, and what its media query says. */
const drawn = (page) => page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-bs-theme"),
    background: getComputedStyle(document.body).backgroundColor,
    mediaSaysDark: matchMedia("(prefers-color-scheme: dark)").matches,
}));

/** The OS theme, as the main process sees it. */
const osTheme = (demo) => demo.app.evaluate(({ nativeTheme }) => (nativeTheme.shouldUseDarkColors ? "dark" : "light"));

test("the page opens in the OS theme, from theme.js in <head>", async ({ demo }) => {
    const main = await demo.mainWindow();
    const theme = await osTheme(demo);
    expect(await drawn(main)).toEqual({ theme, background: BACKGROUND[theme], mediaSaysDark: theme === "dark" });
    await expect(main.locator("#theme")).toHaveText(theme === "dark" ? "Dark" : "Light");

    // A plain script in <head> runs before the body parses, so the first paint is already in the theme.
    const scripts = await main.evaluate(() => [...document.scripts]
        .filter((script) => /[\\/]electron-kit[\\/]page[\\/]theme\.js$/.test(decodeURIComponent(script.src)))
        .map((script) => ({ inHead: script.parentElement === document.head, async: script.async, defer: script.defer, type: script.type })));
    expect(scripts).toEqual([{ inHead: true, async: false, defer: false, type: "" }]);
});

test("the page follows the OS theme as it changes while the app runs", async ({ demo }) => {
    const main = await demo.mainWindow();
    // Light first, so dark and light after it are real changes whatever the OS was in.
    for (const theme of ["light", "dark", "light"]) {
        await demo.useTheme(main, theme);
        expect(await drawn(main), theme).toEqual({ theme, background: BACKGROUND[theme], mediaSaysDark: theme === "dark" });
        await expect(main.locator("#theme")).toHaveText(theme === "dark" ? "Dark" : "Light");
    }
});

test("the kit's push carries an OS theme change on its own, with the page's media query held", async ({ demo }) => {
    const main = await demo.mainWindow();
    await demo.useTheme(main, "light");
    // The media query held at light, as if its change never reached the page (what a tester saw on real Windows).
    await main.emulateMedia({ colorScheme: "light" });

    await demo.useTheme(main, "dark");
    expect(await drawn(main)).toEqual({ theme: "dark", background: BACKGROUND.dark, mediaSaysDark: false });
    await demo.useTheme(main, "light");
    expect(await drawn(main)).toEqual({ theme: "light", background: BACKGROUND.light, mediaSaysDark: false });
});

test("the page's media query carries a change on its own, with no push", async ({ demo }) => {
    const main = await demo.mainWindow();
    await demo.useTheme(main, "light");

    await main.emulateMedia({ colorScheme: "dark" });
    await showsTheme(main, "dark");
    expect(await drawn(main)).toEqual({ theme: "dark", background: BACKGROUND.dark, mediaSaysDark: true });
    expect(await osTheme(demo), "the OS theme, which pushes nothing while it stays the same").toBe("light");

    await main.emulateMedia({ colorScheme: "light" });
    await showsTheme(main, "light");
});

test("a window in another session, without the kit's bridge, opens in the OS theme and follows it too", async ({ demo }) => {
    const main = await demo.mainWindow();
    await demo.useTheme(main, "dark");
    const isolated = await demo.openIsolatedWindow(main);
    expect(await demo.bridgesOf(isolated)).toMatchObject({ kitAPI: "undefined" });
    await showsTheme(isolated, "dark");
    expect(await drawn(isolated)).toMatchObject({ theme: "dark", background: BACKGROUND.dark });
    for (const theme of ["light", "dark"]) {
        await demo.setOsTheme(theme);
        await showsTheme(isolated, theme);
        expect((await drawn(isolated)).background, theme).toBe(BACKGROUND[theme]);
    }
});
