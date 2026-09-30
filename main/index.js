"use strict";

// electron-kit's main-process entry, what an app's main.js requires:
//
//     const kit = require("@diamonddigitaldev/electron-kit/main").start();
//     kit.ready.then(createWindow);
//
// For now start() wires the shared preload (it registers preload.js on the
// app's default session, the UI session, and answers the channels it calls, for
// the app's own page only), pushes each change of the OS theme to every window,
// and stops the spell checker's dictionary download. The rest of start()
// (logging, single instance, settings, windows, menu, updater) arrives piece by
// piece.

const path = require("path");
const { app, session } = require("electron");
const { CHANNELS, INVOKE } = require("./channels");
const ipc = require("./ipc");
const theme = require("./theme");

/** The shared preload, which kit.start() registers on the app's session. */
const PRELOAD_PATH = path.join(__dirname, "..", "preload.js");

/** The id the shared preload is registered under, in every session that has it. */
const PRELOAD_ID = "electron-kit";

let started = false;

/**
 * Register the shared preload on a session, so every window created in it
 * afterwards gets window.kitAPI. Windows that already exist don't.
 * @param {Electron.Session} ses
 * @returns {string} The registration's id.
 */
function registerPreload(ses) {
    if (ses.getPreloadScripts().some((script) => script.id === PRELOAD_ID)) {
        throw new Error("electron-kit's preload is already registered on this session.");
    }
    return ses.registerPreloadScript({ type: "frame", id: PRELOAD_ID, filePath: PRELOAD_PATH });
}

/**
 * Start the kit. Call it once, at the top of main.js, before any window.
 * @returns {{ ready: Promise<void> }} ready resolves once the app is ready and
 *   the shared preload is registered: create windows after it.
 */
function start() {
    if (started) throw new Error("kit.start() was called twice.");
    started = true;

    ipc.handle(INVOKE.APP_GET_VERSION, () => app.getVersion());

    // On Linux, Electron's spell checker downloads its dictionaries from
    // Google's servers as each session starts, which tells them the user's
    // address and language, even when every window has spellcheck: false.
    // With no languages, it has nothing to download. This covers the default
    // session and every partition, since it's in place before any is created.
    app.on("session-created", (ses) => ses.setSpellCheckerLanguages([]));

    const ready = app.whenReady().then(() => {
        registerPreload(session.defaultSession);
        theme.followTheme();
    });
    return { ready };
}

module.exports = { start, registerPreload, PRELOAD_PATH, PRELOAD_ID, CHANNELS };
