"use strict";

// The packaged demo updating from a local update server: the whole path an app
// on the kit takes, in the app electron-builder packed from builder/base.json.
// Its app-update.yml names the server (demo/package.json's publish), the kit
// loads electron-updater from app.asar, and every request goes through
// Electron's own network stack. test/updater.test.js covers the rules in
// detail against the same library under Node; this checks they hold in a
// packaged app, from the Update tab.
//
// Run from source, the updater never checks, so these run against a packaged
// build only (KIT_DEMO_EXECUTABLE). The server's port is fixed by the build,
// so the tests take turns. electron-updater keeps what it downloads in the
// user's cache folder, not the app's profile, so each test starts it empty
// and the last leaves it gone; and nothing downloaded is installed: each test
// turns install-on-quit off before the demo closes, once it has checked it
// was on, so a made-up installer never runs.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect } = require("./helpers/demo");
const { startUpdateServer } = require("../test/helpers/update-server");
const { STAGING_ID } = require("../main/updater");
const demoPackage = require("../demo/package.json");

test.describe.configure({ mode: "serial" });
test.skip(!process.env.KIT_DEMO_EXECUTABLE, "the updater only runs in a packaged app");

const PORT = Number(new URL(demoPackage.build.publish.url).port);
const EXT = process.platform === "win32" ? "exe" : "AppImage";

/** Where electron-updater keeps its downloads for the demo (its getAppCacheDir(), then app-update.yml's folder name). */
const CACHE = path.join(
    process.platform === "win32" ? process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local") : process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
    "electron-kit-demo-updater",
);

test.beforeEach(() => fs.rmSync(CACHE, { recursive: true, force: true }));
test.afterAll(() => fs.rmSync(CACHE, { recursive: true, force: true }));

/** An update server on the demo's port. */
async function serve(channels) {
    const server = await startUpdateServer(channels, { port: PORT, ext: EXT });
    return server;
}

/** Settings > Update, open. */
async function openUpdate(main) {
    await main.getByRole("button", { name: "Settings", exact: true }).click();
    await main.getByRole("tab", { name: /^Update/ }).click();
    return main.getByRole("tabpanel", { name: /^Update/ });
}

/** Check install-on-quit was on, then turn it off, so the made-up installer isn't run when the demo closes. */
async function keepFromInstalling(demo) {
    const was = await demo.app.evaluate(({ app }) => {
        // The app's own electron-updater, the one the kit loaded, from inside app.asar.
        const { createRequire } = process.mainModule.constructor;
        const { autoUpdater } = createRequire(`${app.getAppPath()}/package.json`)("electron-updater");
        const on = autoUpdater.autoInstallOnAppQuit;
        autoUpdater.autoInstallOnAppQuit = false;
        return on;
    });
    expect(was, "an update downloaded is installed when the app quits").toBe(true);
}

test("automatic downloads off: Check for Updates finds it, the dot shows, and Download Update downloads it", async ({ demo }) => {
    const server = await serve({ latest: "0.0.1" });
    try {
        const main = await demo.mainWindow();
        const pane = await openUpdate(main);
        await pane.getByRole("switch", { name: "Download updates automatically" }).click();
        await expect.poll(() => main.evaluate(() => window.kitAPI.getSettings().then((s) => s.autoDownloadUpdates))).toBe(false);
        expect(server.requests, "nothing is checked until asked").toEqual([]);

        await pane.getByRole("button", { name: "Check for Updates" }).click();
        await expect(pane.getByRole("status")).toHaveText("Version 0.0.1 is available.");
        await expect(main.locator(".update-dot:visible")).toHaveCount(2);
        expect(server.channelFiles()).toEqual(["latest.yml"]);
        expect(server.installers()).toEqual([]);

        await pane.getByRole("button", { name: "Download Update" }).click();
        await expect(pane.getByRole("status")).toHaveText("Version 0.0.1 has downloaded and will be installed when you close electron-kit Demo.", { timeout: 30_000 });
        expect(server.installers()).toEqual([`Kit-Test-Setup-0.0.1.${EXT}`]);
        await expect(main.locator(".update-dot:visible"), "the dot stays until the new version runs").toHaveCount(2);
        await expect(main.locator("#toast-host .toast-note")).toHaveCount(0);
        for (const request of server.requests) expect(request.headers["x-user-staging-id"], request.file).toBe(STAGING_ID);
        await keepFromInstalling(demo);
    } finally {
        await server.close();
    }
});

test("automatic downloads on: a new channel checks its own file, downloads what it finds, and one toast says so", async ({ demo }) => {
    const server = await serve({ latest: "0.0.0", beta: "0.0.1-beta.1" });
    try {
        const main = await demo.mainWindow();
        const pane = await openUpdate(main);
        await pane.getByRole("combobox", { name: "Update channel" }).selectOption("beta");

        await expect(pane.getByRole("status")).toHaveText("Version 0.0.1-beta.1 has downloaded and will be installed when you close electron-kit Demo.", { timeout: 30_000 });
        expect(server.channelFiles()).toEqual(["beta.yml"]);
        expect(server.installers()).toEqual([`Kit-Test-Setup-0.0.1-beta.1.${EXT}`]);
        await expect(main.locator("#toast-host .toast-body")).toHaveText(["Version 0.0.1-beta.1 has downloaded and will be installed when you close electron-kit Demo."]);
        await expect(main.locator(".update-dot:visible")).toHaveCount(0);
        await keepFromInstalling(demo);
    } finally {
        await server.close();
    }
});

test("a pre-release put up as the latest release is refused on Stable, and nothing is downloaded", async ({ demo }) => {
    const server = await serve({ latest: "0.0.2-beta.1" });
    try {
        const main = await demo.mainWindow();
        const pane = await openUpdate(main);
        await pane.getByRole("button", { name: "Check for Updates" }).click();
        await expect(pane.getByRole("status")).toHaveText("You're up to date.");
        expect(server.channelFiles()).toEqual(["latest.yml"]);
        expect(server.installers()).toEqual([]);
        await expect(main.locator(".update-dot:visible")).toHaveCount(0);
    } finally {
        await server.close();
    }
});

test("with no update server, the check says it couldn't, and nothing else is asked", async ({ demo }) => {
    const main = await demo.mainWindow();
    const pane = await openUpdate(main);
    await pane.getByRole("button", { name: "Check for Updates" }).click();
    await expect(pane.getByRole("status")).toHaveText("Couldn't check for updates. Try again later.", { timeout: 30_000 });
    await expect(pane.getByRole("button", { name: "Check for Updates" })).toBeEnabled();
});
