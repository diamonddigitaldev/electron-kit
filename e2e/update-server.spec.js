"use strict";

// The packaged demo updating from a local update server: the whole path an app
// on the kit takes, in the app electron-builder packed from builder/base.json.
// Its app-update.yml names the server (demo/electron-builder.cjs's publish), the kit
// loads electron-updater from app.asar, and every request goes through
// Electron's own network stack. test/updater.test.js covers the rules in
// detail against the same library under Node; this checks they hold in a
// packaged app, from the Update tab, and that kit.updater.setProxy() sends
// them through a proxy (a local one, test/helpers/proxy.js).
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
const { startProxy, THROUGH } = require("../test/helpers/proxy");
const { STAGING_ID } = require("../main/updater");
const demoBuild = require("../demo/electron-builder.cjs");

test.describe.configure({ mode: "serial" });
test.skip(!process.env.KIT_DEMO_EXECUTABLE, "the updater only runs in a packaged app");

const PORT = Number(new URL(demoBuild.publish.url).port);
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
        expect(fs.existsSync(path.join(demo.profile, ".updaterId")), "no ID of the install in the profile").toBe(false);
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
        expect(fs.existsSync(path.join(demo.profile, ".updaterId")), "no ID of the install in the profile").toBe(false);
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
    // electron-updater's own lines are in the log at debug, so none reaches the terminal: only the kit's one warning.
    const printed = demo.output();
    expect(printed).toContain("Update check failed");
    expect(printed).not.toMatch(/Checking for update|^\s+at /m);
});

// -- Through a proxy ---------------------------------------------------------
//
// kit.updater.setProxy(), from the demo's KIT_DEMO_PROXY (set before the
// updater loads) and from its main process (globalThis.demoKit), with a local
// test proxy that marks what it forwards. The demo adds <-loopback>, so the
// update server on this machine goes through the proxy too. The proxies'
// ports are fixed, as the launch names them.

const PROXY_PORT = PORT + 1;
const SECOND_PROXY_PORT = PORT + 2;
/** A port nothing listens on. */
const CLOSED_PORT = PORT + 3;

/** Give the demo's updater a proxy from its main process, or null for the launch's settings. */
const setProxy = (demo, proxyRules) => demo.app.evaluate((_electron, proxyRules) => globalThis.demoKit.updater.setProxy(proxyRules === null ? null : { proxyRules, proxyBypassRules: "<-loopback>" }), proxyRules);

/** The requests the server had that came through the test proxy, and those that didn't. */
const throughProxy = (server) => server.requests.filter((r) => r.headers[THROUGH] === "1").map((r) => r.file);
const straight = (server) => server.requests.filter((r) => r.headers[THROUGH] === undefined).map((r) => r.file);

test.describe("through a proxy", () => {
    test.use({ demoEnv: { KIT_DEMO_PROXY: `http://127.0.0.1:${PROXY_PORT}` } });

    test("every request of a check and a download goes through the proxy the app set before the updater loaded", async ({ demo }) => {
        const proxy = await startProxy({ port: PROXY_PORT });
        const server = await serve({ latest: "0.0.1" });
        try {
            const main = await demo.mainWindow();
            const pane = await openUpdate(main);
            await pane.getByRole("button", { name: "Check for Updates" }).click();
            await expect(pane.getByRole("status")).toHaveText("Version 0.0.1 has downloaded and will be installed when you close electron-kit Demo.", { timeout: 30_000 });
            expect(server.channelFiles()).toEqual(["latest.yml"]);
            expect(server.installers()).toEqual([`Kit-Test-Setup-0.0.1.${EXT}`]);
            expect(straight(server), "requests that went straight to the server").toEqual([]);
            expect(proxy.requests.map((r) => decodeURIComponent(new URL(r.url).pathname.slice(1)))).toEqual(throughProxy(server));
            await keepFromInstalling(demo);
        } finally {
            await server.close();
            await proxy.close();
        }
    });

    test("null goes back to the launch's settings (the tests' --no-proxy-server, so no search for one): the check goes straight to the server", async ({ demo }) => {
        const proxy = await startProxy({ port: PROXY_PORT });
        const server = await serve({ latest: "0.0.0" });
        try {
            const main = await demo.mainWindow();
            await setProxy(demo, null);
            const pane = await openUpdate(main);
            await pane.getByRole("button", { name: "Check for Updates" }).click();
            await expect(pane.getByRole("status")).toHaveText("You're up to date.");
            expect(server.channelFiles()).toEqual(["latest.yml"]);
            expect(throughProxy(server), "requests that went through the proxy").toEqual([]);
            expect(proxy.requests).toEqual([]);
        } finally {
            await server.close();
            await proxy.close();
        }
    });

    test("a change mid-download fails it, saying so, and Download Update tries again through the new proxy", async ({ demo }) => {
        const proxy = await startProxy({ port: PROXY_PORT });
        const second = await startProxy({ port: SECOND_PROXY_PORT });
        const server = await serve({ latest: "0.0.1" });
        try {
            const main = await demo.mainWindow();
            const pane = await openUpdate(main);
            await pane.getByRole("switch", { name: "Download updates automatically" }).click();
            await expect.poll(() => main.evaluate(() => window.kitAPI.getSettings().then((s) => s.autoDownloadUpdates))).toBe(false);
            await pane.getByRole("button", { name: "Check for Updates" }).click();
            await expect(pane.getByRole("status")).toHaveText("Version 0.0.1 is available.");

            // Half the installer, then the proxy changes under it.
            server.hold(true);
            await pane.getByRole("button", { name: "Download Update" }).click();
            await expect.poll(() => server.installers()).toEqual([`Kit-Test-Setup-0.0.1.${EXT}`]);
            await setProxy(demo, second.rules);
            await expect(pane.getByRole("status")).toHaveText("Version 0.0.1 couldn't be downloaded.", { timeout: 30_000 });
            await expect(main.locator(".update-dot:visible")).toHaveCount(2);
            expect(second.requests, "nothing starts again by itself").toEqual([]);

            server.hold(false);
            await pane.getByRole("button", { name: "Download Update" }).click();
            await expect(pane.getByRole("status")).toHaveText("Version 0.0.1 has downloaded and will be installed when you close electron-kit Demo.", { timeout: 30_000 });
            // Through the new proxy (with the blockmap, beside the part already downloaded), and nothing straight.
            expect(second.requests.map((r) => new URL(r.url).pathname)).toContain(`/Kit-Test-Setup-0.0.1.${EXT}`);
            expect(straight(server)).toEqual([]);
            await keepFromInstalling(demo);
        } finally {
            await server.close();
            await second.close();
            await proxy.close();
        }
    });
});

test.describe("through a proxy that isn't there", () => {
    test.use({ demoEnv: { KIT_DEMO_PROXY: `http://127.0.0.1:${CLOSED_PORT}` } });

    test("the check fails and says so, and nothing reaches the server", async ({ demo }) => {
        const server = await serve({ latest: "0.0.1" });
        try {
            const main = await demo.mainWindow();
            const pane = await openUpdate(main);
            await pane.getByRole("button", { name: "Check for Updates" }).click();
            await expect(pane.getByRole("status")).toHaveText("Couldn't check for updates. Try again later.", { timeout: 30_000 });
            await expect(pane.getByRole("button", { name: "Check for Updates" })).toBeEnabled();
            expect(server.requests, "Chromium went around the proxy").toEqual([]);
        } finally {
            await server.close();
        }
    });
});
