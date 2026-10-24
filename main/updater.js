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
// - electron-updater makes a random ID of the install on its first check,
//   keeps it in the app's userData folder (.updaterId), sends it with every
//   request (x-user-staging-id) and uses it to place the install in a staged
//   rollout, which no app on the kit uses. The kit gives it a fixed ID before
//   it can make one, so none is made, written or sent, and every install is
//   in every rollout. A .updaterId an earlier version wrote (an app before it
//   took the kit) is deleted as the updater starts: it's an ID of the install,
//   kept for nothing.
// - The app can send every request through a proxy (kit.updater.setProxy()),
//   on electron-updater's own session, which the kit reaches through its
//   netSession and never makes itself: a partition's options apply only where
//   it's first made, and electron-updater makes it without a cache. A proxy
//   set before electron-updater loads is kept, and applied before any check;
//   null goes back to the launch's (the system's settings, or none with
//   --no-proxy-server). A change closes the session's connections and
//   cancels a download under way (Chromium lets a request already answering
//   finish on its old route), so a download it cuts fails and says so, as
//   any network failure; nothing starts again by itself.
//
// Every change of state is pushed to the app's own windows as update:status.

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const version = require("./version");

/** electron-updater's settings for each channel. */
const CHANNEL_SETTINGS = Object.freeze({
    stable: Object.freeze({ channel: "latest", allowPrerelease: false }),
    beta: Object.freeze({ channel: "beta", allowPrerelease: true }),
    alpha: Object.freeze({ channel: "alpha", allowPrerelease: true }),
});

/** The ID electron-updater is given in place of making one: what every update request sends as x-user-staging-id. */
const STAGING_ID = "00000000-0000-0000-0000-000000000000";

/**
 * How long after launch the launch check runs, so the window is up to show
 * what it finds. Settings > Update, opened sooner, runs it then (pending).
 */
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
 * Check what kit.updater.setProxy() is given. Throws on a mistake.
 * @param {unknown} config - { proxyRules, proxyBypassRules? }, Electron's own
 *   strings, or null for the system's proxy settings
 * @returns {{ mode: "fixed_servers", proxyRules: string, proxyBypassRules?: string } | { mode: "system" }}
 *   what electron-updater's session is given (session.setProxy())
 */
function checkProxy(config) {
    if (config === null) return { mode: "system" };
    const fail = (message) => {
        throw new Error(`kit.updater.setProxy(): ${message}`);
    };
    if (typeof config !== "object" || Array.isArray(config)) fail("takes { proxyRules, proxyBypassRules }, or null for the system's proxy settings.");
    for (const key of Object.keys(config)) {
        if (key !== "proxyRules" && key !== "proxyBypassRules") fail(`${key} isn't an option.`);
    }
    const { proxyRules, proxyBypassRules } = config;
    if (typeof proxyRules !== "string" || proxyRules.trim() === "") fail("proxyRules must be a string, such as \"socks5://127.0.0.1:1080\".");
    if (proxyBypassRules !== undefined && typeof proxyBypassRules !== "string") fail("proxyBypassRules must be a string, such as \"<-loopback>\".");
    return { mode: "fixed_servers", proxyRules, ...(proxyBypassRules === undefined ? {} : { proxyBypassRules }) };
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
 * Keep electron-updater from making an ID of the install, once, before its
 * first check. Its stagingUserIdPromise is a lazy-val Lazy whose creator reads
 * .updaterId from userData, or makes a random ID and writes it there; setting
 * the Lazy's value resolves it without running the creator, so neither the
 * request header nor the rollout check ever reaches the file. With no staged
 * rollouts, every install is in every release (isUserWithinRollout, public).
 * Throws if electron-updater no longer has the Lazy, so an upgrade that moves
 * it fails the tests rather than writing the file again.
 * @param {import("electron-updater").AppUpdater} autoUpdater
 */
function withoutInstallId(autoUpdater) {
    const lazy = autoUpdater.stagingUserIdPromise;
    if (!lazy || typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(lazy), "value")?.set !== "function") {
        throw new Error("electron-updater has no stagingUserIdPromise to set: the kit can't keep it from writing .updaterId.");
    }
    lazy.value = Promise.resolve(STAGING_ID);
    autoUpdater.isUserWithinRollout = () => true;
}

/**
 * Delete the ID of the install an earlier version of the app let
 * electron-updater keep: .updaterId, in the userData folder electron-updater
 * reads it from. Nothing reads it now, but it's an identifier left on disk.
 * @param {import("electron-updater").AppUpdater} autoUpdater
 * @param {{ info?(...args: unknown[]): void, warn(...args: unknown[]): void }} [log]
 */
function deleteOldInstallId(autoUpdater, log) {
    const dir = autoUpdater.app?.userDataPath;
    if (typeof dir !== "string" || dir === "") return;
    const file = path.join(dir, ".updaterId");
    try {
        if (!fs.existsSync(file)) return;
        fs.rmSync(file, { force: true });
        log?.info?.("Deleted the ID of the install an earlier version kept for update checks (.updaterId).");
    } catch (err) {
        log?.warn("Couldn't delete the ID of the install an earlier version kept for update checks (.updaterId):", err);
    }
}

/**
 * The app's updater.
 * @param {{
 *   options: { checkOnLaunch: boolean } | null,
 *   app: { isPackaged: boolean, getVersion(): string, commandLine?: { hasSwitch(name: string): boolean } },
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
 *   redacts what it writes; a failed check or download is a warning there,
 *   and electron-updater's own lines go there too (updaterLogger()).
 *   isOnline: whether the computer has a network, after a failed check.
 */
function createUpdater({ options, app, settings, send, load = loadAutoUpdater, schedule = unrefTimeout, log = null, isOnline = electronIsOnline }) {
    const current = app.getVersion();

    /** What the page is told: see status() below. */
    let state = options ? "idle" : "unavailable";
    let reason = options ? null : "off";
    let found = null;
    let tag = null;
    let percent = null;
    let dot = false;
    let auto = false;
    let error = null;
    let pending = false;

    let autoUpdater = null;
    let checking = null;

    /** The proxy the app last asked for, kept until electron-updater loads (undefined: never asked). */
    let proxy;
    /** The proxies being applied, in order: a check or download waits for them. Never rejects. */
    let applying = Promise.resolve();
    /** The download under way's cancellation token, which a change of proxy cancels. */
    let downloading = null;

    /**
     * The updater's state, as update:status pushes it and update:get-status
     * answers:
     * - state: "unavailable" (reason: "off", no updater; "not-packaged", run
     *   from source), "idle", "checking", "none" (up to date), "available",
     *   "downloading", "downloaded" or "error" (error: "check" or "download";
     *   a failed check's reason is checkFailureOf()'s);
     * - version: the update found, if any, and tag, its release's tag where
     *   the server has one (GitHub); percent: the download's, 0–100;
     * - dot: whether the update dot shows; auto: whether it downloaded by
     *   itself (the toast shows then);
     * - pending: whether the launch check is still waiting to run (the
     *   Update tab runs it at once when it's opened first).
     */
    function status() {
        return { state, reason, version: found, tag, percent, dot, auto, error, pending, current, channel: channel() };
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
        autoUpdater.logger = updaterLogger(log);
        withoutInstallId(autoUpdater);
        deleteOldInstallId(autoUpdater, log);
        autoUpdater.autoInstallOnAppQuit = true;
        // No app on the kit ships a web installer.
        autoUpdater.disableWebInstaller = true;
        if (proxy !== undefined) queueProxy(proxy).catch(() => {});
        autoUpdater.on("download-progress", (progress) => {
            const next = Math.floor(progress.percent);
            if (state === "downloading" && next !== percent) {
                percent = next;
                report();
            }
        });
        if (options.checkOnLaunch) {
            pending = true;
            // Unless a check has run since: the page's, or the Update tab's at once.
            schedule(() => pending && check().catch(() => {}), LAUNCH_CHECK_DELAY);
        }
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
        pending = false;
        error = null;
        reason = null;
        report();
        try {
            await applying;
            applyChannel(autoUpdater, chosen);
            const result = await autoUpdater.checkForUpdates();
            const candidate = result?.isUpdateAvailable ? result.updateInfo?.version : null;
            if (candidate && version.isOfferableUpdate(candidate, current, chosen)) {
                found = candidate;
                // The release's tag, where the server has one (GitHub): the Update tab links to its page.
                tag = typeof result.updateInfo.tag === "string" ? result.updateInfo.tag : null;
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
                tag = null;
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
        let token = null;
        return applying.then(() => {
            token = downloading = newCancellationToken();
            return autoUpdater.downloadUpdate(token);
        }).finally(() => {
            if (downloading === token) downloading = null;
        }).then(
            () => {
                state = "downloaded";
                percent = 100;
                report();
                return status();
            },
            (err) => {
                log?.warn(`Update download failed (version ${found}): ${token?.cancelled ? "the proxy changed under it" : messageOf(err)}`);
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
     * Install the update downloaded, now (Restart Now): the app quits, the
     * installer runs silently, as it would on quit, and the new version starts.
     * Anything but a downloaded update changes nothing. If the installer can't
     * be started, it's one warning in the log, and the update still waits for
     * the app to close. The page asks first when the app says it's busy.
     * @returns {Promise<object>} the status
     */
    function install() {
        if (!autoUpdater || state !== "downloaded") return Promise.resolve(status());
        autoUpdater.quitAndInstall(true, true);
        // electron-updater sets this while the install goes ahead, and clears it if the installer couldn't start.
        if (autoUpdater.quitAndInstallCalled === false) log?.warn(`Update install failed (version ${found}): the installer couldn't be started.`);
        return Promise.resolve(status());
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
                tag = null;
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

    /**
     * Send every update request through a proxy, or back the way the app
     * was launched with null (kit.updater.setProxy()): the system's proxy
     * settings, or none when it was launched with --no-proxy-server, as an
     * app's tests launch it (testing's netLogSwitches()), since the
     * system's can look for a proxy on the network (WPAD). Resolves
     * once electron-updater's session has it and its connections are closed,
     * or at once while electron-updater isn't loaded: run from source, with
     * no updates option, or before the app is ready, when it's kept and
     * applied as the updater starts. Calls apply in order.
     * @param {{ proxyRules: string, proxyBypassRules?: string } | null} config
     * @returns {Promise<void>}
     */
    function setProxy(config) {
        proxy = checkProxy(config);
        if (proxy.mode === "system" && app.commandLine?.hasSwitch("no-proxy-server")) proxy = { mode: "direct" };
        if (!autoUpdater) return Promise.resolve();
        return queueProxy(proxy);
    }

    /** Apply a proxy to electron-updater's session after any before it, then close its connections. */
    function queueProxy(settings) {
        const run = applying.then(async () => {
            const session = autoUpdater.netSession;
            await session.setProxy(settings);
            await session.closeAllConnections();
            // A request already being answered keeps its connection and its old route, so a download is cancelled.
            downloading?.cancel();
        });
        applying = run.catch((err) => {
            log?.warn(`Couldn't set the proxy for update checks: ${messageOf(err)}`);
        });
        return run;
    }

    return { start, check, download, install, status, settingsChanged, setProxy };
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

/**
 * electron-updater's logger: the kit's log, never the console. Its info lines
 * and its error dumps (the response's headers, a stack) are detail for a bug
 * report, at debug; its warnings are warnings. The log redacts every line.
 * The kit's own one-line warning for a failed check, download or install
 * stays the record a person sees. With no log, electron-updater says nothing.
 * @param {{ warn(...args: unknown[]): void, debug?(...args: unknown[]): void } | null} log
 */
function updaterLogger(log) {
    if (!log) return null;
    const detail = (...args) => log.debug?.("electron-updater:", ...args);
    return { info: detail, debug: detail, error: detail, warn: (...args) => log.warn("electron-updater:", ...args) };
}

/**
 * A cancellation token for a download, from the builder-util-runtime
 * electron-updater itself uses (it doesn't hand its CancellationToken on).
 */
function newCancellationToken() {
    const { CancellationToken } = createRequire(require.resolve("electron-updater"))("builder-util-runtime");
    return new CancellationToken();
}

/** electron-updater's autoUpdater, for this platform. */
function loadAutoUpdater() {
    return require("electron-updater").autoUpdater;
}

/** setTimeout, without keeping the process alive for it. */
function unrefTimeout(run, ms) {
    setTimeout(run, ms).unref?.();
}

module.exports = { createUpdater, checkUpdates, checkProxy, applyChannel, withoutInstallId, checkFailureOf, updaterLogger, CHANNEL_SETTINGS, STAGING_ID, LAUNCH_CHECK_DELAY };
