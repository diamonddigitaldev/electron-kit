"use strict";

// kit.start(): it registers the shared preload on the app's default session
// once the app is ready, and answers the shared bridge's channels. Who each
// handler answers is test/ipc.test.js; the theme push, test/theme.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { loadMain, appPage } = require("./helpers/main");
const { INVOKE } = require("../main/channels");

const PRELOAD = path.join(__dirname, "..", "preload.js");

test("kit.start() registers preload.js on the default session, as a frame preload", async () => {
    const { main, electron } = loadMain();
    await main.start().ready;
    assert.deepEqual(electron.session.defaultSession.getPreloadScripts(), [
        { type: "frame", id: "electron-kit", filePath: PRELOAD },
    ]);
});

test("the preload path is this package's preload.js", () => {
    const { main } = loadMain();
    assert.equal(main.PRELOAD_PATH, PRELOAD);
});

test("kit.start() answers app:get-version with the app's version", async () => {
    const { main, handlers, eventFrom } = loadMain({ version: "2.0.0-beta.2" });
    main.start();
    assert.equal(await handlers.get("app:get-version")(eventFrom(appPage())), "2.0.0-beta.2");
});

test("kit.start() answers every shared channel the page invokes, and only those", () => {
    const { main, handlers } = loadMain();
    main.start();
    assert.deepEqual([...handlers.keys()].sort(), Object.values(INVOKE).sort());
});

test("kit.start() refuses to run twice", () => {
    const { main } = loadMain();
    main.start();
    assert.throws(() => main.start(), /called twice/);
});

test("kit.start() gives every session it creates no spell-check languages, so nothing is downloaded", () => {
    const { main, electron, fakeSession } = loadMain();
    main.start();
    const created = [fakeSession(), fakeSession()];
    for (const ses of created) electron.app.emit("session-created", ses);
    assert.deepEqual(created.map((ses) => ses.spellCheckerLanguages), [[], []]);
});

test("registerPreload() refuses a session that already has the preload", () => {
    const { main, fakeSession } = loadMain();
    const ses = fakeSession();
    main.registerPreload(ses);
    assert.throws(() => main.registerPreload(ses), /already registered/);
    assert.equal(ses.getPreloadScripts().length, 1);
});
