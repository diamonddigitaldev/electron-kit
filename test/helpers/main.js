"use strict";

// Loads main/index.js under plain Node, with a stand-in for "electron", so the
// main process's logic can be tested without launching Electron. Each call
// loads a fresh copy, with a fresh stand-in.

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
function fakeWindow({ destroyed = false } = {}) {
    const sent = [];
    return {
        sent,
        isDestroyed: () => destroyed,
        webContents: {
            send: (channel, ...args) => sent.push({ channel, args }),
        },
    };
}

function loadMain({ version = "1.2.3" } = {}) {
    const handlers = new Map();
    const listeners = new Map();
    const windows = [];
    const electron = {
        app: {
            getVersion: () => version,
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

    const load = Module._load;
    Module._load = function (request, ...rest) {
        return request === "electron" ? electron : load.call(this, request, ...rest);
    };
    try {
        delete require.cache[MAIN];
        for (const key of Object.keys(require.cache)) {
            if (key.startsWith(path.dirname(MAIN) + path.sep)) delete require.cache[key];
        }
        return { main: require(MAIN), electron, handlers, fakeSession, openWindow, eventFrom };
    } finally {
        Module._load = load;
    }
}

module.exports = { loadMain, appPage, APP_PATH };
