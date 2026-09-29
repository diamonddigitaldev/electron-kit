"use strict";

// The shared preload's contract: it's self-contained (it requires "electron"
// and nothing else, so it runs sandboxed), it exposes exactly one bridge,
// window.kitAPI, with the shape below, and every channel it calls is one of the
// kit's own, namespaced and unique.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadPreload } = require("../testing");
const { CHANNELS } = require("../main/channels");

const PRELOAD = path.join(__dirname, "..", "preload.js");

/** The bridge's shape: each method, and the channel it invokes. */
const BRIDGE = {
    getVersion: CHANNELS.APP_GET_VERSION,
};

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

test("each kitAPI method invokes its shared channel, and nothing else", async () => {
    for (const [name, channel] of Object.entries(BRIDGE)) {
        const { exposed, calls } = loadPreload(PRELOAD);
        await exposed.kitAPI[name]();
        assert.deepEqual(calls, [{ method: "invoke", channel, args: [] }], `kitAPI.${name}()`);
    }
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
