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

const { contextBridge, ipcRenderer, webUtils } = require("electron");

const CH = {
    APP_GET_VERSION: "app:get-version",
    APP_GET_INFO: "app:get-info",
    SETTINGS_GET: "settings:get",
    SETTINGS_SET: "settings:set",
    SHELL_OPEN_EXTERNAL: "shell:open-external",
    UPDATE_CHECK: "update:check",
    UPDATE_DOWNLOAD: "update:download",
    UPDATE_GET_STATUS: "update:get-status",
    THEME_CHANGED: "theme:changed",
    VIEW_SHOW: "view:show",
    UPDATE_STATUS: "update:status",
    FILES_OPENED: "files:opened",
};

/**
 * Listen on a channel the kit pushes. The callback gets the payload alone,
 * never the IPC event, which would hand the page ipcRenderer itself. Returns a
 * function that stops listening.
 */
function on(channel, callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("kitAPI", {
    getVersion: () => ipcRenderer.invoke(CH.APP_GET_VERSION),
    // { name, version, repository, credits: { lines, donate } }: the Credits tab.
    getInfo: () => ipcRenderer.invoke(CH.APP_GET_INFO),
    // Every setting, the app's and the kit's, merged over their defaults.
    getSettings: () => ipcRenderer.invoke(CH.SETTINGS_GET),
    // Change some settings ({ navCollapsed: true }); resolves with every setting.
    setSettings: (changes) => ipcRenderer.invoke(CH.SETTINGS_SET, changes),
    // Open an http(s) link in the person's browser. Anything else is refused.
    openExternal: (url) => ipcRenderer.invoke(CH.SHELL_OPEN_EXTERNAL, url),
    // The updater's state ({ state, version, percent, dot, … }, main/updater.js), without checking.
    getUpdateStatus: () => ipcRenderer.invoke(CH.UPDATE_GET_STATUS),
    // Check for an update now; resolves with the state once the check is done.
    checkForUpdates: () => ipcRenderer.invoke(CH.UPDATE_CHECK),
    // Download the update found; resolves with the state once it's downloaded, or has failed.
    downloadUpdate: () => ipcRenderer.invoke(CH.UPDATE_DOWNLOAD),
    // The updater's state, on each change.
    onUpdateStatus: (callback) => on(CH.UPDATE_STATUS, callback),
    // "dark" or "light", on each change of the OS theme. page/theme.js applies it.
    onThemeChanged: (callback) => on(CH.THEME_CHANGED, callback),
    // { view, tab? }, when the menu asks for a view (Settings, CmdOrCtrl+,). mountShell() shows it.
    onShowView: (callback) => on(CH.VIEW_SHOW, callback),
    // string[]: the files the app was asked to open (argv, a second launch, open-file, its menu), 500 ms at a time.
    onFilesOpened: (callback) => on(CH.FILES_OPENED, callback),
    // A dropped File's path on disk ("" for one that isn't a file on disk, or isn't a File at all, which
    // webUtils throws on: one odd item mustn't lose the whole drop). One File at a time: a FileList can't
    // cross the bridge. kit.ui.dropZone() uses it.
    getPathForFile: (file) => {
        try {
            return webUtils.getPathForFile(file);
        } catch {
            return "";
        }
    },
});
