"use strict";

// app:get-info (main/info.js), what the Credits tab shows, and
// shell:open-external (main/shell.js), which opens its links: http(s) only.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMain, appPage } = require("./helpers/main");
const { INVOKE } = require("../main/channels");
const { isWebUrl } = require("../main/shell");
const { repositoryUrl } = require("../main/info");

const CREDITS = {
    lines: [
        ["Created and maintained by ", { text: "Diamond Digital Development", href: "https://diamonddigital.dev" }, "."],
        "This software is licensed under the Apache 2.0 license.",
    ],
    donate: "https://buymeacoff.ee/someone",
};

/** Start the kit with a config and ask app:get-info, as the app's page would. */
async function infoFor(config, options) {
    const { main, handlers, eventFrom } = loadMain(options);
    main.start(config);
    return handlers.get(INVOKE.APP_GET_INFO)(eventFrom(appPage()));
}

test("app:get-info answers the app's name and version, its repository and its credits, each line a list of parts", async () => {
    const info = await infoFor({ credits: CREDITS, repository: "https://github.com/someone/app" }, { name: "Some App", version: "2.0.0-beta.2" });
    assert.deepEqual(info, {
        name: "Some App",
        version: "2.0.0-beta.2",
        repository: "https://github.com/someone/app",
        credits: {
            lines: [
                ["Created and maintained by ", { text: "Diamond Digital Development", href: "https://diamonddigital.dev" }, "."],
                ["This software is licensed under the Apache 2.0 license."],
            ],
            donate: "https://buymeacoff.ee/someone",
        },
    });
});

test("with no credits, app:get-info has no lines and no donate link", async () => {
    const info = await infoFor({ repository: "https://github.com/someone/app" });
    assert.deepEqual(info.credits, { lines: [], donate: null });
});

test("without a repository option, it comes from the app's package.json, as an https URL, or is null", async () => {
    // The stand-in app's folder has no package.json.
    assert.equal((await infoFor({})).repository, null);
    assert.equal(repositoryUrl("git+https://github.com/someone/app.git"), "https://github.com/someone/app");
    assert.equal(repositoryUrl({ type: "git", url: "https://github.com/someone/app" }), "https://github.com/someone/app");
    for (const other of ["github:someone/app", "someone/app", "git@github.com:someone/app.git", "http://github.com/someone/app", "ssh://git@github.com/someone/app", undefined, null, 7]) {
        assert.equal(repositoryUrl(other), null, String(other));
    }
});

test("kit.start() refuses credits and a repository it couldn't show or open, before registering anything", () => {
    const bad = [
        [{ credits: "Made by us" }, /credits must be an object/],
        [{ credits: { lines: "Made by us" } }, /credits\.lines must be a list/],
        [{ credits: { lines: [[]] } }, /credits\.lines\[0\] must be a sentence or a list of parts/],
        [{ credits: { lines: [7] } }, /credits\.lines\[0\] must be a sentence/],
        [{ credits: { lines: ["Fine.", ["By ", { text: "us" }]] } }, /credits\.lines\[1\]\[1\]'s href must be an http\(s\) URL/],
        [{ credits: { lines: [[{ text: "", href: "https://example.com" }]] } }, /credits\.lines\[0\]\[0\] must be text, or a link/],
        [{ credits: { lines: [[{ text: "Us", href: "javascript:alert(1)" }]] } }, /href must be an http\(s\) URL/],
        [{ credits: { lines: [[{ text: "Us", href: "file:///C:/Windows/notepad.exe" }]] } }, /href must be an http\(s\) URL/],
        [{ credits: { donate: "buymeacoff.ee/someone" } }, /credits\.donate must be an http\(s\) URL/],
        [{ repository: "git@github.com:someone/app.git" }, /repository must be an http\(s\) URL/],
    ];
    for (const [config, error] of bad) {
        const { main, handlers } = loadMain();
        assert.throws(() => main.start(config), error, JSON.stringify(config));
        assert.equal(handlers.size, 0, `nothing registered for ${JSON.stringify(config)}`);
    }
});

test("isWebUrl() takes absolute http and https URLs with a host, and nothing else", () => {
    for (const url of ["https://example.com", "http://example.com/a?b#c", "HTTPS://EXAMPLE.COM/", "https://127.0.0.1:8080/"]) {
        assert.equal(isWebUrl(url), true, url);
    }
    for (const url of ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "data:text/html,hi", "ms-settings:", "mailto:someone@example.com",
        "ftp://example.com", "//example.com", "example.com", "https:", "https://", "", " ", null, undefined, 7, { href: "https://example.com" }]) {
        assert.equal(isWebUrl(url), false, String(url));
    }
});

test("shell:open-external opens an http(s) link through the OS's shell", async () => {
    const { main, handlers, eventFrom, opened } = loadMain();
    main.start();
    const open = handlers.get(INVOKE.SHELL_OPEN_EXTERNAL);
    await open(eventFrom(appPage()), "https://diamonddigital.dev");
    await open(eventFrom(appPage()), "http://example.com/a");
    assert.deepEqual(opened, ["https://diamonddigital.dev", "http://example.com/a"]);
});

test("shell:open-external refuses anything but an http(s) link, opens nothing, and doesn't repeat what it was asked", async () => {
    const { main, handlers, eventFrom, opened } = loadMain();
    main.start();
    const open = handlers.get(INVOKE.SHELL_OPEN_EXTERNAL);
    for (const url of ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "ms-settings:privacy", "C:\\Windows\\notepad.exe", "", null, ["https://example.com"]]) {
        await assert.rejects(open(eventFrom(appPage()), url), { message: "electron-kit opens http and https links only." }, String(url));
    }
    assert.deepEqual(opened, []);
});
