"use strict";

// One instance of the app, and the files it's asked to open, as File
// Converter does it:
//
// - on Windows, the app's user model ID: the app's build.appId, which the
//   installer gives its Start menu shortcut, so its windows group under its
//   pinned taskbar icon and Windows shows its notifications (both need the two
//   to match). Without one, the app's name;
// - the single-instance lock, taken in start(), before any window: a second
//   launch hands its argv to the first and quits. The first restores and
//   focuses its main window (windows.js);
// - with start({ files: true }), the files it's opened with: from its own
//   argv, from a second launch's (Windows starts one process per file when
//   several are opened from Explorer), from macOS's open-file, and from the
//   app's own menu (kit.files.open()). Arrivals are gathered for 500 ms and
//   pushed to the main window's page as one files:opened, once its page has
//   loaded (did-finish-load): none is lost to a page still loading. A launch
//   with one of the app's own switches (start({ files: { except } }), such as
//   Dropgate's --upload) is the app's to handle, so its files aren't taken.
//
// A path from argv is kept only if it isn't a switch, isn't the app itself,
// and is something on disk. The log says how many files were opened, never
// which: a file's name can say as much about a person as its folder.

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { PUSH } = require("./channels");

/** How long arrivals are gathered before they're pushed as one. */
const FILES_BATCH_MS = 500;

/**
 * The files in an argv: past the executable (and, run from source, the app's
 * own folder), not a switch, and on disk.
 * @param {string[]} argv
 * @param {{ isPackaged: boolean, appPath: string, exists?: (p: string) => boolean }} context
 */
function filePathsFromArgv(argv, { isPackaged, appPath, exists = fs.existsSync }) {
    const own = path.resolve(appPath);
    return argv.slice(1).filter((arg) => {
        if (typeof arg !== "string" || arg === "" || arg.startsWith("-")) return false;
        // Run from source, the app's folder (or ".") is in argv too.
        if (!isPackaged && (arg === "." || path.resolve(arg) === own)) return false;
        try {
            return exists(arg);
        } catch {
            return false;
        }
    });
}

/**
 * Check start()'s files: true, or { except }, the switches that mark a launch
 * as the app's own to handle ("--upload"). Returns them, or null for no files.
 * @param {unknown} files
 * @returns {string[] | null}
 */
function checkFiles(files) {
    if (files === undefined || files === false) return null;
    if (files === true) return [];
    if (files !== null && typeof files === "object" && !Array.isArray(files)) {
        for (const key of Object.keys(files)) {
            if (key !== "except") throw new Error(`kit.start(): files.${key} isn't an option. It takes except.`);
        }
        const except = files.except ?? [];
        if (!Array.isArray(except) || !except.every((arg) => typeof arg === "string" && /^--[a-z0-9][a-z0-9-]*$/.test(arg))) {
            throw new Error("kit.start(): files.except must be switches, such as [\"--upload\"].");
        }
        return [...except];
    }
    throw new Error("kit.start(): files must be true or false, or { except: [switches] }.");
}

/**
 * Check start()'s appId: the app's build.appId, such as
 * "com.diamonddigitaldev.dropgateclient", or left out.
 * @param {unknown} appId
 */
function checkAppId(appId) {
    if (appId !== undefined && (typeof appId !== "string" || !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(appId))) {
        throw new Error("kit.start(): appId must be the app's build.appId, such as \"com.diamonddigitaldev.app\".");
    }
}

/**
 * On Windows, set the app's user model ID: its build.appId, the one its Start
 * menu shortcut carries, or else its name.
 * @param {string} [appId]
 */
function setAppId(appId) {
    if (process.platform === "win32") app.setAppUserModelId(appId ?? app.getName());
}

/**
 * Take the single-instance lock, before any window. Returns whether this is
 * the first instance; a second has handed its argv on, and quits.
 */
function takeLock() {
    const first = app.requestSingleInstanceLock();
    if (!first) app.quit();
    return first;
}

/**
 * The files the app is asked to open, pushed to its main window's page.
 * @param {{ files: boolean, except?: string[], main: () => Electron.BrowserWindow | null, log?: { info(...args: unknown[]): void } }} options
 *   files: whether the app takes files at all. except: the switches that make
 *   a launch the app's own to handle. main: its main window, or null.
 */
function createFiles({ files, except = [], main, log }) {
    let pending = [];
    let timer = null;
    // The page of each main window that has loaded. Not webContents.isLoading(): that can still be true in
    // did-finish-load (the page's fonts, fetched after it), and then neither the timer nor did-finish-load
    // would push the files, and they'd wait for ever.
    const loaded = new WeakSet();

    /** Push what's gathered, if the main window's page can take it; else keep it for its did-finish-load. */
    function flush() {
        const win = main();
        if (pending.length === 0 || !win || !loaded.has(win.webContents)) return;
        const batch = pending;
        pending = [];
        log?.info(`Opening ${batch.length === 1 ? "1 file" : `${batch.length} files`}.`);
        win.webContents.send(PUSH.FILES_OPENED, batch);
    }

    /** Whether a launch's argv is the app's own to handle: it holds one of the except switches. */
    function isAppsOwn(argv) {
        return argv.some((arg) => except.includes(arg));
    }

    /** Gather some paths, and push them all 500 ms after the last arrives. */
    function queue(paths) {
        if (!files) return;
        const usable = paths.filter((p) => typeof p === "string" && p !== "" && !p.startsWith("-"));
        if (usable.length === 0) return;
        pending.push(...usable);
        clearTimeout(timer);
        timer = setTimeout(flush, FILES_BATCH_MS);
    }

    /**
     * Hand some paths to the page now (the app's own Open Files): no wait,
     * but after any still being gathered, so they arrive in order.
     * @param {string[]} paths
     */
    function open(paths) {
        if (!files) throw new Error("kit.files.open(): start() wasn't given files: true.");
        if (!Array.isArray(paths) || !paths.every((p) => typeof p === "string" && p !== "")) throw new Error("kit.files.open(): paths must be a list of paths.");
        if (paths.length === 0) return;
        pending.push(...paths);
        clearTimeout(timer);
        flush();
    }

    /** Wire the app's events: a second launch, macOS's open-file. */
    function listen({ isPackaged, appPath }) {
        app.on("second-instance", (_event, argv) => {
            const win = main();
            if (win) {
                if (win.isMinimized()) win.restore();
                win.show();
                win.focus();
            }
            if (!isAppsOwn(argv)) queue(filePathsFromArgv(argv, { isPackaged, appPath }));
        });
        app.on("open-file", (event, filePath) => {
            event.preventDefault();
            queue([filePath]);
        });
    }

    /** A main window was made: what's gathered goes to its page once it has loaded, and again after each load. */
    function mainCreated(win) {
        const contents = win.webContents;
        contents.on("did-start-navigation", (details) => {
            // A new page in the main frame can't take files until it has loaded.
            if (details?.isMainFrame && !details.isSameDocument) loaded.delete(contents);
        });
        contents.on("did-finish-load", () => {
            loaded.add(contents);
            flush();
        });
    }

    /** The files the app was launched with, unless the launch is the app's own to handle. */
    function launched(argv, { isPackaged, appPath }) {
        if (!isAppsOwn(argv)) queue(filePathsFromArgv(argv, { isPackaged, appPath }));
    }

    return { queue, open, flush, listen, launched, mainCreated };
}

module.exports = { checkFiles, checkAppId, setAppId, takeLock, createFiles, filePathsFromArgv, FILES_BATCH_MS };
