"use strict";

// The sender check on the kit's shared IPC (main/ipc.js): every shared handler
// answers the app's own page, a file:// page inside the app's code in the UI
// session, and refuses anything else before the handler runs. The pages here
// are URLs a window in the UI session could show, each of which would have
// window.kitAPI, since the kit's preload runs in every page of that session.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");
const { loadMain, appPage, APP_PATH } = require("./helpers/main");
const { CHANNELS, INVOKE } = require("../main/channels");

/** Senders that aren't the app's own page, each a URL a window could show (or null: no frame). */
const NOT_THE_APP = {
    "a web page": "https://example.com/",
    "a page on this machine's own server": "http://127.0.0.1:8080/index.html",
    "a data: URL": "data:text/html,<p>Not the app</p>",
    "a blank page": "about:blank",
    "a DevTools page": "devtools://devtools/bundled/devtools_app.html",
    "an empty URL (a frame yet to load)": "",
    "no frame (it navigated away or closed)": null,
    "a file outside the app's code": pathToFileURL(path.resolve("/Users/someone/Downloads/page.html")).href,
    "a file in a folder whose name starts with the app's": pathToFileURL(`${APP_PATH}-other${path.sep}index.html`).href,
    "a file in the folder above the app's": pathToFileURL(path.join(APP_PATH, "..", "index.html")).href,
    "a URL climbing out of the app's folder": `${pathToFileURL(APP_PATH).href}/src/../../outside.html`,
    "a URL climbing out with an encoded ..": `${pathToFileURL(APP_PATH).href}/%2e%2e/outside.html`,
    "the app's folder itself": `${pathToFileURL(APP_PATH).href}/`,
    "a file on another machine": "file://server/share/kit-demo/src/index.html",
};

test("a shared handler answers the app's own page, in the UI session", async () => {
    const { main, handlers, eventFrom } = loadMain({ version: "3.1.4" });
    main.start();
    const getVersion = handlers.get(INVOKE.APP_GET_VERSION);
    for (const page of ["src/index.html", "src/settings/index.html", "index.html"]) {
        assert.equal(await getVersion(eventFrom(appPage(page))), "3.1.4", page);
    }
    // A query or a fragment is still the same page.
    assert.equal(await getVersion(eventFrom(`${appPage()}?view=settings#credits`)), "3.1.4");
});

test("a shared handler refuses every sender that isn't the app's own page, and doesn't run", () => {
    const { main, electron, handlers, eventFrom } = loadMain();
    main.start();
    let ran = 0;
    electron.app.getVersion = () => ++ran;
    const getVersion = handlers.get(INVOKE.APP_GET_VERSION);
    for (const [name, url] of Object.entries(NOT_THE_APP)) {
        assert.throws(() => getVersion(eventFrom(url)), /answers "app:get-version" for the app's own page only/, name);
    }
    assert.equal(ran, 0, "the handler never ran");
});

test("a shared handler refuses the app's own page in another session", () => {
    const { main, handlers, eventFrom, fakeSession } = loadMain();
    main.start();
    // As in a window in a partition of its own, had the kit's preload been registered there.
    assert.throws(() => handlers.get(INVOKE.APP_GET_VERSION)(eventFrom(appPage(), fakeSession())), /for the app's own page only/);
});

test("every shared handler checks its sender", () => {
    const { main, handlers, eventFrom, fakeSession } = loadMain();
    main.start();
    for (const channel of Object.values(INVOKE)) {
        const handler = handlers.get(channel);
        assert.ok(handler, `${channel} has a handler`);
        assert.throws(() => handler(eventFrom(NOT_THE_APP["a web page"])), /for the app's own page only/, `${channel}, from a web page`);
        assert.throws(() => handler(eventFrom(appPage(), fakeSession())), /for the app's own page only/, `${channel}, from another session`);
    }
});

test("a refusal names the channel, and tells the page nothing about the app", () => {
    const { main, handlers, eventFrom } = loadMain();
    main.start();
    assert.throws(() => handlers.get(INVOKE.APP_GET_VERSION)(eventFrom(NOT_THE_APP["a web page"])), {
        message: 'electron-kit answers "app:get-version" for the app\'s own page only.',
    });
});

// kit.ipc.handle(): the same check for the app's own channels. The shapes
// below are File Converter's own handlers, each as it's written there.

/** One of each shape of handler File Converter has, with what the page sends and what it should get. */
const APP_HANDLERS = [
    // queue:cancel-all: no arguments, returns nothing.
    { channel: "queue:cancel-all", handler: () => {}, args: [], answer: undefined },
    // app:get-formats: no arguments, returns an object at once.
    { channel: "app:get-formats", handler: () => ({ supported: ["mp3", "wav"] }), args: [], answer: { supported: ["mp3", "wav"] } },
    // job:cancel: one argument, returns what the runner says.
    { channel: "job:cancel", handler: (_event, jobId) => jobId === "job-1", args: ["job-1"], answer: true },
    // queue:set-concurrency: one argument, returns nothing.
    { channel: "queue:set-concurrency", handler: (_event, n) => { void n; }, args: [3], answer: undefined },
    // fs:scan: two arguments, either of which may be missing, and an async answer.
    { channel: "fs:scan", handler: async (_event, paths, options) => ({ files: paths ?? [], recursive: options?.recursive ?? true }), args: [["C:\a.mp3"], undefined], answer: { files: ["C:\a.mp3"], recursive: true } },
    // job:run: an async answer, after a while.
    { channel: "job:run", handler: (_event, spec) => new Promise((resolve) => setTimeout(() => resolve({ jobId: spec.id, status: "done" }), 5)), args: [{ id: "job-2" }], answer: { jobId: "job-2", status: "done" } },
    // dialog:browse-files: an async answer of null (cancelled).
    { channel: "dialog:browse-files", handler: async () => null, args: [], answer: null },
    // preview:frame: a promise that resolves null for a bad request.
    { channel: "preview:frame", handler: (_event, request) => (request?.inputPath ? Promise.resolve("data:image/jpeg;base64,") : null), args: [{}], answer: null },
];

test("kit.ipc.handle() answers the app's own page for every shape of handler File Converter has", async () => {
    const { main, handlers, eventFrom } = loadMain();
    const kit = main.start();
    for (const { channel, handler } of APP_HANDLERS) kit.ipc.handle(channel, handler);
    for (const { channel, args, answer } of APP_HANDLERS) {
        assert.deepEqual(await handlers.get(channel)(eventFrom(appPage()), ...args), answer, channel);
    }
});

test("kit.ipc.handle() hands the handler the event and the page's arguments as they came", async () => {
    const { main, handlers, eventFrom } = loadMain();
    const kit = main.start();
    let seen;
    kit.ipc.handle("demo:echo", (...received) => {
        seen = received;
        return "ok";
    });
    const event = eventFrom(appPage());
    const spec = { id: "job-3" };
    assert.equal(await handlers.get("demo:echo")(event, spec, undefined, 0), "ok");
    assert.equal(seen[0], event);
    assert.equal(seen[1], spec);
    assert.deepEqual(seen.slice(2), [undefined, 0]);
});

test("kit.ipc.handle() passes the handler's errors on to the page, thrown or rejected", async () => {
    const { main, handlers, eventFrom } = loadMain();
    const kit = main.start();
    kit.ipc.handle("demo:throws", () => {
        throw new Error("Invalid job.");
    });
    kit.ipc.handle("demo:rejects", async () => {
        throw new Error("Conversion failed.");
    });
    assert.throws(() => handlers.get("demo:throws")(eventFrom(appPage())), /Invalid job/);
    await assert.rejects(handlers.get("demo:rejects")(eventFrom(appPage())), /Conversion failed/);
});

test("kit.ipc.handle() refuses every sender that isn't the app's own page, and the handler doesn't run", () => {
    const { main, handlers, eventFrom, fakeSession } = loadMain();
    const kit = main.start();
    let ran = 0;
    kit.ipc.handle("job:run", () => ++ran);
    const run = handlers.get("job:run");
    for (const [name, url] of Object.entries(NOT_THE_APP)) {
        assert.throws(() => run(eventFrom(url), { id: "job-1" }), /"job:run" is answered for the app's own page only/, name);
    }
    assert.throws(() => run(eventFrom(appPage(), fakeSession()), { id: "job-1" }), /for the app's own page only/, "the app's page in another session");
    assert.equal(ran, 0, "the handler never ran");
});

test("a refusal of the app's own channel names the channel, and nothing about the app or the kit", () => {
    const { main, handlers, eventFrom } = loadMain();
    const kit = main.start();
    kit.ipc.handle("job:run", () => {});
    assert.throws(() => handlers.get("job:run")(eventFrom(NOT_THE_APP["a web page"])), {
        message: '"job:run" is answered for the app\'s own page only.',
    });
});

test("kit.ipc.handle() throws, as the app registers it, on a bad channel name or handler", () => {
    const { main, handlers } = loadMain();
    const kit = main.start();
    for (const channel of ["jobrun", "job:", ":run", "Job:Run", "job:run:now", "job run", "job:-run", "job:run-", "", 7, null, undefined]) {
        assert.throws(() => kit.ipc.handle(channel, () => {}), /isn't a channel name like "domain:action"/, String(channel));
    }
    for (const handler of [undefined, null, "run", {}]) {
        assert.throws(() => kit.ipc.handle("job:run", handler), /the handler for "job:run" must be a function/, String(handler));
    }
    assert.equal(handlers.has("job:run"), false);
});

test("kit.ipc.handle() refuses the kit's shared channels, which the kit answers itself", () => {
    const { main } = loadMain();
    const kit = main.start();
    for (const channel of Object.values(CHANNELS)) {
        assert.throws(() => kit.ipc.handle(channel, () => {}), /is one of the kit's shared channels/, channel);
    }
});

test("kit.ipc.handle() refuses a second handler for a channel, as ipcMain does", () => {
    const { main } = loadMain();
    const kit = main.start();
    kit.ipc.handle("job:run", () => {});
    assert.throws(() => kit.ipc.handle("job:run", () => {}), /second handler for 'job:run'/);
});
