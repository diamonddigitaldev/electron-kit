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

/** A session that keeps its preload registrations, spell-check languages and permission handlers, as Electron's does. */
function fakeSession(partition = "") {
    const scripts = [];
    return {
        partition,
        scripts,
        spellCheckerLanguages: ["en-GB"],
        permissionRequestHandler: null,
        permissionCheckHandler: null,
        setPermissionRequestHandler(handler) {
            this.permissionRequestHandler = handler;
        },
        setPermissionCheckHandler(handler) {
            this.permissionCheckHandler = handler;
        },
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
let currentUpdater = null;
const load = Module._load;
Module._load = function (request, ...rest) {
    if (request === "electron-store" && currentStore) return currentStore;
    if (request === "electron-updater" && currentUpdater) return { autoUpdater: currentUpdater };
    return load.call(this, request, ...rest);
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
        delete(key) {
            delete data[key];
        }
    }
    return { module: { default: Store }, counts };
}

/**
 * @param {{ version?: string, name?: string, stored?: Record<string, unknown>, isPackaged?: boolean, autoUpdater?: object, userData?: string }} [options]
 *   stored: what's already in the store's file, and what the store writes to.
 *   isPackaged: app.isPackaged. autoUpdater: what require("electron-updater")
 *   hands the kit, in place of the real one. userData: app.getPath("userData"),
 *   where a log: "file" writes.
 */
function loadMain({ appReady = true, version = "1.2.3", name = "Kit Demo", stored = {}, isPackaged = false, autoUpdater = null, userData = path.resolve("/no-user-data"), firstInstance = true, displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }] } = {}) {
    const handlers = new Map();
    const listeners = new Map();
    const windows = [];
    const opened = [];
    const menus = { application: null };
    const store = fakeElectronStore(stored);
    const calls = { quit: 0, appUserModelId: null, lock: 0 };
    const created = [];

    /** A BrowserWindow: it records how it was made, what it loaded and sent, and emits its events when told to. */
    class FakeBrowserWindow extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            this.bounds = { x: options.x ?? 100, y: options.y ?? 100, width: options.width, height: options.height };
            this.state = { destroyed: false, minimized: false, maximized: false, fullScreen: false, shown: false, focused: false, restored: 0 };
            this.loaded = null;
            const contents = new EventEmitter();
            contents.sent = [];
            contents.loading = true;
            contents.isLoading = () => contents.loading;
            contents.send = (channel, ...args) => contents.sent.push({ channel, args });
            /** Finish loading the page: did-finish-load, as Electron emits it. */
            contents.finishLoad = () => {
                contents.loading = false;
                contents.emit("did-finish-load");
            };
            this.webContents = contents;
            created.push(this);
            windows.push(this);
        }
        loadFile(file) {
            this.loaded = file;
        }
        getBounds() {
            return { ...this.bounds };
        }
        isDestroyed() {
            return this.state.destroyed;
        }
        isMinimized() {
            return this.state.minimized;
        }
        isMaximized() {
            return this.state.maximized;
        }
        isFullScreen() {
            return this.state.fullScreen;
        }
        restore() {
            this.state.minimized = false;
            this.state.restored++;
        }
        show() {
            this.state.shown = true;
        }
        focus() {
            this.state.focused = true;
        }
        /** Close it as a person would: close, then closed, then gone. */
        closeNow() {
            this.emit("close");
            this.state.destroyed = true;
            windows.splice(windows.indexOf(this), 1);
            this.emit("closed");
        }
        static getAllWindows() {
            return [...windows];
        }
        static getFocusedWindow() {
            return windows.find((win) => win.focused || win.state?.focused) ?? null;
        }
    }

    const electron = {
        app: {
            isPackaged,
            setAppUserModelId(id) {
                calls.appUserModelId = id;
            },
            requestSingleInstanceLock() {
                calls.lock++;
                return firstInstance;
            },
            quit() {
                calls.quit++;
            },
            getVersion: () => version,
            getName: () => name,
            getAppPath: () => APP_PATH,
            getPath: (name) => {
                if (name !== "userData") throw new Error(`The stand-in app has no "${name}" path.`);
                return userData;
            },
            whenReady: () => Promise.resolve(),
            isReady: () => appReady,
            on(event, listener) {
                listeners.set(event, [...(listeners.get(event) ?? []), listener]);
                return this;
            },
            /** Emit an app event to its listeners with these arguments, as Electron would. */
            emit(event, ...args) {
                for (const listener of listeners.get(event) ?? []) listener(...args);
            },
        },
        BrowserWindow: FakeBrowserWindow,
        screen: {
            getAllDisplays: () => displays,
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
            partitions: new Map(),
            /** The session for a partition: the same one each time, as Electron's; "" is the default session. */
            fromPartition(partition) {
                if (partition === "") return this.defaultSession;
                if (!this.partitions.has(partition)) this.partitions.set(partition, fakeSession(partition));
                return this.partitions.get(partition);
            },
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
    currentUpdater = autoUpdater;
    const load = Module._load;
    Module._load = function (request, ...rest) {
        return request === "electron" ? electron : load.call(this, request, ...rest);
    };
    try {
        delete require.cache[MAIN];
        for (const key of Object.keys(require.cache)) {
            if (key.startsWith(path.dirname(MAIN) + path.sep)) delete require.cache[key];
        }
        return { main: require(MAIN), electron, handlers, fakeSession, openWindow, eventFrom, opened, menus, stored, storeCounts: store.counts, calls, created, listeners };
    } finally {
        Module._load = load;
    }
}

module.exports = { loadMain, appPage, APP_PATH };
