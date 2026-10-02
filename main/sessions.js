"use strict";

// kit.sessions.isolated(name): a session for a window that mustn't have the
// kit's bridge, such as Dropgate's hidden transfer renderer (its layout B).
//
// start() registers the kit's preload on the app's default session, the UI
// session, so every window there gets window.kitAPI. A window made in an
// isolated session gets only the preload the app gives it. The session:
//
// - is a partition of its own, kept in memory unless { persist: true }, so it
//   leaves nothing on disk (no cache, no storage) by default;
// - never has the kit's preload: isolated() throws if it's been registered there;
// - downloads no spell-check dictionaries (as every session on the kit, D28);
// - grants no permission: every request (camera, notifications, …) is
//   refused, and every check answers no, so a hidden window can never prompt.
//
// kit.ipc.handle(channel, handler, { session }) answers a channel for the
// app's own page in that session only, and the UI session's pages are refused
// it (ipc.js), so each side asks only the channels meant for it.

const { app, session } = require("electron");

/** An isolated session's name: lower case, words joined by "-". */
const SESSION_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * The app's isolated sessions.
 * @param {{ preloadId: string }} options - preloadId: the id the kit's preload is registered under.
 */
function createSessions({ preloadId }) {
    /** @type {Map<string, { session: Electron.Session, persist: boolean }>} */
    const made = new Map();

    /**
     * A session without the kit's bridge, by name: the same one each time it's
     * asked for by that name. Call it once the app is ready (after kit.ready).
     * @param {string} name
     * @param {{ persist?: boolean }} [options] - persist: keep its storage on disk (persist:<name>).
     * @returns {Electron.Session}
     */
    function isolated(name, { persist = false } = {}) {
        if (typeof name !== "string" || !SESSION_NAME.test(name)) {
            throw new Error(`kit.sessions.isolated(): ${JSON.stringify(name)} isn't a name like "transfer" (lower case, words joined by "-").`);
        }
        if (typeof persist !== "boolean") throw new Error("kit.sessions.isolated(): persist must be true or false.");
        if (!app.isReady()) throw new Error("kit.sessions.isolated() makes a session once the app is ready: call it after kit.ready.");
        const known = made.get(name);
        if (known) {
            if (known.persist !== persist) throw new Error(`kit.sessions.isolated(): "${name}" was made ${known.persist ? "with" : "without"} persist.`);
            return known.session;
        }

        const ses = session.fromPartition(persist ? `persist:${name}` : name);
        if (ses === session.defaultSession) throw new Error(`kit.sessions.isolated(): "${name}" is the UI session.`);
        if (ses.getPreloadScripts().some((script) => script.id === preloadId)) {
            throw new Error(`kit.sessions.isolated(): the kit's preload is registered on "${name}", so it isn't isolated.`);
        }
        ses.setSpellCheckerLanguages([]);
        ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        ses.setPermissionCheckHandler(() => false);
        made.set(name, { session: ses, persist });
        return ses;
    }

    /** Whether a session is one isolated() made. */
    const isIsolated = (ses) => [...made.values()].some((entry) => entry.session === ses);

    return { isolated, isIsolated };
}

module.exports = { createSessions, SESSION_NAME };
