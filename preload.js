"use strict";

// electron-kit's shared preload: the bridge every window in the app's session
// gets, as window.kitAPI.
//
// Nothing requires this file. kit.start() registers it on the app's session
// (session.registerPreloadScript), and Electron runs it in every window of that
// session, before the window's own preload. A window in any other session or
// partition never gets it.
//
// IMPORTANT: it runs sandboxed, where require() allows only "electron",
// "events", "timers" and "url". Requiring anything else, even a file beside
// this one, leaves window.kitAPI undefined with no error in main. So it
// requires "electron" only and inlines its channel names below;
// test/preload.test.js checks they still match main/channels.js.

const { contextBridge, ipcRenderer } = require("electron");

const CH = {
    APP_GET_VERSION: "app:get-version",
};

contextBridge.exposeInMainWorld("kitAPI", {
    getVersion: () => ipcRenderer.invoke(CH.APP_GET_VERSION),
});
