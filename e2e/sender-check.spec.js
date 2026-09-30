"use strict";

// The sender check on the kit's shared IPC, in real Electron. The kit's session
// preload gives window.kitAPI to every page in the app's UI session, not only
// the app's own, but its handlers answer the app's own page only. These open
// pages that have kitAPI and aren't the app's page, and check each call is
// refused, while the app's own page is still answered in the same run.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { test, expect } = require("./helpers/demo");
const { ISOLATED_PARTITION } = require("../demo/src/constants");

const REFUSED = /electron-kit answers "app:get-version" for the app's own page only/;

/** Each call of the kit's bridge that asks main something, and the channel it asks on. */
const ASKS = {
    "getVersion()": "app:get-version",
    "getInfo()": "app:get-info",
    "getSettings()": "settings:get",
    "setSettings({ navCollapsed: true })": "settings:set",
    "openExternal(\"https://example.com/\")": "shell:open-external",
};

/** What a page's kitAPI.getVersion() comes to: { version }, or { refused } with the error it rejects with. */
const askVersion = (page) => page.evaluate(() => window.kitAPI.getVersion().then(
    (version) => ({ version }),
    (err) => ({ refused: err.message }),
));

/** What each of ASKS comes to in a page: "answered", or the error it rejects with. */
const askEverything = (page) => page.evaluate((calls) => Promise.all(calls.map((call) => {
    // Each call is one of the lines above, run against the page's kitAPI.
    const run = new Function("kitAPI", `return kitAPI.${call};`);
    return run(window.kitAPI).then(() => "answered", (err) => err.message);
})), Object.keys(ASKS));

/** The app's version, as the main process has it. */
const appVersion = (demo) => demo.app.evaluate(({ app }) => app.getVersion());

test("a page in the app's session that isn't the app's own has kitAPI, and is refused", async ({ demo }, testInfo) => {
    const main = await demo.mainWindow();
    // A file on this machine, outside the app's code.
    const outside = testInfo.outputPath("not-the-app.html");
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, "<!DOCTYPE html><title>Not the App</title><p>A page outside the app's code.</p>");

    for (const url of ["data:text/html,<title>Not the App</title><p>Not the app's page.</p>", pathToFileURL(outside).href]) {
        const page = await demo.openWindowAt(url);
        expect(await demo.bridgesOf(page), url).toMatchObject({ kitAPI: "object" });
        expect((await askVersion(page)).refused, url).toMatch(REFUSED);
    }
    expect(await askVersion(main)).toEqual({ version: await appVersion(demo) });
});

test("every shared handler refuses a page that isn't the app's own, and does nothing for it", async ({ demo }) => {
    const main = await demo.mainWindow();
    // shell.openExternal stood in for, so a call that got through would be seen, and would open nothing.
    await demo.app.evaluate(({ shell }) => {
        globalThis.openedUrls = [];
        shell.openExternal = async (url) => {
            globalThis.openedUrls.push(url);
        };
    });
    const before = await main.evaluate(() => window.kitAPI.getSettings());

    const page = await demo.openWindowAt("data:text/html,<title>Not the App</title><p>Not the app's page.</p>");
    const results = await askEverything(page);
    Object.entries(ASKS).forEach(([call, channel], i) => {
        expect(results[i], call).toMatch(new RegExp(`electron-kit answers "${channel}" for the app's own page only`));
    });
    expect(await demo.app.evaluate(() => globalThis.openedUrls), "nothing was opened").toEqual([]);
    expect(await main.evaluate(() => window.kitAPI.getSettings()), "no setting changed").toEqual(before);
    // The app's own page is answered for every one of them.
    expect(await askEverything(main)).toEqual(Object.keys(ASKS).map(() => "answered"));
});

test("the app's own page in another session is refused, even with kitAPI there", async ({ demo }) => {
    const main = await demo.mainWindow();
    // The kit's preload registered on the isolated window's partition as well, as a mistake might.
    await demo.app.evaluate(({ session }, partition) => {
        const [kit] = session.defaultSession.getPreloadScripts();
        session.fromPartition(partition).registerPreloadScript(kit);
    }, ISOLATED_PARTITION);

    const isolated = await demo.openIsolatedWindow(main);
    expect(await demo.windowOf(isolated)).toMatchObject({ defaultSession: false });
    expect(await demo.bridgesOf(isolated)).toMatchObject({ kitAPI: "object" });
    expect(isolated.url(), "the demo's own isolated.html").toMatch(/[\\/]isolated\.html$/);
    expect((await askVersion(isolated)).refused).toMatch(REFUSED);
    expect(await askVersion(main)).toEqual({ version: await appVersion(demo) });
});

test("the app's own channels, through kit.ipc.handle(), refuse a page that isn't the app's own", async ({ demo }) => {
    const main = await demo.mainWindow();
    // As a window of the demo's navigated away: the demo's own preload runs there, so the page has electronAPI.
    const page = await demo.openWindowAt("data:text/html,<title>Not the App</title><p>Not the app's page.</p>", { appPreload: true });
    expect(await demo.bridgesOf(page)).toMatchObject({ kitAPI: "object", electronAPI: "object" });
    const windows = () => demo.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const before = await windows();

    const refused = await page.evaluate(() => window.electronAPI.openIsolatedWindow().then(() => "answered", (err) => err.message));
    expect(refused).toMatch(/"demo:open-isolated-window" is answered for the app's own page only/);
    expect(await windows(), "no window was opened").toBe(before);

    // The demo's own page is answered.
    await demo.openIsolatedWindow(main);
    expect(await windows()).toBe(before + 1);
});
