"use strict";

// The updater (main/updater.js), against the real electron-updater and a local
// update server (helpers/update-server.js): each channel, the saved channel
// winning, never a downgrade, the channel set before allowDowngrade, a
// mis-tagged release refused, both download modes and the dot, no ID of the
// install (the fixed x-user-staging-id, no .updaterId), and no request the app
// didn't ask for. Then how kit.start() wires it: the updates option,
// app.isPackaged, the channels.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createUpdater, checkUpdates, applyChannel, withoutInstallId, checkFailureOf, STAGING_ID, LAUNCH_CHECK_DELAY } = require("../main/updater");
const { createSettings } = require("../main/store");
const { startUpdateServer, realAutoUpdater } = require("./helpers/update-server");
const { loadMain, appPage, fakeAutoUpdater } = require("./helpers/main");
const { INVOKE, PUSH } = require("../main/channels");

/** Settings kept in memory: `data` is what's on disk. */
function memorySettings(stored = {}) {
    const data = { settings: stored };
    const settings = createSettings({
        open: () => ({
            get: (key) => structuredClone(data[key]),
            set: (key, value) => {
                data[key] = structuredClone(value);
            },
        }),
    });
    return { settings, data };
}

/**
 * The kit's updater for an app at `version`, packaged, driving the real
 * electron-updater at an update server holding `channels`. Started, with its
 * launch check scheduled but not run.
 */
async function updaterFor({ version, channels, stored = {}, isPackaged = true, options = { checkOnLaunch: true }, online = true }, t) {
    const server = await startUpdateServer(channels);
    t.after(() => server.close());
    const { autoUpdater, dir } = realAutoUpdater({ version, url: server.url });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { settings, data } = memorySettings(stored);
    const sent = [];
    const scheduled = [];
    const logged = [];
    let loads = 0;
    const updater = createUpdater({
        options,
        app: { isPackaged, getVersion: () => version },
        settings,
        send: (status) => sent.push(status),
        load: () => {
            loads++;
            return autoUpdater;
        },
        schedule: (run, ms) => scheduled.push({ run, ms }),
        log: { warn: (...args) => logged.push(args.join(" ")) },
        isOnline: () => online,
    });
    updater.start();
    return { updater, server, autoUpdater, settings, data, sent, scheduled, logged, dir, loads: () => loads };
}

/** Wait for the updater to reach a state, from its pushes. */
async function reaches(sent, state) {
    for (let i = 0; i < 200; i++) {
        if (sent.at(-1)?.state === state) return sent.at(-1);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(`the updater never reached "${state}"; it's at ${JSON.stringify(sent.at(-1))}`);
}

// -- Channels ---------------------------------------------------------------

test("each channel reads its own file: Stable latest.yml, Beta beta.yml, Alpha alpha.yml", async (t) => {
    const releases = { latest: "2.1.0", beta: "2.2.0-beta.1", alpha: "2.3.0-alpha.1" };
    for (const [channel, file, offered] of [["stable", "latest.yml", "2.1.0"], ["beta", "beta.yml", "2.2.0-beta.1"], ["alpha", "alpha.yml", "2.3.0-alpha.1"]]) {
        const { updater, server } = await updaterFor({ version: "2.0.0", channels: releases, stored: { updateChannel: channel, autoDownloadUpdates: false } }, t);
        const status = await updater.check();
        assert.deepEqual(server.channelFiles(), [file], channel);
        assert.equal(status.state, "available", channel);
        assert.equal(status.version, offered, channel);
    }
});

test("with no channel saved, the running build's own is saved: alpha, beta, or stable for anything else", async (t) => {
    for (const [version, channel] of [["2.0.0-alpha.1", "alpha"], ["2.0.0-beta.2", "beta"], ["2.0.0-rc.1", "stable"], ["2.0.0", "stable"]]) {
        const { updater, server, data } = await updaterFor({ version, channels: {} }, t);
        assert.equal(data.settings.updateChannel, channel, version);
        await updater.check();
        assert.deepEqual(server.channelFiles(), [channel === "stable" ? "latest.yml" : `${channel}.yml`], version);
    }
});

test("the saved channel wins over the build's: a beta user on a finished release stays on Beta, and back", async (t) => {
    for (const [version, saved, file] of [["2.1.0", "beta", "beta.yml"], ["2.1.0-alpha.2", "stable", "latest.yml"], ["2.1.0-beta.1", "alpha", "alpha.yml"]]) {
        const { updater, server, data } = await updaterFor({ version, channels: {}, stored: { updateChannel: saved } }, t);
        await updater.check();
        assert.equal(data.settings.updateChannel, saved, "nothing overwrites the saved channel");
        assert.deepEqual(server.channelFiles(), [file], `${version} on ${saved}`);
    }
});

test("a change of channel checks again, in the new channel", async (t) => {
    const { updater, server, settings } = await updaterFor({ version: "2.0.0", channels: { latest: "2.0.0", beta: "2.1.0-beta.1" }, stored: { updateChannel: "stable", autoDownloadUpdates: false } }, t);
    assert.equal((await updater.check()).state, "none");
    const before = settings.get();
    settings.set({ updateChannel: "beta" });
    updater.settingsChanged({ updateChannel: "beta" }, before);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(server.channelFiles(), ["latest.yml", "beta.yml"]);
    assert.equal(updater.status().state, "available");
    assert.equal(updater.status().version, "2.1.0-beta.1");
});

// -- Never a downgrade, and the order that ensures it -----------------------

test("never a downgrade: an alpha user who moves to Stable keeps the alpha until a newer finished release", async (t) => {
    const { updater, server, autoUpdater } = await updaterFor({ version: "2.1.0-alpha.3", channels: { latest: "2.0.0" }, stored: { updateChannel: "stable" } }, t);
    const refused = [];
    autoUpdater.on("update-not-available", (info) => refused.push(info.version));
    const status = await updater.check();
    assert.equal(status.state, "none");
    assert.equal(status.dot, false);
    // electron-updater itself turned it down: the kit's own check didn't have to.
    assert.deepEqual(refused, ["2.0.0"]);
    assert.deepEqual(server.installers(), []);
});

test("channel is set before allowDowngrade, because electron-updater's channel setter turns downgrades back on", () => {
    const { autoUpdater, dir } = realAutoUpdater({ version: "2.0.0", url: "http://127.0.0.1:9/" });
    fs.rmSync(dir, { recursive: true, force: true });
    // The reason for the order: the real setter, on its own, allows downgrades.
    autoUpdater.allowDowngrade = false;
    autoUpdater.channel = "beta";
    assert.equal(autoUpdater.allowDowngrade, true, "electron-updater's channel setter no longer turns allowDowngrade on; the comment in updater.js can go");

    for (const channel of ["stable", "beta", "alpha"]) {
        applyChannel(autoUpdater, channel);
        assert.equal(autoUpdater.allowDowngrade, false, channel);
        assert.equal(autoUpdater.autoDownload, false, channel);
    }
    assert.deepEqual([autoUpdater.channel, autoUpdater.allowPrerelease], ["alpha", true]);
    applyChannel(autoUpdater, "stable");
    assert.deepEqual([autoUpdater.channel, autoUpdater.allowPrerelease], ["latest", false]);
});

// -- What's offered ---------------------------------------------------------

test("a mis-tagged release is refused: a beta put up as latest never reaches Stable, and nothing downloads", async (t) => {
    const { updater, server, autoUpdater } = await updaterFor({ version: "2.0.0", channels: { latest: "2.1.0-beta.1" }, stored: { updateChannel: "stable" } }, t);
    const libraryOffered = [];
    autoUpdater.on("update-available", (info) => libraryOffered.push(info.version));
    const status = await updater.check();
    // The generic server has no idea it's a beta, so electron-updater offers it: the kit's own check stops it.
    assert.deepEqual(libraryOffered, ["2.1.0-beta.1"]);
    assert.equal(status.state, "none");
    assert.equal(status.version, null);
    assert.deepEqual(server.installers(), [], "nothing is downloaded");
});

test("Beta refuses an alpha, even one put up in beta.yml", async (t) => {
    const { updater } = await updaterFor({ version: "2.0.0", channels: { beta: "2.1.0-alpha.1" }, stored: { updateChannel: "beta" } }, t);
    assert.equal((await updater.check()).state, "none");
});

test("the same version, or an older one, is up to date", async (t) => {
    for (const latest of ["2.0.0", "1.9.9"]) {
        const { updater } = await updaterFor({ version: "2.0.0", channels: { latest }, stored: { updateChannel: "stable" } }, t);
        assert.equal((await updater.check()).state, "none", latest);
    }
});

// -- The two modes ----------------------------------------------------------

test("automatic downloads on (the default): the update downloads at once, with no dot, to be installed on quit", async (t) => {
    const { updater, server, sent, autoUpdater } = await updaterFor({ version: "2.0.0", channels: { latest: "2.1.0" } }, t);
    const checked = await updater.check();
    assert.equal(checked.state, "downloading", "the check is done once the download has started");
    const done = await reaches(sent, "downloaded");
    assert.equal(done.version, "2.1.0");
    assert.equal(done.auto, true, "the page shows the toast");
    assert.equal(done.dot, false);
    assert.deepEqual(server.installers(), ["Kit-Test-Setup-2.1.0.exe"]);
    assert.equal(autoUpdater.autoInstallOnAppQuit, true);
    assert.deepEqual(sent.map((s) => s.state).filter((s, i, all) => s !== all[i - 1]), ["checking", "downloading", "downloaded"]);
    // Downloaded, nothing more is checked.
    assert.equal((await updater.check()).state, "downloaded");
    assert.deepEqual(server.channelFiles(), ["latest.yml"]);
});

test("automatic downloads off: the dot shows and nothing downloads, until Download Update", async (t) => {
    const { updater, server, sent } = await updaterFor({ version: "2.0.0", channels: { latest: "2.1.0" }, stored: { autoDownloadUpdates: false } }, t);
    const found = await updater.check();
    assert.deepEqual([found.state, found.version, found.dot], ["available", "2.1.0", true]);
    assert.deepEqual(server.installers(), []);

    const done = await updater.download();
    assert.deepEqual([done.state, done.auto, done.dot], ["downloaded", false, true], "the dot stays until the new version runs");
    assert.deepEqual(server.installers(), ["Kit-Test-Setup-2.1.0.exe"]);
    assert.ok(sent.some((s) => s.state === "downloading"));
});

test("turning automatic downloads on downloads an update that's waiting", async (t) => {
    const { updater, settings, sent } = await updaterFor({ version: "2.0.0", channels: { latest: "2.1.0" }, stored: { autoDownloadUpdates: false } }, t);
    await updater.check();
    const before = settings.get();
    settings.set({ autoDownloadUpdates: true });
    updater.settingsChanged({ autoDownloadUpdates: true }, before);
    assert.equal((await reaches(sent, "downloaded")).auto, true);
});

test("a failed download says so, and the dot shows, as if the toggle were off", async (t) => {
    const { updater, sent } = await updaterFor({ version: "2.0.0", channels: { latest: { version: "2.1.0", sha512: "wrong" } } }, t);
    await updater.check();
    const failed = await reaches(sent, "error");
    assert.deepEqual([failed.error, failed.dot, failed.auto, failed.version], ["download", true, false, "2.1.0"]);
});

test("a check that fails says so, and a download isn't offered", async (t) => {
    const { updater } = await updaterFor({ version: "2.0.0", channels: {} }, t);
    const status = await updater.check();
    assert.deepEqual([status.state, status.error], ["error", "check"]);
    assert.equal((await updater.download()).state, "error", "there's nothing to download");
});

test("a failed check says why: a release with no update files, a server that's down, or no network", async (t) => {
    // The server is up, but has no latest.yml: a release published without its update files.
    const noFiles = await updaterFor({ version: "2.0.0", channels: {} }, t);
    assert.equal((await noFiles.updater.check()).reason, "no-files");

    // The server refuses: something answered, so the computer isn't offline.
    const down = await updaterFor({ version: "2.0.0", channels: {} }, t);
    await down.server.close();
    assert.equal((await down.updater.check()).reason, "other");

    // Electron says there's no network.
    const offline = await updaterFor({ version: "2.0.0", channels: {}, online: false }, t);
    assert.equal((await offline.updater.check()).reason, "offline");

    // The next check starts afresh.
    const checking = noFiles.updater.check();
    assert.equal(noFiles.updater.status().reason, null);
    await checking;
});

test("checkFailureOf() reads Chromium's and Node's errors, and a refused connection isn't offline", () => {
    const failure = (message, code) => checkFailureOf(Object.assign(new Error(message), code ? { code } : {}));
    assert.equal(failure("net::ERR_INTERNET_DISCONNECTED"), "offline");
    assert.equal(failure("net::ERR_NAME_NOT_RESOLVED"), "offline");
    assert.equal(failure("getaddrinfo ENOTFOUND github.com", "ENOTFOUND"), "offline");
    assert.equal(failure("net::ERR_CONNECTION_REFUSED"), "other");
    assert.equal(failure("connect ECONNREFUSED 127.0.0.1:1", "ECONNREFUSED"), "other");
    assert.equal(failure("HttpError: 403 rate limit exceeded"), "other");
    assert.equal(failure("Cannot find latest.yml", "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"), "no-files");
    assert.equal(checkFailureOf(new Error("anything"), false), "offline", "Electron's own word wins");
    assert.equal(checkFailureOf(undefined), "other");
});

test("a failed check, and a failed download, are logged as one line each: the channel, the reason and the error's first line", async (t) => {
    const check = await updaterFor({ version: "2.0.0", channels: {} }, t);
    await check.updater.check();
    assert.equal(check.logged.length, 1);
    assert.match(check.logged[0], /^Update check failed \(stable channel, no-files\): ERR_UPDATER_CHANNEL_FILE_NOT_FOUND: /);
    assert.doesNotMatch(check.logged[0], /\n/, "no stack");

    const download = await updaterFor({ version: "2.0.0", channels: { latest: { version: "2.1.0", sha512: "wrong" } } }, t);
    await download.updater.check();
    await reaches(download.sent, "error");
    assert.equal(download.logged.length, 1);
    assert.match(download.logged[0], /^Update download failed \(version 2\.1\.0\): /);
    assert.doesNotMatch(download.logged[0], /\n/);
});

test("Download Update does nothing with no update found", async (t) => {
    const { updater, server } = await updaterFor({ version: "2.0.0", channels: { latest: "2.0.0" }, stored: { autoDownloadUpdates: false } }, t);
    assert.equal((await updater.download()).state, "idle");
    await updater.check();
    assert.equal((await updater.download()).state, "none");
    assert.deepEqual(server.installers(), []);
});

test("moving to a channel that wouldn't offer the update downloaded keeps it from installing on quit", async (t) => {
    const { updater, settings, sent, autoUpdater } = await updaterFor({ version: "2.0.0", channels: { beta: "2.1.0-beta.1", latest: "2.0.0" }, stored: { updateChannel: "beta" } }, t);
    await updater.check();
    await reaches(sent, "downloaded");
    const before = settings.get();
    settings.set({ updateChannel: "stable" });
    updater.settingsChanged({ updateChannel: "stable" }, before);
    assert.equal(autoUpdater.autoInstallOnAppQuit, false);
    await reaches(sent, "none");
});

test("two checks at once are one check", async (t) => {
    const { updater, server } = await updaterFor({ version: "2.0.0", channels: { latest: "2.0.0" } }, t);
    const [a, b] = await Promise.all([updater.check(), updater.check()]);
    assert.deepEqual([a.state, b.state], ["none", "none"]);
    assert.deepEqual(server.channelFiles(), ["latest.yml"]);
});

// -- Privacy ----------------------------------------------------------------

test("no ID of the install is made: none is written to userData, and every request sends the fixed one", async (t) => {
    const { updater, server, sent, dir } = await updaterFor({ version: "2.0.0", channels: { latest: "2.1.0" } }, t);
    await updater.check();
    await reaches(sent, "downloaded");
    assert.ok(server.requests.length >= 2);
    for (const request of server.requests) assert.equal(request.headers["x-user-staging-id"], STAGING_ID, request.file);
    assert.equal(fs.existsSync(path.join(dir, ".updaterId")), false, "electron-updater wrote .updaterId");
});

test("left to itself, the same electron-updater writes .updaterId: the test above would see it", async (t) => {
    const server = await startUpdateServer({ latest: "2.0.0" });
    t.after(() => server.close());
    const { autoUpdater, dir } = realAutoUpdater({ version: "2.0.0", url: server.url });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    await autoUpdater.checkForUpdates();
    assert.match(fs.readFileSync(path.join(dir, ".updaterId"), "utf8"), /^[0-9a-f-]{36}$/);
});

test("a staged release is offered to every install, without an ID to place it", async (t) => {
    const { updater, dir } = await updaterFor({ version: "2.0.0", channels: { latest: { version: "2.1.0", stagingPercentage: 0 } }, stored: { autoDownloadUpdates: false } }, t);
    const status = await updater.check();
    assert.equal(status.state, "available");
    assert.equal(status.version, "2.1.0");
    assert.equal(fs.existsSync(path.join(dir, ".updaterId")), false);
});

test("a .updaterId an earlier version wrote is left as it is, and never read or sent", async (t) => {
    const { updater, server, dir } = await updaterFor({ version: "2.0.0", channels: { latest: "2.0.0" } }, t);
    const old = "6f1c2a3b-4d5e-5f60-8a7b-9c0d1e2f3a4b";
    fs.writeFileSync(path.join(dir, ".updaterId"), old);
    await updater.check();
    assert.equal(fs.readFileSync(path.join(dir, ".updaterId"), "utf8"), old);
    assert.ok(server.requests.length >= 1);
    assert.ok(!server.requests.some((r) => Object.values(r.headers).includes(old)));
});

test("withoutInstallId() throws if electron-updater no longer holds the ID in a Lazy, so an upgrade can't quietly write it again", () => {
    assert.throws(() => withoutInstallId({}), /stagingUserIdPromise/);
    assert.throws(() => withoutInstallId({ stagingUserIdPromise: Promise.resolve("x") }), /stagingUserIdPromise/);
});

test("nothing is checked until the app asks: the launch check is scheduled 5 seconds in, and only with checkOnLaunch", async (t) => {
    const on = await updaterFor({ version: "2.0.0", channels: { latest: "2.0.0" } }, t);
    assert.deepEqual(on.server.requests, []);
    assert.deepEqual(on.scheduled.map((s) => s.ms), [LAUNCH_CHECK_DELAY]);
    assert.equal(LAUNCH_CHECK_DELAY, 5000);
    on.scheduled[0].run();
    await reaches(on.sent, "none");
    assert.deepEqual(on.server.channelFiles(), ["latest.yml"]);

    const off = await updaterFor({ version: "2.0.0", channels: { latest: "2.0.0" }, options: { checkOnLaunch: false } }, t);
    assert.deepEqual(off.scheduled, []);
    assert.deepEqual(off.server.requests, []);
});

test("an app run from its source never loads electron-updater, and never checks", async (t) => {
    const { updater, server, loads, scheduled, data } = await updaterFor({ version: "2.0.0-beta.1", channels: { latest: "2.1.0" }, isPackaged: false }, t);
    assert.equal(loads(), 0);
    assert.deepEqual(scheduled, []);
    const status = await updater.check();
    assert.deepEqual([status.state, status.reason], ["unavailable", "not-packaged"]);
    assert.equal((await updater.download()).state, "unavailable");
    assert.deepEqual(server.requests, []);
    assert.equal(data.settings.updateChannel, "beta", "the channel is still saved, so the Update tab shows it");
});

test("without the updates option there's no updater: nothing is loaded, saved or checked", async (t) => {
    const { updater, server, loads, data } = await updaterFor({ version: "2.0.0", channels: { latest: "2.1.0" }, options: null }, t);
    assert.equal(loads(), 0);
    assert.deepEqual([updater.status().state, updater.status().reason], ["unavailable", "off"]);
    assert.equal((await updater.check()).state, "unavailable");
    assert.deepEqual(server.requests, []);
    assert.equal(data.settings.updateChannel, undefined);
});

// -- kit.start() ------------------------------------------------------------

test("the updates option is checked when kit.start() is called", () => {
    assert.equal(checkUpdates(undefined), null);
    assert.equal(checkUpdates(false), null);
    assert.deepEqual(checkUpdates(true), { checkOnLaunch: true });
    assert.deepEqual(checkUpdates({}), { checkOnLaunch: true });
    assert.deepEqual(checkUpdates({ checkOnLaunch: false }), { checkOnLaunch: false });
    for (const [bad, error] of [["yes", /updates must be an object/], [[], /updates must be an object/], [{ feed: "x" }, /updates\.feed isn't an option/], [{ checkOnLaunch: "no" }, /checkOnLaunch must be true or false/]]) {
        assert.throws(() => checkUpdates(bad), error);
    }
    const { main, handlers } = loadMain();
    assert.throws(() => main.start({ updates: { checkOnLaunch: 1 } }), /checkOnLaunch/);
    assert.equal(handlers.size, 0, "nothing is registered");
});

test("kit.start() answers update:get-status, update:check and update:download, for the app's own page only", async () => {
    const { main, handlers, eventFrom } = loadMain({ version: "2.0.0" });
    await main.start({ updates: {} }).ready;
    const page = eventFrom(appPage());
    // Run by plain Node, the stand-in app isn't packaged.
    assert.deepEqual(await handlers.get(INVOKE.UPDATE_GET_STATUS)(page), {
        state: "unavailable", reason: "not-packaged", version: null, tag: null, percent: null, dot: false, auto: false, error: null, current: "2.0.0", channel: "stable",
    });
    assert.equal((await handlers.get(INVOKE.UPDATE_CHECK)(page)).state, "unavailable");
    assert.equal((await handlers.get(INVOKE.UPDATE_DOWNLOAD)(page)).state, "unavailable");
    for (const channel of [INVOKE.UPDATE_GET_STATUS, INVOKE.UPDATE_CHECK, INVOKE.UPDATE_DOWNLOAD]) {
        assert.throws(() => handlers.get(channel)(eventFrom("https://example.com/")), /for the app's own page only/, channel);
    }
});

test("kit.start() without updates has an Update tab with no updater, and saves no channel", async () => {
    const { main, handlers, eventFrom, stored } = loadMain({ version: "2.0.0-beta.1" });
    await main.start().ready;
    const status = await handlers.get(INVOKE.UPDATE_GET_STATUS)(eventFrom(appPage()));
    assert.deepEqual([status.state, status.reason, status.channel], ["unavailable", "off", "beta"]);
    assert.equal(stored.settings, undefined, "nothing is written");
});

test("update:status goes to the app's own windows, in the UI session, and no other", async () => {
    // A stand-in electron-updater, which finds nothing.
    const autoUpdater = fakeAutoUpdater({
        checkForUpdates: async () => ({ isUpdateAvailable: false, updateInfo: { version: "2.0.0" } }),
    });
    const { main, handlers, eventFrom, openWindow, fakeSession, electron } = loadMain({ version: "2.0.0", isPackaged: true, autoUpdater });
    await main.start({ updates: { checkOnLaunch: false } }).ready;
    const ui = openWindow();
    ui.webContents.session = electron.session.defaultSession;
    const other = openWindow();
    other.webContents.session = fakeSession();

    assert.equal((await handlers.get(INVOKE.UPDATE_CHECK)(eventFrom(appPage()))).state, "none");
    assert.deepEqual(ui.sent.map((m) => [m.channel, m.args[0].state]), [[PUSH.UPDATE_STATUS, "checking"], [PUSH.UPDATE_STATUS, "none"]]);
    assert.deepEqual(other.sent, []);
    assert.equal(autoUpdater.requestHeaders["x-user-staging-id"], STAGING_ID);
    assert.equal(autoUpdater.autoInstallOnAppQuit, true);
});

test("a change of channel from the app's main, not only the page, checks again", async () => {
    let checks = 0;
    const autoUpdater = fakeAutoUpdater({
        checkForUpdates: async () => (checks++, { isUpdateAvailable: false, updateInfo: { version: "2.0.0" } }),
    });
    const { main } = loadMain({ version: "2.0.0", isPackaged: true, autoUpdater });
    const kit = main.start({ updates: { checkOnLaunch: false } });
    await kit.ready;
    kit.settings.set({ updateChannel: "beta" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(checks, 1);
    assert.equal(autoUpdater.channel, "beta");
});
