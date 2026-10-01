"use strict";

// The main window (main/windows.js) and one instance with the files it's
// opened with (main/instance.js), through kit.start() with a stand-in for
// Electron: the secure web preferences, the bounds kept and put back, the
// lock before any window, and files from argv, a second launch, open-file
// and the app's menu, gathered for 500 ms and pushed once the page has loaded.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { secureWebPreferences, iconPath, onAScreen, SAVE_BOUNDS_DELAY_MS } = require("../main/windows");
const { filePathsFromArgv, FILES_BATCH_MS } = require("../main/instance");
const { loadMain, APP_PATH } = require("./helpers/main");

const PAGE = path.join(APP_PATH, "src", "index.html");
const MAIN_OPTIONS = { page: PAGE, size: { width: 1100, height: 780 }, min: { width: 880, height: 600 }, title: "Kit Demo" };

/** Start the kit, and wait for it to be ready, with this process.argv while it starts. */
async function started(options = {}, { argv = [process.execPath, APP_PATH], ...load } = {}) {
    const loaded = loadMain(load);
    const real = process.argv;
    process.argv = argv;
    try {
        const kit = loaded.main.start(options);
        // A second launch never becomes ready: it's quitting.
        if (load.firstInstance !== false) await kit.ready;
        return { ...loaded, kit };
    } finally {
        process.argv = real;
    }
}

// -- Web preferences and icons ------------------------------------------------------------

test("every window has the house's secure web preferences, spell checking off unless asked, and the app's own", () => {
    assert.deepEqual(secureWebPreferences(), { spellcheck: false, sandbox: true, contextIsolation: true, nodeIntegration: false });
    assert.deepEqual(secureWebPreferences({ preload: "/p.js", spellcheck: true }), { spellcheck: true, preload: "/p.js", sandbox: true, contextIsolation: true, nodeIntegration: false });
    for (const [weaker, message] of [
        [{ nodeIntegration: true }, /can't have nodeIntegration/],
        [{ nodeIntegrationInWorker: true }, /Node in its frames or workers/],
        [{ nodeIntegrationInSubFrames: true }, /Node in its frames or workers/],
        [{ contextIsolation: false }, /contextIsolation off/],
        [{ sandbox: false }, /sandbox off/],
        [{ webSecurity: false }, /webSecurity off/],
    ]) assert.throws(() => secureWebPreferences(weaker), message, JSON.stringify(weaker));
});

test("the icon is picked for the platform from one name", () => {
    assert.equal(iconPath("/a/icon", "win32"), "/a/icon.ico");
    assert.equal(iconPath("/a/icon", "darwin"), "/a/icon.icns");
    assert.equal(iconPath("/a/icon", "linux"), "/a/icon.png");
});

test("a saved position counts as on a screen only if its title bar is well inside one", () => {
    const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }, { workArea: { x: 1920, y: 0, width: 1280, height: 1000 } }];
    assert.equal(onAScreen({ x: 100, y: 100, width: 800 }, displays), true);
    assert.equal(onAScreen({ x: 2000, y: 50, width: 800 }, displays), true);
    assert.equal(onAScreen({ x: 3300, y: 50, width: 800 }, displays), false, "past the second screen");
    assert.equal(onAScreen({ x: -780, y: 100, width: 800 }, displays), false, "all but 20px off the left");
    assert.equal(onAScreen({ x: 100, y: 1030, width: 800 }, displays), false, "its title bar below the screen");
    assert.equal(onAScreen({ x: 100, y: -100, width: 800 }, displays), false, "its title bar above it");
});

// -- The main window --------------------------------------------------------------------

test("the main window is made at its size the first time, with its minimum, title, icon and page, and secure", async () => {
    const { kit, created } = await started();
    const win = kit.windows.createMain({ ...MAIN_OPTIONS, icon: path.join(APP_PATH, "assets", "icon"), webPreferences: { preload: "/app/preload.js" } });
    assert.equal(created.length, 1);
    assert.deepEqual(win.options, {
        width: 1100, height: 780, minWidth: 880, minHeight: 600, title: "Kit Demo",
        icon: iconPath(path.join(APP_PATH, "assets", "icon")),
        show: true,
        webPreferences: { spellcheck: false, preload: "/app/preload.js", sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    assert.equal(win.loaded, PAGE);
    assert.equal(kit.windows.main(), win);
});

test("its bounds are saved 500 ms after the last resize or move, and as it closes, unless minimised, maximised or full screen", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { kit, stored } = await started();
    const win = kit.windows.createMain(MAIN_OPTIONS);
    win.bounds = { x: 10, y: 20, width: 1000, height: 700 };
    win.emit("resize");
    t.mock.timers.tick(SAVE_BOUNDS_DELAY_MS - 1);
    win.emit("move");
    t.mock.timers.tick(SAVE_BOUNDS_DELAY_MS - 1);
    assert.equal(stored.windowBounds, undefined, "not while it's still being dragged");
    t.mock.timers.tick(1);
    assert.deepEqual(stored.windowBounds, { x: 10, y: 20, width: 1000, height: 700 });

    win.state.maximized = true;
    win.bounds = { x: 0, y: 0, width: 1920, height: 1040 };
    win.emit("resize");
    t.mock.timers.tick(SAVE_BOUNDS_DELAY_MS);
    assert.deepEqual(stored.windowBounds, { x: 10, y: 20, width: 1000, height: 700 }, "a maximised window keeps its last normal bounds");

    win.state.maximized = false;
    win.bounds = { x: 30, y: 40, width: 990, height: 690 };
    win.closeNow();
    assert.deepEqual(stored.windowBounds, { x: 30, y: 40, width: 990, height: 690 });
    assert.equal(kit.windows.main(), null);
});

test("saved bounds are put back: the size always, the position only if it's on a screen, never under the minimum", async () => {
    let { kit } = await started({}, { stored: { windowBounds: { x: 200, y: 150, width: 1000, height: 700 } } });
    assert.deepEqual(kit.windows.createMain(MAIN_OPTIONS).options, { ...kit.windows.main().options, x: 200, y: 150, width: 1000, height: 700 });

    ({ kit } = await started({}, { stored: { windowBounds: { x: 5000, y: 150, width: 1000, height: 700 } } }));
    const off = kit.windows.createMain(MAIN_OPTIONS).options;
    assert.equal(off.x, undefined, "a screen that's gone: centred");
    assert.equal(off.width, 1000);

    ({ kit } = await started({}, { stored: { windowBounds: { width: 300, height: 200 } } }));
    const small = kit.windows.createMain(MAIN_OPTIONS).options;
    assert.deepEqual([small.width, small.height], [880, 600]);

    ({ kit } = await started({}, { stored: { windowBounds: { width: "wide" } } }));
    assert.deepEqual([kit.windows.createMain(MAIN_OPTIONS).options.width], [1100], "what's kept isn't bounds: the size the app gave");
});

test("asked again while it's open, the main window is shown and focused, not made twice; macOS's activate makes it again", async () => {
    const { kit, created, electron } = await started();
    const win = kit.windows.createMain(MAIN_OPTIONS);
    win.state.minimized = true;
    assert.equal(kit.windows.createMain(MAIN_OPTIONS), win);
    assert.equal(created.length, 1);
    assert.deepEqual([win.state.restored, win.state.shown, win.state.focused], [1, true, true]);

    win.closeNow();
    electron.app.emit("activate");
    assert.equal(created.length, 2);
    assert.equal(kit.windows.main(), created[1]);
    // Activated with a window open: nothing.
    electron.app.emit("activate");
    assert.equal(created.length, 2);
});

test("createMain() checks its options, and refuses a window less secure than the house's", async () => {
    const { kit, created } = await started();
    for (const [options, message] of [
        [{}, /page must be the path/],
        [{ page: PAGE }, /size must be \{ width, height \}/],
        [{ page: PAGE, size: { width: 0, height: 10 } }, /size must be/],
        [{ ...MAIN_OPTIONS, min: { width: 10 } }, /min must be/],
        [{ ...MAIN_OPTIONS, icon: "" }, /icon must be the icon's path/],
        [{ ...MAIN_OPTIONS, webPreferences: { contextIsolation: false } }, /contextIsolation off/],
    ]) assert.throws(() => kit.windows.createMain(options), message);
    assert.equal(created.length, 0);
});

test("the app quits when its last window closes, bar on macOS", async () => {
    const { electron, calls } = await started();
    electron.app.emit("window-all-closed");
    assert.equal(calls.quit, process.platform === "darwin" ? 0 : 1);
});

// -- One instance -------------------------------------------------------------------------

test("start() takes the single-instance lock before anything is ready; a second launch quits", async () => {
    const first = await started();
    assert.equal(first.calls.lock, 1);
    assert.equal(first.kit.primary, true);
    assert.equal(first.calls.appUserModelId, process.platform === "win32" ? "Kit Demo" : null);
    assert.equal(first.calls.quit, 0);

    const second = await started({}, { firstInstance: false });
    assert.equal(second.kit.primary, false);
    assert.equal(second.calls.quit, 1);

    const many = await started({ singleInstance: false });
    assert.equal(many.calls.lock, 0);
    assert.equal(many.kit.primary, true);
    assert.throws(() => loadMain().main.start({ singleInstance: "yes" }), /singleInstance must be true or false/);
});

test("a second launch writes no log, so the first's debug.log stays whole, and never becomes ready", async () => {
    const fs = require("fs");
    const os = require("os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "electron-kit-second-"));
    try {
        fs.writeFileSync(path.join(dir, "debug.log"), "the first launch's log\n");
        const second = await started({ log: "file" }, { firstInstance: false, userData: dir });
        assert.equal(fs.readFileSync(path.join(dir, "debug.log"), "utf8"), "the first launch's log\n");
        const settled = await Promise.race([second.kit.ready.then(() => "ready"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 50))]);
        assert.equal(settled, "waiting", "a second launch's ready never comes, so the app makes no window there");
        assert.equal(second.created.length, 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// -- Files ---------------------------------------------------------------------------------

test("filePathsFromArgv(): past the executable and the app's own folder, no switches, and only what's on disk", () => {
    const exists = (p) => !p.includes("missing");
    const argv = [process.execPath, "--user-data-dir=/x", APP_PATH, "/videos/a.mp4", "-flag", "", "/videos/missing.mp4", "C:\\b.wav"];
    assert.deepEqual(filePathsFromArgv(argv, { isPackaged: false, appPath: APP_PATH, exists }), ["/videos/a.mp4", "C:\\b.wav"]);
    assert.deepEqual(filePathsFromArgv([process.execPath, ".", "/videos/a.mp4"], { isPackaged: false, appPath: APP_PATH, exists }), ["/videos/a.mp4"]);
    // Packaged, only the executable comes first.
    assert.deepEqual(filePathsFromArgv(["/opt/app/app", "/videos/a.mp4"], { isPackaged: true, appPath: "/opt/app/resources/app.asar", exists }), ["/videos/a.mp4"]);
    assert.deepEqual(filePathsFromArgv([process.execPath, "/videos/a.mp4"], { isPackaged: false, appPath: APP_PATH, exists: () => { throw new Error("EPERM"); } }), []);
});

test("the files the app was launched with reach its page as one files:opened, once the page has loaded", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const file = __filename;
    const { kit } = await started({ files: true }, { argv: [process.execPath, APP_PATH, file, path.join(__dirname, "nothing-here.mp4")] });
    t.mock.timers.tick(FILES_BATCH_MS);
    const win = kit.windows.createMain(MAIN_OPTIONS);
    t.mock.timers.tick(FILES_BATCH_MS);
    assert.deepEqual(win.webContents.sent, [], "not while there's no page");
    // Electron can still say it's loading in did-finish-load (the page's fonts, fetched after it): the files go anyway.
    win.webContents.emit("did-finish-load");
    assert.equal(win.webContents.isLoading(), true);
    assert.deepEqual(win.webContents.sent, [{ channel: "files:opened", args: [[file]] }]);
});

test("a main window navigated to a new page takes no files until that page has loaded", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { kit } = await started({ files: true });
    const win = kit.windows.createMain(MAIN_OPTIONS);
    win.webContents.finishLoad();
    win.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    kit.files.open(["/a.mp4"]);
    assert.deepEqual(win.webContents.sent, []);
    // An in-page navigation (a #hash) isn't a new page.
    win.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    win.webContents.emit("did-finish-load");
    assert.deepEqual(win.webContents.sent, [{ channel: "files:opened", args: [["/a.mp4"]] }]);
});

test("a second launch's files are gathered for 500 ms and pushed as one, and the window is brought back", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { kit, electron } = await started({ files: true });
    const win = kit.windows.createMain(MAIN_OPTIONS);
    win.webContents.finishLoad();
    win.state.minimized = true;
    // Windows starts one process per file opened from Explorer.
    electron.app.emit("second-instance", {}, [process.execPath, "--some-switch", __filename]);
    t.mock.timers.tick(FILES_BATCH_MS - 1);
    electron.app.emit("second-instance", {}, [process.execPath, path.join(__dirname, "format.test.js")]);
    assert.deepEqual(win.webContents.sent, []);
    t.mock.timers.tick(FILES_BATCH_MS);
    assert.deepEqual(win.webContents.sent, [{ channel: "files:opened", args: [[__filename, path.join(__dirname, "format.test.js")]] }]);
    assert.deepEqual([win.state.restored > 0, win.state.focused], [true, true]);

    // macOS hands files over with open-file instead.
    let prevented = false;
    electron.app.emit("open-file", { preventDefault: () => (prevented = true) }, "/Users/will/a.mov");
    t.mock.timers.tick(FILES_BATCH_MS);
    assert.equal(prevented, true);
    assert.deepEqual(win.webContents.sent.at(-1), { channel: "files:opened", args: [["/Users/will/a.mov"]] });
});

test("kit.files.open() hands the app's own picks to the page at once; without files: true, nothing is taken", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { kit } = await started({ files: true });
    const win = kit.windows.createMain(MAIN_OPTIONS);
    win.webContents.finishLoad();
    kit.files.open(["/a.mp4", "/b.mp4"]);
    assert.deepEqual(win.webContents.sent, [{ channel: "files:opened", args: [["/a.mp4", "/b.mp4"]] }]);
    assert.throws(() => kit.files.open("/a.mp4"), /paths must be a list/);

    const none = await started({}, { argv: [process.execPath, APP_PATH, __filename] });
    const other = none.kit.windows.createMain(MAIN_OPTIONS);
    other.webContents.finishLoad();
    none.electron.app.emit("second-instance", {}, [process.execPath, __filename]);
    t.mock.timers.tick(FILES_BATCH_MS);
    assert.deepEqual(other.webContents.sent, []);
    assert.throws(() => none.kit.files.open(["/a.mp4"]), /wasn't given files: true/);
    assert.throws(() => loadMain().main.start({ files: "yes" }), /files must be true or false/);
});
