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
const { INVOKE } = require("../main/channels");

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
    let ran = 0;
    electron.app.getVersion = () => ++ran;
    main.start();
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
