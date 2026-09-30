"use strict";

// electron-kit's test helpers, for the kit's own tests and the apps on it.
//
// loadPreload() runs a preload file the way a sandboxed renderer would, with
// Electron's require() allowlist and a stand-in for "electron", and returns
// what it did: what it required, what it exposed, and what each exposed call
// sends over IPC.
//
// assertAccentContrast() checks an app's src/styles/accent.css: every pairing
// of the accent with the kit's surfaces meets WCAG 2.2 AA in both themes
// (accent.js, with the maths in contrast.js).
//
// assertNoBareAccelerators() fails a menu template with an accelerator that
// has no modifier but Shift and isn't a function key (the kit's menu builder
// refuses one too).
//
// assertBuildExtendsKit() checks an app's package.json: its electron-builder
// config extends the kit's builder/base.json, and doesn't undo what it sets.
// The contract and window helpers join them later.

const fs = require("fs");
const vm = require("vm");
const assert = require("assert");
const accent = require("./accent");
const contrast = require("./contrast");
const { bareAccelerators, describeBare } = require("../main/accelerators");

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

/**
 * Fail if a menu template, submenus included, has an accelerator Electron
 * would take from every text field: one with no modifier but Shift (or AltGr)
 * that isn't a function key. Each one is named in the failure.
 * @param {Electron.MenuItemConstructorOptions[]} template - What the app passes to Menu.buildFromTemplate().
 */
function assertNoBareAccelerators(template) {
    if (!Array.isArray(template)) throw new TypeError("assertNoBareAccelerators() takes a menu template: a list of menu items.");
    const found = bareAccelerators(template);
    if (found.length) {
        throw new assert.AssertionError({ message: `The menu has ${found.length === 1 ? "an accelerator" : `${found.length} accelerators`} with no modifier:
${describeBare(found)}` });
    }
}

/** What an app's build.extends names the kit's base config as. */
const KIT_BASE = "@diamonddigitaldev/electron-kit/builder/base.json";

/**
 * Fail unless an app's package.json builds on the kit's base config
 * (builder/base.json): build.extends names it, by the package's name or its
 * path in node_modules, and the app doesn't turn off the channel files every
 * release needs (generateUpdatesFilesForAllChannels) or leave out a publish
 * target for the updater to read.
 * @param {{ build?: Record<string, any> }} pkg - the app's package.json, parsed
 */
function assertBuildExtendsKit(pkg) {
    const build = pkg?.build ?? {};
    const extendsList = Array.isArray(build.extends) ? build.extends : [build.extends];
    assert.ok(
        extendsList.some((spec) => spec === KIT_BASE || spec === `node_modules/${KIT_BASE}`),
        `package.json's build.extends must name "${KIT_BASE}"; it's ${JSON.stringify(build.extends)}.`,
    );
    assert.notEqual(build.generateUpdatesFilesForAllChannels, false, "build.generateUpdatesFilesForAllChannels must stay on: every release carries its channels' update files.");
    assert.ok(build.publish, "build.publish must name where updates come from: electron-builder writes it into the app for the updater.");
}

module.exports = { loadPreload, assertNoBareAccelerators, assertBuildExtendsKit, KIT_BASE, SANDBOX_MODULES, ...accent, ...contrast };
