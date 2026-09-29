"use strict";

// electron-kit's demo: the smallest app on the kit, which the kit's
// real-Electron tests and packaging checks drive.
//
// kit.start() registers the kit's shared preload on the default session, so
// the main window gets window.kitAPI from the kit and window.electronAPI from
// the demo's own preload. The isolated window runs in a partition of its own,
// where the kit's preload is never registered: it gets electronAPI only.

const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");
const kit = require("@diamonddigitaldev/electron-kit/main").start();
const { IPC, ISOLATED_PARTITION } = require("./constants");

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
        width: 720,
        height: 560,
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
