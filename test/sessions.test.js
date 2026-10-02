"use strict";

// kit.sessions.isolated() (main/sessions.js): a session without the kit's
// bridge, in memory unless persisted, with no dictionaries and no permission
// granted; and kit.ipc.handle(channel, handler, { session }), which answers
// the app's own page in that session only.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMain, appPage } = require("./helpers/main");

test("isolated(name) is a partition of its own, in memory, with no kit preload, no dictionaries and no permission", async () => {
    const { main, electron } = loadMain();
    const kit = main.start({});
    await kit.ready;
    const transfer = kit.sessions.isolated("transfer");
    assert.equal(transfer.partition, "transfer", "in memory: no persist: prefix");
    assert.notEqual(transfer, electron.session.defaultSession);
    assert.deepEqual(transfer.scripts, [], "no preload of the kit's");
    assert.equal(electron.session.defaultSession.scripts.length, 1, "the UI session has the kit's");
    assert.deepEqual(transfer.spellCheckerLanguages, []);

    let granted = null;
    transfer.permissionRequestHandler(null, "notifications", (answer) => (granted = answer));
    assert.equal(granted, false);
    assert.equal(transfer.permissionCheckHandler(null, "media"), false);

    // The same name is the same session.
    assert.equal(kit.sessions.isolated("transfer"), transfer);
});

test("isolated(name, { persist: true }) keeps its storage on disk; asked again the other way, it throws", async () => {
    const { main } = loadMain();
    const kit = main.start({});
    await kit.ready;
    assert.equal(kit.sessions.isolated("history", { persist: true }).partition, "persist:history");
    assert.throws(() => kit.sessions.isolated("history"), /"history" was made with persist/);
    kit.sessions.isolated("transfer");
    assert.throws(() => kit.sessions.isolated("transfer", { persist: true }), /"transfer" was made without persist/);
    assert.throws(() => kit.sessions.isolated("x", { persist: "yes" }), /persist must be true or false/);
});

test("isolated() throws before the app is ready, for a bad name, and for a session with the kit's preload on it", async () => {
    const early = loadMain({ appReady: false }).main.start({});
    assert.throws(() => early.sessions.isolated("transfer"), /once the app is ready: call it after kit\.ready/);

    const { main, electron } = loadMain();
    const kit = main.start({});
    await kit.ready;
    for (const bad of ["", "Transfer", "a b", "-x", "x--y", 7, undefined]) {
        assert.throws(() => kit.sessions.isolated(bad), /isn't a name like "transfer"/);
    }
    // As a mistake might: the kit's preload registered on the partition too.
    const [preload] = electron.session.defaultSession.getPreloadScripts();
    electron.session.fromPartition("leaky").registerPreloadScript(preload);
    assert.throws(() => kit.sessions.isolated("leaky"), /the kit's preload is registered on "leaky", so it isn't isolated/);
});

test("kit.ipc.handle(…, { session }) answers the app's own page in that session only, and refuses the UI session's", async () => {
    const { main, electron, handlers, eventFrom } = loadMain();
    const kit = main.start({});
    await kit.ready;
    const transfer = kit.sessions.isolated("transfer");
    kit.ipc.handle("transfer:start", (_event, id) => `started ${id}`, { session: transfer });
    kit.ipc.handle("job:run", () => "ran");

    const handler = handlers.get("transfer:start");
    assert.equal(await handler(eventFrom(appPage("src/transfer.html"), transfer), 7), "started 7");
    assert.throws(() => handler(eventFrom(appPage(), electron.session.defaultSession), 7), /"transfer:start" is answered for the app's own page only/);
    assert.throws(() => handler(eventFrom("https://example.com/", transfer), 7), /for the app's own page only/);
    assert.throws(() => handler(eventFrom(null, transfer), 7), /for the app's own page only/);
    // Another partition, even with the app's page in it, is refused.
    assert.throws(() => handler(eventFrom(appPage(), electron.session.fromPartition("other")), 7), /for the app's own page only/);

    // And the UI session's channels refuse the isolated session.
    assert.throws(() => handlers.get("job:run")(eventFrom(appPage(), transfer)), /"job:run" is answered for the app's own page only/);
    assert.throws(() => handlers.get("app:get-version")(eventFrom(appPage(), transfer)), /electron-kit answers "app:get-version" for the app's own page only/);
});

test("kit.ipc.handle()'s session must be one isolated() made, and its options { session } only", async () => {
    const { main, electron } = loadMain();
    const kit = main.start({});
    await kit.ready;
    for (const ses of [electron.session.defaultSession, electron.session.fromPartition("made-elsewhere"), "transfer", null]) {
        assert.throws(() => kit.ipc.handle("transfer:start", () => {}, { session: ses }), /must be one kit\.sessions\.isolated\(\) made/);
    }
    assert.throws(() => kit.ipc.handle("transfer:start", () => {}, { partition: "transfer" }), /options for "transfer:start" are \{ session \} or nothing/);
    assert.throws(() => kit.ipc.handle("transfer:start", () => {}, null), /options for "transfer:start" are \{ session \} or nothing/);
});
