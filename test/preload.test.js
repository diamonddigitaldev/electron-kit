"use strict";

// The shared preload's contract: it's self-contained (it requires "electron"
// and nothing else, so it runs sandboxed), it exposes exactly one bridge,
// window.kitAPI, with the shape below, and every channel it uses is one of the
// kit's own, namespaced and unique: it invokes only channels the kit answers,
// and listens only on ones the kit pushes.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadPreload } = require("../testing");
const { CHANNELS, INVOKE, PUSH } = require("../main/channels");

const PRELOAD = path.join(__dirname, "..", "preload.js");

/** The bridge's shape: each method, and the channel it invokes or listens on. */
const BRIDGE = {
    getVersion: { invoke: INVOKE.APP_GET_VERSION },
    getInfo: { invoke: INVOKE.APP_GET_INFO },
    getSettings: { invoke: INVOKE.SETTINGS_GET },
    setSettings: { invoke: INVOKE.SETTINGS_SET, args: [{ navCollapsed: true }] },
    openExternal: { invoke: INVOKE.SHELL_OPEN_EXTERNAL, args: ["https://example.com/"] },
    getUpdateStatus: { invoke: INVOKE.UPDATE_GET_STATUS },
    checkForUpdates: { invoke: INVOKE.UPDATE_CHECK },
    downloadUpdate: { invoke: INVOKE.UPDATE_DOWNLOAD },
    onUpdateStatus: { on: PUSH.UPDATE_STATUS },
    onThemeChanged: { on: PUSH.THEME_CHANGED },
    onShowView: { on: PUSH.VIEW_SHOW },
    // Asks no channel: Electron's webUtils answers it in the renderer.
    getPathForFile: { local: true },
};

/** The bridge's methods that invoke ("invoke") or listen ("on"), as [name, channel]. */
const methodsThat = (use) => Object.entries(BRIDGE).filter(([, uses]) => use in uses).map(([name, uses]) => [name, uses[use]]);

/** The CH block inlined in the preload, as { KEY: "channel" }. */
function inlinedChannels(source) {
    const block = /const CH = \{([\s\S]*?)\};/.exec(source);
    assert.ok(block, "preload.js has no `const CH = { ... };` block");
    return Object.fromEntries([...block[1].matchAll(/(\w+):\s*"([^"]+)"/g)].map(([, key, value]) => [key, value]));
}

test("the preload requires electron and nothing else", () => {
    const { required } = loadPreload(PRELOAD);
    assert.deepEqual(required, ["electron"]);
});

test("the preload has no import or export, so it runs as a sandboxed script", () => {
    const source = fs.readFileSync(PRELOAD, "utf8");
    assert.doesNotMatch(source, /^\s*(import|export)\b/m);
});

test("the preload exposes one bridge, window.kitAPI", () => {
    const { exposed } = loadPreload(PRELOAD);
    assert.deepEqual(Object.keys(exposed), ["kitAPI"]);
});

test("kitAPI has exactly the shared bridge's methods", () => {
    const { exposed } = loadPreload(PRELOAD);
    assert.deepEqual(Object.keys(exposed.kitAPI).sort(), Object.keys(BRIDGE).sort());
    for (const [name, value] of Object.entries(exposed.kitAPI)) {
        assert.equal(typeof value, "function", `kitAPI.${name} is a function`);
    }
});

test("each kitAPI method that asks invokes its shared channel with what it was given, and nothing else", async () => {
    for (const [name, channel] of methodsThat("invoke")) {
        const { exposed, calls } = loadPreload(PRELOAD);
        const args = BRIDGE[name].args ?? [];
        // Anything beyond what the method takes goes nowhere.
        await exposed.kitAPI[name](...args, "an extra argument");
        assert.deepEqual(calls, [{ method: "invoke", channel, args }], `kitAPI.${name}()`);
    }
});

test("kitAPI.getPathForFile() asks Electron's webUtils for one File's path, and sends nothing to main", () => {
    const { exposed, calls } = loadPreload(PRELOAD);
    assert.equal(exposed.kitAPI.getPathForFile({ name: "a.txt" }), "");
    assert.deepEqual(calls, []);
});

test("each kitAPI method that listens hands its callback the payload alone, and can stop", () => {
    for (const [name, channel] of methodsThat("on")) {
        const { exposed, calls } = loadPreload(PRELOAD);
        const received = [];
        const stop = exposed.kitAPI[name]((...args) => received.push(args));

        assert.equal(calls.length, 1, `kitAPI.${name}() listens once`);
        const [{ method, channel: on, args: [listener] }] = calls;
        assert.deepEqual({ method, on }, { method: "on", on: channel }, `kitAPI.${name}()`);
        // Electron calls the listener with the IPC event first, which the page must never get.
        listener({ sender: "ipcRenderer itself", ports: [] }, "dark", "a second argument");
        assert.deepEqual(received, [["dark"]], `kitAPI.${name}()'s callback`);

        assert.equal(typeof stop, "function", `kitAPI.${name}() returns a function that stops listening`);
        stop();
        assert.deepEqual(calls[1], { method: "removeListener", channel, args: [listener] }, `kitAPI.${name}()'s stop`);
    }
});

test("the bridge invokes only channels the kit answers, listens only on ones it pushes, and uses them all", () => {
    const invoked = methodsThat("invoke").map(([, channel]) => channel);
    const listened = methodsThat("on").map(([, channel]) => channel);
    assert.deepEqual(invoked.filter((channel) => !Object.values(INVOKE).includes(channel)), []);
    assert.deepEqual(listened.filter((channel) => !Object.values(PUSH).includes(channel)), []);
    assert.deepEqual([...invoked, ...listened].sort(), Object.values(CHANNELS).sort());
});

test("the preload's inlined channels match main/channels.js", () => {
    const inlined = inlinedChannels(fs.readFileSync(PRELOAD, "utf8"));
    assert.deepEqual(inlined, { ...CHANNELS });
});

test("every shared channel is domain:action, and unique", () => {
    const values = Object.values(CHANNELS);
    for (const channel of values) {
        assert.match(channel, /^[a-z]+:[a-z]+(-[a-z]+)*$/, `"${channel}" is domain:action`);
    }
    assert.equal(new Set(values).size, values.length, "no channel is listed twice");
});

test("loadPreload() fails a preload that requires anything but electron's allowlist", (t) => {
    const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "kit-preload-"));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const bad = path.join(dir, "preload.js");
    fs.writeFileSync(bad, 'const { CH } = require("./constants");\n');
    assert.throws(() => loadPreload(bad), /can't require "\.\/constants"/);
});
