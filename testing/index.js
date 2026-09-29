"use strict";

// electron-kit's test helpers, for the kit's own tests and the apps on it.
//
// loadPreload() runs a preload file the way a sandboxed renderer would, with
// Electron's require() allowlist and a stand-in for "electron", and returns
// what it did: what it required, what it exposed, and what each exposed call
// sends over IPC. The contract, window and accent helpers join it later.

const fs = require("fs");
const vm = require("vm");

/** What a sandboxed preload may require. Anything else throws there. */
const SANDBOX_MODULES = Object.freeze(["electron", "events", "timers", "url"]);

/**
 * Run a preload in a fresh context, as a sandboxed renderer would.
 *
 * Requiring a module outside SANDBOX_MODULES throws, as it does in the sandbox,
 * so a preload that isn't self-contained fails here. "electron" is a stand-in:
 * contextBridge.exposeInMainWorld() records each bridge, and ipcRenderer
 * records every call and resolves invoke() with undefined.
 *
 * @param {string} file - The preload's path.
 * @returns {{
 *   required: string[],
 *   exposed: Record<string, any>,
 *   calls: { method: string, channel: string, args: any[] }[],
 * }}
 */
function loadPreload(file) {
    const source = fs.readFileSync(file, "utf8");
    const required = [];
    const exposed = {};
    const calls = [];

    const record = (method) => (channel, ...args) => {
        calls.push({ method, channel, args });
        return method === "invoke" ? Promise.resolve(undefined) : undefined;
    };
    const electron = {
        contextBridge: {
            exposeInMainWorld(name, api) {
                if (Object.hasOwn(exposed, name)) throw new Error(`"${name}" was exposed twice.`);
                exposed[name] = api;
            },
        },
        ipcRenderer: {
            invoke: record("invoke"),
            send: record("send"),
            on: record("on"),
            once: record("once"),
            removeListener: record("removeListener"),
        },
        webUtils: {
            getPathForFile: () => "",
        },
    };

    const sandboxRequire = (name) => {
        required.push(name);
        if (!SANDBOX_MODULES.includes(name)) {
            throw new Error(`A sandboxed preload can't require "${name}"; only ${SANDBOX_MODULES.join(", ")}.`);
        }
        return name === "electron" ? electron : require(name);
    };

    const module = { exports: {} };
    vm.runInNewContext(source, {
        require: sandboxRequire,
        module,
        exports: module.exports,
        process: { sandboxed: true, platform: process.platform, env: {} },
        console,
    }, { filename: file });

    return { required, exposed, calls };
}

module.exports = { loadPreload, SANDBOX_MODULES };
