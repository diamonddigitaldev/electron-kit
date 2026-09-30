"use strict";

// The demo's own IPC channels, answered by its main.js and called through its
// own preload (window.electronAPI). The kit's shared channels aren't here: the
// kit's preload and main process own those.

const IPC = Object.freeze({
    GET_ELECTRON_VERSION: "demo:get-electron-version",
    OPEN_ISOLATED_WINDOW: "demo:open-isolated-window",
});

/** The partition the isolated window runs in. The kit's preload is never registered on it. */
const ISOLATED_PARTITION = "demo-isolated";

/** The demo's own settings and their defaults, which the kit keeps beside its own. */
const SETTINGS_DEFAULTS = Object.freeze({
    showAccentSample: true,
});

module.exports = { IPC, ISOLATED_PARTITION, SETTINGS_DEFAULTS };
