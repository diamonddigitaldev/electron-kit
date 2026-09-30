"use strict";

// Loads main/index.js under plain Node, with a stand-in for "electron" (and
// for "electron-store", kept in memory), so the main process's logic can be
// tested without launching Electron. Each call loads a fresh copy, with a
// fresh stand-in.

const EventEmitter = require("events");
const Module = require("module");
const path = require("path");
const { pathToFileURL } = require("url");

const MAIN = path.join(__dirname, "..", "..", "main", "index.js");

/** Where the stand-in app's code is: app.getAppPath(). */
const APP_PATH = path.resolve("/apps/kit-demo");

/** The file:// URL of a file in the stand-in app's code, as its window would show it. */
const appPage = (file = "src/index.html") => pathToFileURL(path.join(APP_PATH, file)).href;

/** A session that keeps its preload registrations and spell-check languages, as Electron's does. */
function fakeSession() {
    const scripts = [];
    return {
        scripts,
        spellCheckerLanguages: ["en-GB"],
        registerPreloadScript(script) {
            const id = script.id ?? `script-${scripts.length + 1}`;
            scripts.push({ ...script, id });
            return id;
        },
        getPreloadScripts: () => scripts.map((script) => ({ ...script })),
        setSpellCheckerLanguages(languages) {
            this.spellCheckerLanguages = [...languages];
        },
    };
}

/** nativeTheme: the OS theme as the main process sees it, which emits "updated" when told to. */
function fakeNativeTheme() {
    const theme = new EventEmitter();
    theme.shouldUseDarkColors = false;
    /** Switch the OS theme, as a person would in the OS's settings. */
    theme.switchTo = (name) => {
        theme.shouldUseDarkColors = name === "dark";
        theme.emit("updated");
    };
    return theme;
}

/** A window that records what's sent to its page. */
function fakeWindow({ destroyed = false, focused = false } = {}) {
    const sent = [];
    return {
        sent,
        destroyed,
        focused,
        isDestroyed() {
            return this.destroyed;
        },
        webContents: {
            send: (channel, ...args) => sent.push({ channel, args }),
        },
    };
}

// The kit requires electron-store when the settings are first used, after
// loadMain() has returned, so its stand-in stays in place: the latest
// loadMain()'s store.
let currentStore = null;
const load = Module._load;
Module._load = function (request, ...rest) {
    return request === "electron-store" && currentStore ? currentStore : load.call(this, request, ...rest);
};

/**
 * electron-store, in memory: what's in `data` is what's on disk. `opened`
 * counts the stores made.
 */
function fakeElectronStore(data) {
    const counts = { opened: 0 };
    class Store {
        constructor() {
            counts.opened++;
        }
        get(key) {
            return data[key] === undefined ? undefined : structuredClone(data[key]);
        }
        set(key, value) {
            data[key] = structuredClone(value);
        }
    }
    return { module: { default: Store }, counts };
}

/**
 * @param {{ version?: string, name?: string, stored?: Record<string, unknown> }} [options]
 *   stored: what's already in the store's file, and what the store writes to.
 */
function loadMain({ version = "1.2.3", name = "Kit Demo", stored = {} } = {}) {
    const handlers = new Map();
    const listeners = new Map();
    const windows = [];
    const opened = [];
    const menus = { application: null };
    const store = fakeElectronStore(stored);
    const electron = {
        app: {
            getVersion: () => version,
            getName: () => name,
            getAppPath: () => APP_PATH,
            whenReady: () => Promise.resolve(),
            on(event, listener) {
                listeners.set(event, [...(listeners.get(event) ?? []), listener]);
                return this;
            },
            /** Emit an app event to its listeners with these arguments, as Electron would. */
            emit(event, ...args) {
                for (const listener of listeners.get(event) ?? []) listener(...args);
            },
        },
        BrowserWindow: {
            getAllWindows: () => [...windows],
            getFocusedWindow: () => windows.find((win) => win.focused) ?? null,
        },
        Menu: {
            buildFromTemplate: (template) => ({ template }),
            setApplicationMenu(menu) {
                menus.application = menu;
            },
        },
        shell: {
            // Records what it was asked to open; opens nothing.
            async openExternal(url) {
                opened.push(url);
            },
        },
        ipcMain: {
            handle(channel, handler) {
                if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
                handlers.set(channel, handler);
            },
        },
        nativeTheme: fakeNativeTheme(),
        session: {
            defaultSession: fakeSession(),
        },
    };

    /** Open a window: it's in BrowserWindow.getAllWindows() from now on. */
    const openWindow = (options) => {
        const win = fakeWindow(options);
        windows.push(win);
        return win;
    };

    /**
     * An invoke's event, as a frame showing this URL would send it: from the
     * UI session unless given another, and from no frame at all for null (one
     * that has navigated away or gone).
     */
    const eventFrom = (url, ses = electron.session.defaultSession) => ({
        sender: { session: ses },
        senderFrame: url === null ? null : { url },
    });

    currentStore = store.module;
    const load = Module._load;
    Module._load = function (request, ...rest) {
        return request === "electron" ? electron : load.call(this, request, ...rest);
    };
    try {
        delete require.cache[MAIN];
        for (const key of Object.keys(require.cache)) {
            if (key.startsWith(path.dirname(MAIN) + path.sep)) delete require.cache[key];
        }
        return { main: require(MAIN), electron, handlers, fakeSession, openWindow, eventFrom, opened, menus, stored, storeCounts: store.counts };
    } finally {
        Module._load = load;
    }
}

module.exports = { loadMain, appPage, APP_PATH };
