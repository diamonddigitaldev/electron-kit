"use strict";

// The open-external allowlist (main/shell.js): start({ openExternal: { allow } })
// narrows shell:open-external to the sites listed, matched as URLs (scheme,
// host and port exactly, the path by whole segments), with the links the kit
// shows from the app's own config always allowed.

const test = require("node:test");
const assert = require("node:assert/strict");
const { checkOpenExternal, isUnder } = require("../main/shell");
const { INVOKE } = require("../main/channels");
const { loadMain, appPage } = require("./helpers/main");

const CREDITS = {
    lines: [["Created and maintained by ", { text: "Diamond Digital Development", href: "https://diamonddigital.dev" }, "."], "Licensed under GPL-3.0."],
    donate: "https://buymeacoff.ee/willtda",
};

/** start() with this config, and the page's open-external, asked as the app's own page. */
function opener(config) {
    const loaded = loadMain();
    loaded.main.start(config);
    const handler = loaded.handlers.get(INVOKE.SHELL_OPEN_EXTERNAL);
    return { open: (url) => handler(loaded.eventFrom(appPage()), url), opened: loaded.opened };
}

test("an entry matches its scheme, host and port exactly, and its path by whole segments", () => {
    const under = (url, entry) => isUnder(new URL(url), entry);
    assert.equal(under("https://github.com/diamonddigitaldev/Dropgate/releases", "https://github.com/diamonddigitaldev/"), true);
    assert.equal(under("https://github.com/diamonddigitaldev", "https://github.com/diamonddigitaldev"), true);
    assert.equal(under("https://github.com/diamonddigitaldev/x", "https://github.com/diamonddigitaldev"), true);
    assert.equal(under("https://GitHub.com/diamonddigitaldev/x", "https://github.com/diamonddigitaldev"), true, "host case doesn't matter");
    // Not text: none of these is under its entry.
    assert.equal(under("https://github.com/diamonddigitaldev-fake/x", "https://github.com/diamonddigitaldev"), false);
    assert.equal(under("https://diamonddigital.dev.example.com/", "https://diamonddigital.dev"), false);
    assert.equal(under("https://example.com/https://diamonddigital.dev", "https://diamonddigital.dev"), false);
    assert.equal(under("http://diamonddigital.dev/", "https://diamonddigital.dev"), false, "another scheme");
    assert.equal(under("https://diamonddigital.dev:8443/", "https://diamonddigital.dev"), false, "another port");
    assert.equal(under("https://evil@diamonddigital.dev.example.com/", "https://diamonddigital.dev"), false);
    assert.equal(under("https://github.com/other", "https://github.com/diamonddigitaldev/"), false);
});

test("checkOpenExternal(): { allow: [http(s) URLs] } or nothing; anything else throws", () => {
    assert.equal(checkOpenExternal(undefined), null);
    assert.deepEqual(checkOpenExternal({ allow: ["https://github.com/diamonddigitaldev/"] }), ["https://github.com/diamonddigitaldev/"]);
    for (const bad of [null, "https://x.dev", [], { allow: [] }, { allow: "https://x.dev" }, { allow: ["https://x.dev"], extra: 1 }]) {
        assert.throws(() => checkOpenExternal(bad), /kit\.start\(\): openExternal/, JSON.stringify(bad));
    }
    for (const entry of ["github.com", "ftp://x.dev/", "file:///C:/", "https://x.dev/?a=1", "https://x.dev/#k", "https://u:p@x.dev/", 7]) {
        assert.throws(() => checkOpenExternal({ allow: [entry] }), /openExternal\.allow/, String(entry));
    }
});

test("with an allowlist, only links on it open, besides the kit's own from the config", async () => {
    const { open, opened } = opener({
        credits: CREDITS,
        repository: "https://github.com/diamonddigitaldev/Dropgate",
        openExternal: { allow: ["https://dropgate.link/docs/"] },
    });
    for (const url of [
        "https://dropgate.link/docs/",
        "https://dropgate.link/docs/self-hosting",
        "https://diamonddigital.dev/projects/dropgate",          // a credit line's link: the whole site
        "https://buymeacoff.ee/willtda",                         // the donate link
        "https://github.com/diamonddigitaldev/Dropgate/releases/tag/v4.0.0", // the repository, and its releases
    ]) await open(url);
    assert.equal(opened.length, 5);

    for (const url of [
        "https://dropgate.link/",
        "https://dropgate.link/docs-evil",
        "https://diamonddigital.dev.example.com/",
        "https://github.com/diamonddigitaldev/Dropgate-fake",
        "https://github.com/someone-else",
        "https://buymeacoff.ee/someone-else",
    ]) {
        await assert.rejects(open(url), { message: "electron-kit opens links on the app's allowlist only." }, url);
    }
    await assert.rejects(open("file:///C:/Windows/System32/calc.exe"), { message: "electron-kit opens http and https links only." });
    assert.equal(opened.length, 5, "nothing else was opened");
});

test("without an allowlist, any http(s) link opens, as before", async () => {
    const { open, opened } = opener({ credits: CREDITS });
    await open("https://example.com/anything");
    assert.deepEqual(opened, ["https://example.com/anything"]);
});

test("a bad openExternal throws before anything is registered", () => {
    const loaded = loadMain();
    assert.throws(() => loaded.main.start({ openExternal: { allow: ["https://x.dev/#key"] } }), /openExternal\.allow/);
    assert.equal(loaded.handlers.size, 0);
});
