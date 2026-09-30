"use strict";

// electron-kit's main-process entry, what an app's main.js requires:
//
//     const kit = require("@diamonddigitaldev/electron-kit/main").start({
//         settings: { defaults: SETTINGS_DEFAULTS },     // the app's own settings
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
// mistake throws at launch. The rest of start() (logging, single instance,
// windows) arrives piece by piece.

const path = require("path");
const { app, BrowserWindow, session } = require("electron");
const { CHANNELS, INVOKE, PUSH } = require("./channels");
const info = require("./info");
const ipc = require("./ipc");
const menu = require("./menu");
const shell = require("./shell");
const store = require("./store");
const theme = require("./theme");
const updater = require("./updater");
const version = require("./version");

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
 *   settings?: { defaults?: Record<string, unknown> },
 *   credits?: { lines?: (string | (string | { text: string, href: string })[])[], donate?: string },
 *   repository?: string,
 *   name?: string,
 *   menu?: { items?: Electron.MenuItemConstructorOptions[] },
 *   updates?: { checkOnLaunch?: boolean } | boolean,
 * }} [config]
 *   updates: the app updates itself, from the update server electron-builder
 *   wrote into it (updater.js). Without it there's no updater.
 * @returns {{
 *   ready: Promise<void>,
 *   settings: { get(): object, set(changes: object): object },
 *   ipc: { handle(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any): void },
 * }}
 *   ready resolves once the app is ready, the shared preload is registered and
 *   the menu set: create windows after it. settings are the app's settings,
 *   for its main process. ipc.handle() answers one of the app's own channels,
 *   for the app's own page only (ipc.js).
 */
function start(config = {}) {
    if (started) throw new Error("kit.start() was called twice.");

    // Every option is checked before anything is registered.
    const settings = store.createSettings(config.settings);
    const credits = info.checkInfo({ credits: config.credits, repository: config.repository, name: config.name });
    const template = menu.menuTemplate({ items: config.menu?.items, version: app.getVersion() });
    const updates = updater.createUpdater({ options: updater.checkUpdates(config.updates), app, settings, send: sendUpdateStatus });
    started = true;

    /** Change some settings, from the page or the app's main, and tell the updater. */
    function setSettings(changes) {
        const before = settings.get();
        const after = settings.set(changes);
        updates.settingsChanged(changes, before);
        return after;
    }

    ipc.handle(INVOKE.APP_GET_VERSION, () => app.getVersion());
    ipc.handle(INVOKE.APP_GET_INFO, () => info.appInfo(credits));
    ipc.handle(INVOKE.SETTINGS_GET, () => settings.get());
    ipc.handle(INVOKE.SETTINGS_SET, (_event, changes) => setSettings(changes));
    ipc.handle(INVOKE.SHELL_OPEN_EXTERNAL, (_event, url) => shell.openExternal(url));
    ipc.handle(INVOKE.UPDATE_GET_STATUS, () => updates.status());
    ipc.handle(INVOKE.UPDATE_CHECK, () => updates.check());
    ipc.handle(INVOKE.UPDATE_DOWNLOAD, () => updates.download());

    // On Linux, Electron's spell checker downloads its dictionaries from
    // Google's servers as each session starts, which tells them the user's
    // address and language, even when every window has spellcheck: false.
    // With no languages, it has nothing to download. This covers the default
    // session and every partition, since it's in place before any is created.
    app.on("session-created", (ses) => ses.setSpellCheckerLanguages([]));

    const ready = app.whenReady().then(() => {
        registerPreload(session.defaultSession);
        menu.setMenu(template);
        theme.followTheme();
        updates.start();
    });
    return { ready, settings: { get: settings.get, set: setSettings }, ipc: { handle: ipc.handleApp } };
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
