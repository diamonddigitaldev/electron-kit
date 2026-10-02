"use strict";

// The outside-lookup helpers (testing/netlog.js): a run's net log, read for
// DNS lookups of names beyond the machine and for proxy searches.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { netLogSwitches, outsideLookups, proxyLookups, assertNoOutsideLookups } = require("../testing");

const CONSTANTS = {
    logEventTypes: { HOST_RESOLVER_MANAGER_REQUEST: 1, PAC_FILE_DECIDER: 2, PROXY_CONFIG_CHANGED: 3, URL_REQUEST_START_JOB: 4 },
    logEventPhase: { PHASE_NONE: 0, PHASE_BEGIN: 1, PHASE_END: 2 },
};

/** A net log as Chromium writes one, a line per event, cut short if asked (the app still running). */
function writeNetLog(events, { cut = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "electron-kit-netlog-"));
    const file = path.join(dir, "netlog.json");
    const lines = [`${JSON.stringify({ constants: CONSTANTS }).slice(0, -1)},`, '"events": ['];
    for (const event of events) lines.push(`${JSON.stringify(event)},`);
    if (cut) lines.push('{"params":{"host":"half-writ');
    else lines.push("]}");
    fs.writeFileSync(file, lines.join("\n"));
    return file;
}

const lookup = (host, phase = 1) => ({ type: 1, phase, params: { host }, source: { id: 1, type: 0 }, time: "1" });

test("netLogSwitches() turns the proxy off and writes the net log where it's told", () => {
    assert.deepEqual(netLogSwitches("/tmp/run/netlog.json"), ["--no-proxy-server", "--log-net-log=/tmp/run/netlog.json"]);
    assert.throws(() => netLogSwitches(""), /takes the net log's path/);
});

test("outsideLookups() names each lookup beyond this machine, and none of loopback or localhost", () => {
    const file = writeNetLog([
        lookup("http://127.0.0.1:52443"),
        lookup("localhost:8080"),
        lookup("[::1]:443"),
        lookup("redirector.gvt1.com:443"),
        lookup("redirector.gvt1.com:443", 2), // its end: not counted again
        lookup("3f2a-uuid.local"),
        { type: 4, phase: 1, params: { url: "https://example.com/" }, source: { id: 2, type: 0 }, time: "2" },
    ]);
    assert.deepEqual(outsideLookups(file), ["a DNS lookup of redirector.gvt1.com:443", "a DNS lookup of 3f2a-uuid.local"]);
    assert.deepEqual(outsideLookups(file, { allow: ["Redirector.gvt1.com", /\.local$/] }), []);
});

test("a log cut short still reads, an empty one has nothing, and a missing one says so", () => {
    assert.deepEqual(outsideLookups(writeNetLog([lookup("example.com:443")], { cut: true })), ["a DNS lookup of example.com:443"]);
    const empty = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "electron-kit-netlog-")), "netlog.json");
    fs.writeFileSync(empty, "");
    assert.deepEqual(outsideLookups(empty), []);
    assert.deepEqual(proxyLookups(empty), []);
    assert.match(outsideLookups(path.join(os.tmpdir(), "no-such-netlog.json"))[0], /^no net log at /);
});

test("proxyLookups() names auto-detecting settings, a proxy script search and a wpad lookup", () => {
    const file = writeNetLog([
        { type: 3, phase: 0, params: { new_config: { single_proxy: "direct://" } }, source: { id: 1, type: 0 }, time: "1" },
        { type: 3, phase: 0, params: { new_config: { auto_detect: true } }, source: { id: 1, type: 0 }, time: "2" },
        { type: 2, phase: 1, source: { id: 3, type: 0 }, time: "3" },
        lookup("wpad.example.lan:80"),
        lookup("example.com:443"),
    ]);
    assert.deepEqual(proxyLookups(file), [
        'proxy settings that look for a proxy: {"auto_detect":true}',
        "a search for a proxy script",
        "a DNS lookup of wpad.example.lan:80",
    ]);
    assert.deepEqual(proxyLookups(writeNetLog([lookup("example.com:443")])), []);
});

test("assertNoOutsideLookups() passes a run that stayed on the machine, and fails one that didn't, naming each once", () => {
    assertNoOutsideLookups(writeNetLog([lookup("127.0.0.1:80")]));
    const file = writeNetLog([lookup("wpad:80"), lookup("example.com:443")]);
    assert.throws(() => assertNoOutsideLookups(file), (err) => {
        assert.equal(err.message.match(/a DNS lookup of wpad:80/g).length, 1);
        assert.match(err.message, /a DNS lookup of example\.com:443/);
        return err instanceof assert.AssertionError;
    });
    assertNoOutsideLookups(writeNetLog([lookup("drop.test:443")]), { allow: ["drop.test"] });
});
