"use strict";

// The shared preload, registered on the app's session, in real Electron.
//
// kit.start() registers the kit's preload.js on the default session
// (session.registerPreloadScript). These check, in the demo:
// 1. a sandboxed, context-isolated window gets both bridges: window.kitAPI from
//    the kit's session preload and window.electronAPI from its own preload;
// 2. both bridges answer an invoke round trip;
// 3. a window in a partition of its own gets no kitAPI;
// and that the page loads the kit's CSS and page script from node_modules.
// With KIT_DEMO_EXECUTABLE set, they check a packaged build, where the kit's
// files must come from inside app.asar.

const { test, expect } = require("./helpers/demo");

/** Where the kit's files are in the app: its node_modules, inside app.asar when packaged. */
const kitFile = (packaged, file) => new RegExp(
    `${packaged ? "app\\.asar" : "demo"}[\\\\/]node_modules[\\\\/]@diamonddigitaldev[\\\\/]electron-kit[\\\\/]${file.replace(/[./]/g, (c) => (c === "/" ? "[\\\\/]" : "\\."))}$`,
);

test("the demo runs on Electron 44 or newer", async ({ demo }) => {
    const version = await demo.app.evaluate(() => process.versions.electron);
    expect(Number(version.split(".")[0]), `Electron ${version}`).toBeGreaterThanOrEqual(44);
});

test("the kit's preload is registered on the default session, from the app's node_modules", async ({ demo }) => {
    const scripts = await demo.app.evaluate(({ session }) => session.defaultSession.getPreloadScripts());
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({ type: "frame", id: "electron-kit" });
    expect(scripts[0].filePath).toMatch(kitFile(demo.packaged, "preload.js"));
});

test("a sandboxed, context-isolated window gets both bridges", async ({ demo }) => {
    const main = await demo.mainWindow();

    expect(await demo.windowOf(main)).toMatchObject({
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        defaultSession: true,
    });
    expect(await demo.bridgesOf(main)).toEqual({
        kitAPI: "object",
        electronAPI: "object",
        require: "undefined",
        process: "undefined",
    });
    // The demo's preload reads process.sandboxed, which only a sandboxed renderer sets.
    expect(await main.evaluate(() => window.electronAPI.sandboxed)).toBe(true);
    await expect(main.locator("#kit-api")).toHaveText(/^App version /);
    await expect(main.locator("#sandboxed")).toHaveText("Yes");
});

test("both bridges answer an invoke round trip", async ({ demo }) => {
    const main = await demo.mainWindow();
    const expected = await demo.app.evaluate(({ app }) => ({ version: app.getVersion(), electron: process.versions.electron }));

    expect(await main.evaluate(() => window.kitAPI.getVersion())).toBe(expected.version);
    expect(await main.evaluate(() => window.electronAPI.getElectronVersion())).toBe(expected.electron);
});

test("a window in a partition of its own gets its own preload's bridge and no kitAPI", async ({ demo }) => {
    const main = await demo.mainWindow();
    const isolated = await demo.openIsolatedWindow(main);

    const facts = await demo.windowOf(isolated);
    expect(facts).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, defaultSession: false });
    expect(facts.sessionPreloads).toEqual([]);
    expect(await demo.bridgesOf(isolated)).toEqual({
        kitAPI: "undefined",
        electronAPI: "object",
        require: "undefined",
        process: "undefined",
    });
    // Its own bridge still works there, so the kit's is missing because of the partition, not a broken preload.
    const electron = await demo.app.evaluate(() => process.versions.electron);
    expect(await isolated.evaluate(() => window.electronAPI.getElectronVersion())).toBe(electron);
    await expect(isolated.locator("#kit-api")).toHaveText("Absent");

    // And the main window, opened before it, still has both.
    expect(await demo.bridgesOf(main)).toMatchObject({ kitAPI: "object", electronAPI: "object" });
});

test("the page loads the kit's CSS and page script from node_modules", async ({ demo }) => {
    const main = await demo.mainWindow();
    const loaded = await main.evaluate(() => ({
        css: document.querySelector('link[href*="electron-kit"]').href,
        cssApplied: getComputedStyle(document.documentElement).getPropertyValue("--kit-css").trim(),
        script: document.querySelector('script[src*="electron-kit"]').src,
        kit: typeof window.kit,
    }));

    expect(decodeURIComponent(loaded.css)).toMatch(kitFile(demo.packaged, "css/kit.css"));
    expect(loaded.cssApplied).toBe("1");
    expect(decodeURIComponent(loaded.script)).toMatch(kitFile(demo.packaged, "page/kit.js"));
    expect(loaded.kit).toBe("object");
    await expect(main.locator("#kit-css")).toHaveText("Loaded");
    await expect(main.locator("#kit-js")).toHaveText("Loaded");
});
