"use strict";

// electron-kit's demo: the smallest app on the kit, which the kit's
// real-Electron tests and packaging checks drive.
//
// kit.start() registers the kit's shared preload on the default session, so
// the main window gets window.kitAPI from the kit and window.electronAPI from
// the demo's own preload. The isolated window runs in a session of its own,
// from kit.sessions.isolated(), where the kit's preload is never registered:
// it gets electronAPI only, and its own channel is answered there only.
//
// The demo passes the kit its own setting (and a migration), its credits, its
// own menu item and a log in a file, so every piece of the kit is in use. It
// logs what it was opened with, which the log keeps without any folder.

const path = require("path");
const { BrowserWindow } = require("electron");
const { IPC, ISOLATED_PARTITION, SETTINGS_DEFAULTS } = require("./constants");

const kit = require("@diamonddigitaldev/electron-kit/main").start({
    // package.json's build.appId: the Windows user model ID its shortcut carries.
    appId: "com.diamonddigitaldev.electronkitdemo",
    // Version 1 of the demo's settings: a store from before it loses the
    // setting the demo dropped, and its old key.
    settings: {
        defaults: SETTINGS_DEFAULTS,
        version: 1,
        migrate: (settings) => {
            delete settings.showGrid;
            return settings;
        },
        obsoleteKeys: ["recentFiles"],
    },
    // debug.log in userData, redacted; or, for the memory log's tests, in
    // memory, on disk only while keepLogOnDisk is on.
    log: process.env.KIT_DEMO_LOG === "memory" ? "memory" : "file",
    // The files it's opened with (argv, a second launch) reach the page as files:opened.
    files: true,
    credits: {
        lines: [
            ["Created and maintained by ", { text: "Diamond Digital Development", href: "https://diamonddigital.dev" }, "."],
            "This demo is licensed under the Apache 2.0 license.",
        ],
        donate: "https://buymeacoff.ee/willtda",
    },
    repository: "https://github.com/diamonddigitaldev/electron-kit",
    // For the allowlist's tests: the sites links may open on, beside the kit's own links above.
    ...(process.env.KIT_DEMO_ALLOW ? { openExternal: { allow: process.env.KIT_DEMO_ALLOW.split(" ") } } : {}),
    // Settings > Update. No check at launch, so a run of the tests never
    // checks unless a test asks; packaged, the demo updates from the server
    // its build names.
    updates: { checkOnLaunch: false },
    menu: {
        items: [
            { label: "Open Isolated Window", accelerator: "CmdOrCtrl+Shift+N", click: () => createIsolatedWindow() },
        ],
    },
});

/** Every window's webPreferences: the house's secure defaults, and the demo's own preload. */
const webPreferences = (extra = {}) => ({
    preload: path.join(__dirname, "preload.js"),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    ...extra,
});

/** The main window: the kit's, its size and position kept between launches. */
function createMainWindow() {
    const win = kit.windows.createMain({
        page: path.join(__dirname, "index.html"),
        size: { width: 760, height: 600 },
        min: { width: 480, height: 400 },
        title: "electron-kit Demo",
        show: false,
        webPreferences: { preload: path.join(__dirname, "preload.js") },
    });
    win.once("ready-to-show", () => win.show());
}

function createIsolatedWindow() {
    const win = new BrowserWindow({
        width: 480,
        height: 320,
        title: "Isolated Window",
        show: false,
        webPreferences: webPreferences({ session: kit.sessions.isolated(ISOLATED_PARTITION) }),
    });
    // A secondary window has no menu of its own: the house menu belongs to the main window.
    win.removeMenu();
    win.once("ready-to-show", () => win.show());
    win.loadFile(path.join(__dirname, "isolated.html"));
}

// The demo's own channels go through kit.ipc.handle(), which answers the demo's
// own page only, as the kit's shared channels do: the main window's in the UI
// session, and the isolated window's in its own session, once the app is ready.
kit.ipc.handle(IPC.OPEN_ISOLATED_WINDOW, () => {
    createIsolatedWindow();
});
kit.ipc.handle(IPC.GET_ELECTRON_VERSION, () => process.versions.electron);

kit.ready.then(() => {
    kit.ipc.handle(IPC.GET_ISOLATED_VERSION, () => process.versions.electron, { session: kit.sessions.isolated(ISOLATED_PARTITION) });
    kit.log.info("Opened with", JSON.stringify(process.argv));
    createMainWindow();
});
