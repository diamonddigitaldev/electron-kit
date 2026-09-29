"use strict";

// The demo's own preload: its own bridge, window.electronAPI, beside the kit's
// window.kitAPI, which the kit's session preload gives every window in the
// default session.
//
// IMPORTANT: it runs sandboxed, where require() allows only "electron",
// "events", "timers" and "url", so the channel names are inlined rather than
// required from ./constants.

const { contextBridge, ipcRenderer } = require("electron");

const CH = {
    GET_ELECTRON_VERSION: "demo:get-electron-version",
    OPEN_ISOLATED_WINDOW: "demo:open-isolated-window",
};

contextBridge.exposeInMainWorld("electronAPI", {
    getElectronVersion: () => ipcRenderer.invoke(CH.GET_ELECTRON_VERSION),
    openIsolatedWindow: () => ipcRenderer.invoke(CH.OPEN_ISOLATED_WINDOW),
    // Whether this window's renderer runs sandboxed: shown in the demo, and checked by its tests.
    sandboxed: process.sandboxed === true,
});
