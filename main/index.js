"use strict";

// electron-kit's main-process entry, what an app's main.js requires:
//
//     const kit = require("@diamonddigitaldev/electron-kit/main").start({
//         settings: { defaults: SETTINGS_DEFAULTS },     // the app's own settings (and version, migrate)
//         log:      "file",                               // debug.log in userData, redacted
//         credits:  { lines: [...], donate: "https://…" }, // the Credits tab (info.js)
//         menu:     { items: [/* Open Files… */] },       // the app's own menu items
//         updates:  {},                                     // the app updates itself (updater.js)
//     });
//     kit.ipc.handle("job:run", (_event, job) => run(job)); // the app's own channels
//     kit.ready.then(createWindow);
//
// For now start() wires the shared preload (it registers preload.js on the
// app's default session, the UI session, and answers the channels it calls, for
// the app's own page only), keeps the settings, answers the Credits tab and
// opens its links, sets the house menu, pushes each change of the OS theme to
// every window, stops the spell checker's dictionary download, and, with the
// updates option, runs the updater behind Settings > Update (updater.js). It
// answers the app's own channels too, through kit.ipc.handle(), with the same
// check on who's asking as the shared ones. Every option is checked here, so a
// mistake throws at launch. It keeps the app's log, redacted, in debug.log
// with log: "file", or in memory with log: "memory", on disk only while the
// person's keepLogOnDisk setting is on (log.js), and migrates the settings once per version
// (store.js). It takes the single-instance lock, makes the main window with
// its bounds kept (windows.js), and pushes the files the app is opened with to
// its page (instance.js). kit.sessions.isolated() makes a session without the
// kit's bridge, for a window such as a hidden transfer renderer, whose own
// channels kit.ipc.handle() answers there only (sessions.js).

const path = require("path");
const { app, BrowserWindow, session } = require("electron");
const { CHANNELS, INVOKE, PUSH } = require("./channels");
const info = require("./info");
const instance = require("./instance");
const ipc = require("./ipc");
const logging = require("./log");
const menu = require("./menu");
const sessions = require("./sessions");
const shell = require("./shell");
const store = require("./store");
const theme = require("./theme");
const updater = require("./updater");
const version = require("./version");
const windowing = require("./windows");

/** The shared preload, which kit.start() registers on the app's session. */
const PRELOAD_PATH = path.join(__dirname, "..", "preload.js");

/** The id the shared preload is registered under, in every session that has it. */
const PRELOAD_ID = "electron-kit";

let started = false;

/**
 * Register the shared preload on a session, so every window created in it
 * afterwards gets window.kitAPI. Windows that already exist don't.
 * @param {Electron.Session} ses
 * @returns {string} The registration's id.
 */
function registerPreload(ses) {
    if (ses.getPreloadScripts().some((script) => script.id === PRELOAD_ID)) {
        throw new Error("electron-kit's preload is already registered on this session.");
    }
    return ses.registerPreloadScript({ type: "frame", id: PRELOAD_ID, filePath: PRELOAD_PATH });
}

/**
 * Start the kit. Call it once, at the top of main.js, before any window.
 * @param {{
 *   settings?: { defaults?: Record<string, unknown>, version?: number, migrate?: (settings: object, from: number) => object, obsoleteKeys?: string[] },
 *   log?: "file" | "memory" | { mode: "file" | "memory", lines?: number },
 *   singleInstance?: boolean,
 *   files?: boolean,
 *   credits?: { lines?: (string | (string | { text: string, href: string })[])[], donate?: string },
 *   repository?: string,
 *   name?: string,
 *   openExternal?: { allow: string[] },
 *   menu?: { items?: Electron.MenuItemConstructorOptions[] },
 *   updates?: { checkOnLaunch?: boolean } | boolean,
 * }} [config]
 *   updates: the app updates itself, from the update server electron-builder
 *   wrote into it (updater.js). Without it there's no updater. log: "file"
 *   keeps the log in debug.log in userData; "memory" keeps the run's last
 *   lines (1000, or lines) in memory, and in debug.log too only while the
 *   kit's keepLogOnDisk setting is on (log.js); without it, the console
 *   only. settings.version, migrate and obsoleteKeys: the store's migration
 *   (store.js). singleInstance: false lets more than one run (it's one, by
 *   default). files: the app takes files it's opened with (instance.js).
 *   openExternal.allow: the sites the page's links may open on, beside the
 *   links the kit shows from this config; any http(s) link without it
 *   (shell.js).
 * @returns {{
 *   ready: Promise<void>,
 *   settings: { get(): object, set(changes: object): object },
 *   ipc: { handle(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any, options?: { session?: Electron.Session }): void },
 *   sessions: { isolated(name: string, options?: { persist?: boolean }): Electron.Session },
 *   log: { error(...args: unknown[]): void, warn(...args: unknown[]): void, info(...args: unknown[]): void, debug(...args: unknown[]): void, lines(): string[] },
 *   windows: { createMain(options: object): Electron.BrowserWindow, main(): Electron.BrowserWindow | null },
 *   files: { open(paths: string[]): void },
 *   primary: boolean,
 * }}
 *   ready resolves once the app is ready, the shared preload is registered and
 *   the menu set: create windows after it. settings are the app's settings,
 *   for its main process. ipc.handle() answers one of the app's own channels,
 *   for the app's own page only (ipc.js), in the UI session or in the
 *   isolated session given. sessions.isolated() makes a session without the
 *   kit's bridge (sessions.js). log is the app's log, redacted, and its
 *   lines() the banner and the run's last lines (log.js).
 *   windows.createMain() makes the main window (windows.js).
 *   files.open() hands the page files from the app's own menu. primary is
 *   false in a second launch, which is quitting.
 */
function start(config = {}) {
    if (started) throw new Error("kit.start() was called twice.");

    // Every option is checked before anything is registered.
    const { mode, lines } = logging.checkLog(config.log);
    if (config.singleInstance !== undefined && typeof config.singleInstance !== "boolean") throw new Error("kit.start(): singleInstance must be true or false.");
    if (config.files !== undefined && typeof config.files !== "boolean") throw new Error("kit.start(): files must be true or false.");

    // One instance, before anything else: a second launch hands its argv over
    // and quits, and writes nothing. Its log is the console's only, or it
    // would empty the first's debug.log as it started.
    const primary = config.singleInstance === false ? true : instance.takeLock();
    const log = logging.createLog({
        mode: primary ? mode : null,
        dir: mode !== null && primary ? app.getPath("userData") : undefined,
        lines,
        banner: `${config.name ?? app.getName()} ${app.getVersion()} started`,
    });
    const settings = store.createSettings({ ...config.settings, log, memoryLog: mode === "memory" });
    const credits = info.checkInfo({ credits: config.credits, repository: config.repository, name: config.name });
    const openExternal = shell.createOpener({
        allow: shell.checkOpenExternal(config.openExternal),
        // The links the kit itself shows: the credit lines', the donate link, and the repository (its releases too).
        kitLinks: () => {
            const shown = info.appInfo(credits);
            return [...shown.credits.lines.flat().map((part) => part?.href ?? null), shown.credits.donate, shown.repository];
        },
    });
    const updates = updater.createUpdater({ options: updater.checkUpdates(config.updates), app, settings, send: sendUpdateStatus, log });
    const template = menu.menuTemplate({
        items: config.menu?.items,
        version: app.getVersion(),
        checkForUpdates: () => updates.check().catch(() => {}),
    });
    started = true;

    const isolation = sessions.createSessions({ preloadId: PRELOAD_ID });
    let windows = null;
    const files = instance.createFiles({ files: config.files === true, main: () => windows.main(), log });
    windows = windowing.createWindows({ bounds: settings.bounds, onMainCreated: files.mainCreated });
    files.listen({ isPackaged: app.isPackaged, appPath: app.getAppPath() });

    /** Change some settings, from the page or the app's main, and tell the updater. */
    function setSettings(changes) {
        const before = settings.get();
        const after = settings.set(changes);
        updates.settingsChanged(changes, before);
        if (log.mode === "memory" && Object.hasOwn(changes, "keepLogOnDisk")) log.keepOnDisk(after.keepLogOnDisk);
        return after;
    }

    ipc.handle(INVOKE.APP_GET_VERSION, () => app.getVersion());
    ipc.handle(INVOKE.APP_GET_INFO, () => info.appInfo(credits));
    ipc.handle(INVOKE.SETTINGS_GET, () => settings.get());
    ipc.handle(INVOKE.SETTINGS_SET, (_event, changes) => setSettings(changes));
    ipc.handle(INVOKE.SHELL_OPEN_EXTERNAL, (_event, url) => openExternal(url));
    ipc.handle(INVOKE.UPDATE_GET_STATUS, () => updates.status());
    ipc.handle(INVOKE.UPDATE_CHECK, () => updates.check());
    ipc.handle(INVOKE.UPDATE_DOWNLOAD, () => updates.download());
    ipc.handle(INVOKE.UPDATE_INSTALL, () => updates.install());

    // On Linux, Electron's spell checker downloads its dictionaries from
    // Google's servers as each session starts, which tells them the user's
    // address and language, even when every window has spellcheck: false.
    // With no languages, it has nothing to download. This covers the default
    // session and every partition, since it's in place before any is created.
    app.on("session-created", (ses) => ses.setSpellCheckerLanguages([]));

    // The app quits with its last window, bar on macOS, where it stays until it's quit, and
    // makes its main window again when it's activated with none.
    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) windows.reopen();
    });

    // A second launch is quitting: its ready never comes, so the app makes no window there.
    const ready = !primary ? new Promise(() => {}) : app.whenReady().then(() => {
        // The memory log goes on disk only if the person keeps it there; else an earlier run's file is deleted.
        if (log.mode === "memory") log.keepOnDisk(settings.get().keepLogOnDisk);
        registerPreload(session.defaultSession);
        menu.setMenu(template);
        theme.followTheme();
        updates.start();
        // The files the app was launched with, once there's a window for them.
        files.queue(instance.filePathsFromArgv(process.argv, { isPackaged: app.isPackaged, appPath: app.getAppPath() }));
    });
    return {
        ready,
        settings: { get: settings.get, set: setSettings },
        ipc: { handle: (channel, handler, options) => ipc.handleApp(channel, handler, options, isolation.isIsolated) },
        sessions: { isolated: isolation.isolated },
        log: { error: log.error, warn: log.warn, info: log.info, debug: log.debug, lines: log.lines },
        windows: { createMain: windows.createMain, main: windows.main },
        files: { open: files.open },
        primary,
    };
}

/**
 * Push the updater's state to the app's own windows: those in the UI session,
 * where the kit's preload is. A window in another session hears nothing of it.
 * @param {object} status
 */
function sendUpdateStatus(status) {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && win.webContents.session === session.defaultSession) win.webContents.send(PUSH.UPDATE_STATUS, status);
    }
}

module.exports = { start, registerPreload, PRELOAD_PATH, PRELOAD_ID, CHANNELS, MENU_IDS: menu.MENU_IDS, version };
