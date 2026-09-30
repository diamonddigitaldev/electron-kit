"use strict";

// The IPC handlers the kit registers, the shared ones and the app's own, and
// the check each one makes on who is asking.
//
// kit.start() registers the kit's preload on the app's UI session (the default
// session), so every page that session loads gets window.kitAPI: the app's own
// page, but also a page a window is navigated to, or one it opens. The app's
// own preload is the same: a window of the app that's navigated away still has
// window.electronAPI. So every handler answers the app's own page only: a
// frame showing a file inside the app's own code (app.getAppPath(), app.asar
// when packaged), in the UI session. Anything else is refused before the
// handler runs, and its invoke() rejects.
//
// Every shared handler is registered through handle() below, and every one of
// the app's own through handleApp() (kit.ipc.handle()), never with
// ipcMain.handle() directly; test/ipc.test.js checks each one refuses a sender
// that isn't the app's page.

const path = require("path");
const { fileURLToPath } = require("url");
const { app, ipcMain, session } = require("electron");
const { CHANNELS } = require("./channels");

/** A channel's name: "domain:action", lower case, words joined by "-". */
const CHANNEL_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*:[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

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
 * Register a handler that runs for the app's own page only (isAppPage). A
 * refused sender's invoke() rejects with the given message.
 * @param {string} channel
 * @param {(event: Electron.IpcMainInvokeEvent, ...args: any[]) => any} handler
 * @param {string} refusal
 */
function register(channel, handler, refusal) {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isAppPage(event)) throw new Error(refusal);
        return handler(event, ...args);
    });
}

/**
 * Answer a shared channel, for the app's own page only (isAppPage). A refused
 * sender's invoke() rejects with an error naming the channel, and nothing
 * about the app.
 * @param {string} channel
 * @param {(event: Electron.IpcMainInvokeEvent, ...args: any[]) => any} handler
 */
function handle(channel, handler) {
    register(channel, handler, `electron-kit answers "${channel}" for the app's own page only.`);
}

/**
 * kit.ipc.handle(): answer one of the app's own channels, as ipcMain.handle()
 * would, for the app's own page only (isAppPage). The handler gets the event
 * and the page's arguments as they came, and what it returns, or the promise
 * it returns, is the answer; what it throws, or rejects with, is the page's
 * error. A refused sender's invoke() rejects with an error naming the channel,
 * and the handler never runs.
 *
 * Throws, as the app registers it, for a channel that isn't "domain:action",
 * is one of the kit's shared channels, or already has a handler.
 * @param {string} channel
 * @param {(event: Electron.IpcMainInvokeEvent, ...args: any[]) => any} handler
 */
function handleApp(channel, handler) {
    if (typeof channel !== "string" || !CHANNEL_NAME.test(channel)) {
        throw new Error(`kit.ipc.handle(): ${JSON.stringify(channel)} isn't a channel name like "domain:action".`);
    }
    if (Object.values(CHANNELS).includes(channel)) {
        throw new Error(`kit.ipc.handle(): "${channel}" is one of the kit's shared channels, which the kit answers itself.`);
    }
    if (typeof handler !== "function") throw new Error(`kit.ipc.handle(): the handler for "${channel}" must be a function.`);
    register(channel, handler, `"${channel}" is answered for the app's own page only.`);
}

module.exports = { handle, handleApp, isAppPage, CHANNEL_NAME };
