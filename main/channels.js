"use strict";

// The shared IPC channels: the ones the kit's preload (window.kitAPI) calls and
// the kit's main process answers or pushes. Every name is "domain:action".
//
// preload.js can't require this file (a sandboxed preload may only require
// "electron"), so it inlines the same names. test/preload.test.js checks the two
// lists match.
//
// An app's own channels live in the app's own constants and preload, never here.

/** Channels the page invokes and the kit answers (ipcMain.handle), each after checking its sender (ipc.js). */
const INVOKE = Object.freeze({
    APP_GET_VERSION: "app:get-version",
});

/** Channels the kit pushes to the page (webContents.send), which the page only listens to. */
const PUSH = Object.freeze({
    THEME_CHANGED: "theme:changed",
});

/** Every shared channel. */
const CHANNELS = Object.freeze({ ...INVOKE, ...PUSH });

module.exports = { CHANNELS, INVOKE, PUSH };
