"use strict";

// The main window and one instance, in real Electron: the demo's window is
// the kit's (kit.windows.createMain()), with the house's secure web
// preferences, and its size and position are kept across a relaunch; files
// it's opened with reach its page as files:opened, and a second launch hands
// its files to the first and quits.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect } = require("./helpers/demo");

/** Real files to open, in a folder of their own. */
function someFiles(names) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "electron-kit-open-"));
    return { dir, files: names.map((name) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, "a test file");
        return file;
    }) };
}

test("the main window is secure, and its size and position are kept across a relaunch", async ({ demo }) => {
    let main = await demo.mainWindow();
    expect(await demo.windowOf(main)).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, defaultSession: true });
    const win = await demo.app.browserWindow(main);
    await win.evaluate((w) => w.setBounds({ x: 140, y: 120, width: 820, height: 640 }));
    // Saved 500 ms after the last move.
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(demo.profile, "config.json"), "utf8")).windowBounds).toEqual({ x: 140, y: 120, width: 820, height: 640 });

    await demo.relaunch();
    main = await demo.mainWindow();
    const bounds = await (await demo.app.browserWindow(main)).evaluate((w) => w.getBounds());
    expect(bounds).toEqual({ x: 140, y: 120, width: 820, height: 640 });
});

test.describe("opened with files", () => {
    const { dir, files } = someFiles(["a.mp4", "b c.wav"]);
    test.use({ demoFiles: [...files, path.join(dir, "missing.mp4"), "--not-a-file"] });
    test.afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    test("the files it's launched with reach the page as one files:opened, without what isn't on disk", async ({ demo }) => {
        const main = await demo.mainWindow();
        await expect.poll(() => main.evaluate(() => window.filesOpened), { timeout: 15_000 }).toEqual([files]);
    });
});

test("a second launch hands its files to the first, which comes forward, and quits", async ({ demo }) => {
    const main = await demo.mainWindow();
    const { dir, files } = someFiles(["second.mp4"]);
    try {
        expect(await demo.launchSecond(files)).toBe(0);
        await expect.poll(() => main.evaluate(() => window.filesOpened), { timeout: 15_000 }).toEqual([files]);
        // Still one window: the second launch made none.
        expect(demo.app.windows()).toHaveLength(1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
