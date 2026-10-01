"use strict";

// The updater: electron-updater, run the house way (the conventions' Updates
// section), behind Settings > Update.
//
//     kit.start({ updates: {} })              // the app updates itself
//     kit.start({ updates: { checkOnLaunch: false } })   // only when asked
//
// Without the updates option there's no updater: nothing is checked, and the
// Update tab says so. With it, and only in a packaged app (app.isPackaged),
// the kit checks 5 seconds after launch, when the app says so (checkOnLaunch,
// on by default), and whenever the page asks (Check for Updates), and never
// otherwise: no request the app didn't ask for. electron-updater itself is
// only loaded then, so an app run from its source never loads it.
//
// The rules, each of which the tests check against the real electron-updater
// and a local update server:
// - The channel is the person's (Settings > Update: Stable, Beta, Alpha). With
//   nothing saved, the running build's own channel is saved when the updater
//   starts; from then on the saved choice wins, whatever version an update
//   brings.
// - electron-updater's channel setter turns allowDowngrade back on, so the
//   channel is set first, and allowDowngrade = false after it.
// - electron-updater never downloads by itself (autoDownload = false). Every
//   update found must pass the kit's own isOfferableUpdate() first: strictly
//   newer, and in the chosen channel. So a mis-tagged release never reaches
//   Stable, and nothing older is ever offered.
// - Then, with "Download updates automatically" on (the default), it's
//   downloaded at once, and the page shows one toast; it's installed when the
//   app quits (autoInstallOnAppQuit). With it off, the update dot shows, and
//   the Update tab offers Download Update. The dot stays until the app runs
//   the new version; it shows too when a download fails.
// - electron-updater sends a random ID of the install with every request
//   (x-user-staging-id), for staged rollouts, which no app on the kit uses.
//   The kit sends a fixed one instead, so update checks can't be linked to one
//   install. electron-updater still keeps its ID in the app's userData folder
//   (.updaterId), but it's never sent.
//
// Every change of state is pushed to the app's own windows as update:status.

const version = require("./version");

/** electron-updater's settings for each channel. */
const CHANNEL_SETTINGS = Object.freeze({
    stable: Object.freeze({ channel: "latest", allowPrerelease: false }),
    beta: Object.freeze({ channel: "beta", allowPrerelease: true }),
    alpha: Object.freeze({ channel: "alpha", allowPrerelease: true }),
});

/** What every update request sends as x-user-staging-id, in place of the install's own ID. */
const STAGING_ID = "00000000-0000-0000-0000-000000000000";

/** How long after launch the launch check runs, so the window is up to show what it finds. */
const LAUNCH_CHECK_DELAY = 5000;

/**
 * Chromium's and Node's errors for a request that found no network to go
 * out on. A refused or reset connection isn't one of them: a server was
 * reached, and said no.
 */
const OFFLINE_ERRORS = /\bnet::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|NETWORK_CHANGED|ADDRESS_UNREACHABLE|CONNECTION_TIMED_OUT|TIMED_OUT)\b|\b(ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH)\b/;

/**
 * Why a check failed, as the Update tab says it:
 * - "offline": the computer has no network (online false), or the request
 *   found none;
 * - "no-files": the release was found, but has no update files for the
 *   channel (electron-updater's ERR_UPDATER_CHANNEL_FILE_NOT_FOUND: a release
 *   published without its latest.yml);
 * - "other": anything else (a server down, a rate limit, a broken feed).
 * @param {unknown} err
 * @param {boolean} [online] - Electron's net.isOnline(), if known
 * @returns {"offline" | "no-files" | "other"}
 */
function checkFailureOf(err, online = true) {
    if (!online) return "offline";
    if (err?.code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND") return "no-files";
    if (OFFLINE_ERRORS.test(`${err?.code ?? ""} ${err?.message ?? ""}`)) return "offline";
    return "other";
}

/**
 * Check kit.start()'s updates option. Throws on a mistake.
 * @param {unknown} updates
 * @returns {{ checkOnLaunch: boolean } | null} null for no updater.
 */
function checkUpdates(updates) {
    if (updates === undefined || updates === false) return null;
    const fail = (message) => {
        throw new Error(`kit.start(): ${message}`);
    };
    if (updates === true) updates = {};
    if (typeof updates !== "object" || updates === null || Array.isArray(updates)) fail("updates must be an object, or true.");
    for (const key of Object.keys(updates)) {
        if (key !== "checkOnLaunch") fail(`updates.${key} isn't an option.`);
    }
    const { checkOnLaunch = true } = updates;
    if (typeof checkOnLaunch !== "boolean") fail("updates.checkOnLaunch must be true or false.");
    return { checkOnLaunch };
}

/**
 * Set electron-updater up for a channel, before a check. The order matters:
 * setting channel turns allowDowngrade back on inside electron-updater.
 * @param {import("electron-updater").AppUpdater} autoUpdater
 * @param {"stable" | "beta" | "alpha"} channel
 */
function applyChannel(autoUpdater, channel) {
    const settings = CHANNEL_SETTINGS[channel];
    autoUpdater.channel = settings.channel;
    autoUpdater.allowPrerelease = settings.allowPrerelease;
    autoUpdater.allowDowngrade = false;
    autoUpdater.autoDownload = false;
    autoUpdater.requestHeaders = { ...autoUpdater.requestHeaders, "x-user-staging-id": STAGING_ID };
}

/**
 * The app's updater.
 * @param {{
 *   options: { checkOnLaunch: boolean } | null,
 *   app: { isPackaged: boolean, getVersion(): string },
 *   settings: { get(): Record<string, any>, set(changes: object): object },
 *   send: (status: object) => void,
 *   load?: () => import("electron-updater").AppUpdater,
 *   schedule?: (run: () => void, ms: number) => void,
 *   log?: { warn(...args: unknown[]): void },
 *   isOnline?: () => boolean,
 * }} deps
 *   options: what checkUpdates() returned. send: pushes a status to the
 *   app's windows. load: electron-updater's autoUpdater, unless a test
 *   stands one in; it's called once, when the updater starts in a packaged
 *   app. schedule: the launch check's timer. log: the kit's log, which
 *   redacts what it writes; a failed check or download is a warning there.
 *   isOnline: whether the computer has a network, after a failed check.
 */
function createUpdater({ options, app, settings, send, load = loadAutoUpdater, schedule = unrefTimeout, log = null, isOnline = electronIsOnline }) {
    const current = app.getVersion();

    /** What the page is told: see status() below. */
    let state = options ? "idle" : "unavailable";
    let reason = options ? null : "off";
    let found = null;
    let percent = null;
    let dot = false;
    let auto = false;
    let error = null;

    let autoUpdater = null;
    let checking = null;

    /**
     * The updater's state, as update:status pushes it and update:get-status
     * answers:
     * - state: "unavailable" (reason: "off", no updater; "not-packaged", run
     *   from source), "idle", "checking", "none" (up to date), "available",
     *   "downloading", "downloaded" or "error" (error: "check" or "download";
     *   a failed check's reason is checkFailureOf()'s);
     * - version: the update found, if any; percent: the download's, 0–100;
     * - dot: whether the update dot shows; auto: whether it downloaded by
     *   itself (the toast shows then).
     */
    function status() {
        return { state, reason, version: found, percent, dot, auto, error, current, channel: channel() };
    }

    function report() {
        send(status());
    }

    /** The saved channel, or the running build's own if none is saved yet. */
    function channel() {
        const saved = settings.get().updateChannel;
        return version.CHANNELS.includes(saved) ? saved : version.channelOf(current);
    }

    /**
     * Start the updater, once the app is ready: save the build's own channel
     * if none is saved, then, packaged, load electron-updater and schedule the
     * launch check.
     */
    function start() {
        if (!options) return;
        if (settings.get().updateChannel === null) settings.set({ updateChannel: version.channelOf(current) });
        if (!app.isPackaged) {
            state = "unavailable";
            reason = "not-packaged";
            return;
        }
        autoUpdater = load();
        autoUpdater.autoInstallOnAppQuit = true;
        // No app on the kit ships a web installer.
        autoUpdater.disableWebInstaller = true;
        autoUpdater.on("download-progress", (progress) => {
            const next = Math.floor(progress.percent);
            if (state === "downloading" && next !== percent) {
                percent = next;
                report();
            }
        });
        if (options.checkOnLaunch) schedule(() => check().catch(() => {}), LAUNCH_CHECK_DELAY);
    }

    /**
     * Check for an update now, in the saved channel. With automatic downloads
     * on, an update found starts downloading. Resolves with the status once
     * the check is done (not the download). While a check is running, it's
     * that check's; while an update downloads or waits to install, there's
     * nothing to check.
     */
    function check() {
        if (!autoUpdater || state === "downloading" || state === "downloaded") return Promise.resolve(status());
        checking ??= runCheck().finally(() => {
            checking = null;
        });
        return checking;
    }

    async function runCheck() {
        const chosen = channel();
        state = "checking";
        error = null;
        reason = null;
        report();
        try {
            applyChannel(autoUpdater, chosen);
            const result = await autoUpdater.checkForUpdates();
            const candidate = result?.isUpdateAvailable ? result.updateInfo?.version : null;
            if (candidate && version.isOfferableUpdate(candidate, current, chosen)) {
                found = candidate;
                state = "available";
                if (settings.get().autoDownloadUpdates) {
                    // Resolves once it's downloaded; the check is done now.
                    download({ automatic: true });
                    return status();
                }
                dot = true;
            } else {
                // Up to date, or what the server has isn't for this channel (a
                // mis-tagged release) or isn't newer: nothing is offered.
                found = null;
                state = "none";
                dot = false;
            }
        } catch (err) {
            state = "error";
            error = "check";
            reason = checkFailureOf(err, isOnline());
            log?.warn(`Update check failed (${chosen} channel, ${reason}): ${messageOf(err)}`);
        }
        report();
        return status();
    }

    /**
     * Download the update found. Resolves with the status once it's
     * downloaded, or has failed. Anything else (nothing found, or a download
     * already running or done) changes nothing.
     * @param {{ automatic?: boolean }} [how] - automatic: the toggle started it, so the toast shows
     */
    function download({ automatic = false } = {}) {
        const canStart = found && (state === "available" || (state === "error" && error === "download"));
        if (!autoUpdater || !canStart) return Promise.resolve(status());
        state = "downloading";
        percent = 0;
        error = null;
        auto = automatic;
        report();
        return autoUpdater.downloadUpdate().then(
            () => {
                state = "downloaded";
                percent = 100;
                report();
                return status();
            },
            (err) => {
                log?.warn(`Update download failed (version ${found}): ${messageOf(err)}`);
                state = "error";
                error = "download";
                percent = null;
                auto = false;
                dot = true;
                report();
                return status();
            },
        );
    }

    /**
     * The settings changed (settings:set). A new channel checks again,
     * dropping an update already downloaded that the new channel wouldn't
     * offer, so it isn't installed on quit. Turning automatic downloads on
     * downloads an update waiting for Download Update.
     * @param {Record<string, unknown>} changes
     * @param {Record<string, any>} before - every setting before the change
     */
    function settingsChanged(changes, before) {
        if (!autoUpdater) return;
        if (Object.hasOwn(changes, "updateChannel") && changes.updateChannel !== before.updateChannel) {
            if (state === "downloaded" && !version.isOfferableUpdate(found, current, changes.updateChannel)) {
                autoUpdater.autoInstallOnAppQuit = false;
                state = "idle";
                found = null;
                percent = null;
                dot = false;
                auto = false;
            }
            if (state === "downloaded") return;
            // A new check, once any check running has finished.
            Promise.resolve(checking).then(() => check()).catch(() => {});
            return;
        }
        if (changes.autoDownloadUpdates === true && before.autoDownloadUpdates !== true && state === "available") {
            download({ automatic: true });
        }
    }

    return { start, check, download, status, settingsChanged };
}

/**
 * An error's code and the first line of its message, for the log:
 * electron-updater puts the whole stack (and a feed's XML) in some messages.
 * @param {unknown} err
 */
function messageOf(err) {
    const first = String(err?.message ?? err ?? "unknown error").split(/\r?\n/, 1)[0].slice(0, 300);
    return err?.code && !first.includes(err.code) ? `${err.code}: ${first}` : first;
}

/** Electron's net.isOnline(); true where it can't say (under plain Node, in the unit tests). */
function electronIsOnline() {
    try {
        return require("electron").net?.isOnline?.() ?? true;
    } catch {
        return true;
    }
}

/** electron-updater's autoUpdater, for this platform. */
function loadAutoUpdater() {
    return require("electron-updater").autoUpdater;
}

/** setTimeout, without keeping the process alive for it. */
function unrefTimeout(run, ms) {
    setTimeout(run, ms).unref?.();
}

module.exports = { createUpdater, checkUpdates, applyChannel, checkFailureOf, CHANNEL_SETTINGS, STAGING_ID, LAUNCH_CHECK_DELAY };
