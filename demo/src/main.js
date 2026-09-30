"use strict";

// electron-kit's demo: the smallest app on the kit, which the kit's
// real-Electron tests and packaging checks drive.
//
// kit.start() registers the kit's shared preload on the default session, so
// the main window gets window.kitAPI from the kit and window.electronAPI from
// the demo's own preload. The isolated window runs in a partition of its own,
// where the kit's preload is never registered: it gets electronAPI only.
//
// The demo passes the kit its own setting, its credits and its own menu item,
// so every piece of the kit is in use.

const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { IPC, ISOLATED_PARTITION, SETTINGS_DEFAULTS } = require("./constants");

const kit = require("@diamonddigitaldev/electron-kit/main").start({
    settings: { defaults: SETTINGS_DEFAULTS },
    credits: {
        lines: [
            ["Created and maintained by ", { text: "Diamond Digital Development", href: "https://diamonddigital.dev" }, "."],
            "This demo is licensed under the Apache 2.0 license.",
        ],
        donate: "https://buymeacoff.ee/willtda",
    },
    repository: "https://github.com/diamonddigitaldev/electron-kit",
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

function createMainWindow() {
    const win = new BrowserWindow({
        width: 760,
        height: 600,
        minWidth: 480,
        minHeight: 400,
        title: "electron-kit Demo",
        show: false,
        webPreferences: webPreferences(),
    });
    win.once("ready-to-show", () => win.show());
    win.loadFile(path.join(__dirname, "index.html"));
}

function createIsolatedWindow() {
    const win = new BrowserWindow({
        width: 480,
        height: 320,
        title: "Isolated Window",
        show: false,
        webPreferences: webPreferences({ partition: ISOLATED_PARTITION }),
    });
    // A secondary window has no menu of its own: the house menu belongs to the main window.
    win.removeMenu();
    win.once("ready-to-show", () => win.show());
    win.loadFile(path.join(__dirname, "isolated.html"));
}

ipcMain.handle(IPC.GET_ELECTRON_VERSION, () => process.versions.electron);
ipcMain.handle(IPC.OPEN_ISOLATED_WINDOW, () => {
    createIsolatedWindow();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});

kit.ready.then(createMainWindow);
