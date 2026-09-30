"use strict";

// The shared IPC handlers, and the check each one makes on who is asking.
//
// kit.start() registers the kit's preload on the app's UI session (the default
// session), so every page that session loads gets window.kitAPI: the app's own
// page, but also a page a window is navigated to, or one it opens. So every
// shared handler answers the app's own page only: a frame showing a file
// inside the app's own code (app.getAppPath(), app.asar when packaged), in the
// UI session. Anything else is refused before the handler runs, and its
// invoke() rejects.
//
// Every shared handler is registered through handle() below, never with
// ipcMain.handle() directly; test/ipc.test.js checks each one refuses a
// sender that isn't the app's page.

const path = require("path");
const { fileURLToPath } = require("url");
const { app, ipcMain, session } = require("electron");

/**
 * Whether an IPC message came from the app's own page: a frame, still there,
 * showing a file:// page inside the app's own code, in the UI session.
 * @param {Electron.IpcMainInvokeEvent} event
 * @returns {boolean}
 */
function isAppPage(event) {
    // senderFrame is null once the frame has navigated away or gone.
    const frame = event.senderFrame;
    if (!frame || event.sender.session !== session.defaultSession) return false;

    let file;
    try {
        const url = new URL(frame.url);
        if (url.protocol !== "file:") return false;
        // Throws for a file URL naming another machine, except on Windows, where it's a UNC path and fails below.
        file = fileURLToPath(url);
    } catch {
        return false;
    }
    // Empty for the app's folder itself, "..", or absolute (another drive), for a file outside it.
    const relative = path.relative(app.getAppPath(), file);
    return relative !== "" && relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative);
}

/**
 * Answer a shared channel, for the app's own page only (isAppPage). A refused
 * sender's invoke() rejects with an error naming the channel, and nothing
 * about the app.
 * @param {string} channel
 * @param {(event: Electron.IpcMainInvokeEvent, ...args: any[]) => any} handler
 */
function handle(channel, handler) {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isAppPage(event)) throw new Error(`electron-kit answers "${channel}" for the app's own page only.`);
        return handler(event, ...args);
    });
}

module.exports = { handle, isAppPage };
