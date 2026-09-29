"use strict";

// Loads main/index.js under plain Node, with a stand-in for "electron", so the
// main process's logic can be tested without launching Electron. Each call
// loads a fresh copy, with a fresh stand-in.

const Module = require("module");
const path = require("path");

const MAIN = path.join(__dirname, "..", "..", "main", "index.js");

/** A session that keeps its preload registrations, as Electron's does. */
function fakeSession() {
    const scripts = [];
    return {
        scripts,
        registerPreloadScript(script) {
            const id = script.id ?? `script-${scripts.length + 1}`;
            scripts.push({ ...script, id });
            return id;
        },
        getPreloadScripts: () => scripts.map((script) => ({ ...script })),
    };
}

function loadMain({ version = "1.2.3" } = {}) {
    const handlers = new Map();
    const electron = {
        app: {
            getVersion: () => version,
            whenReady: () => Promise.resolve(),
        },
        ipcMain: {
            handle(channel, handler) {
                if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
                handlers.set(channel, handler);
            },
        },
        session: {
            defaultSession: fakeSession(),
        },
    };

    const load = Module._load;
    Module._load = function (request, ...rest) {
        return request === "electron" ? electron : load.call(this, request, ...rest);
    };
    try {
        delete require.cache[MAIN];
        for (const key of Object.keys(require.cache)) {
            if (key.startsWith(path.dirname(MAIN) + path.sep)) delete require.cache[key];
        }
        return { main: require(MAIN), electron, handlers, fakeSession };
    } finally {
        Module._load = load;
    }
}

module.exports = { loadMain };
