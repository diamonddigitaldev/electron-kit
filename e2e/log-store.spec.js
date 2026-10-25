"use strict";

// The log and the settings' migration in real Electron: the demo keeps its
// log in debug.log in its profile (userData), started with a banner and
// emptied at each launch, with what it was opened with logged and no folder
// in it; and a profile from before the demo's settings version 1 is migrated
// once, as the store is first opened, before the page reads anything. The
// demo's export folder is main's alone: the page is refused a change to it,
// main's is taken (and checked), and main hears each change.

const fs = require("fs");
const path = require("path");
const { test, expect } = require("./helpers/demo");

test("debug.log is in userData, one launch's, with argv logged and no folder in it", async ({ demo }) => {
    await demo.mainWindow();
    const file = path.join(demo.profile, "debug.log");
    const text = fs.readFileSync(file, "utf8");
    expect(text).toMatch(/^=== \S.* 0\.0\.0 started at \d{4}-\d\d-\d\dT[\d:.]+Z ===\n/);
    expect(text).toMatch(/\] \[INFO\] Opened with \[/);
    // The profile's folder is in argv (--user-data-dir, --log-net-log), and the demo's own: none of them is written.
    for (const folder of [demo.profile, path.dirname(demo.profile), path.join(__dirname, "..", "demo")]) {
        expect(text.includes(folder), folder).toBe(false);
        expect(text.includes(folder.replaceAll("\\", "\\\\")), folder).toBe(false);
    }
    expect(text).toContain("…");

    await demo.relaunch();
    await demo.mainWindow();
    const next = fs.readFileSync(file, "utf8");
    expect(next.match(/^=== /gm)).toHaveLength(1);
});

test("a profile from before the settings' version is migrated once, before the page reads it", async ({ demo }) => {
    await demo.mainWindow();
    const config = path.join(demo.profile, "config.json");
    // A store as an older demo left it: a setting it dropped, an old key, and no version.
    fs.writeFileSync(config, JSON.stringify({ settings: { showAccentSample: false, showGrid: true }, recentFiles: ["a"] }));
    await demo.relaunch();
    const main = await demo.mainWindow();
    // The page has the setting that was kept.
    await expect(main.locator("#accent-sample")).toBeHidden();
    const after = JSON.parse(fs.readFileSync(config, "utf8"));
    // (The updater has saved its channel since, which writes every setting back, and the window its bounds.)
    expect(Object.keys(after).sort()).toEqual(["settings", "settingsSchema", "windowBounds"]);
    expect(after.settingsSchema).toBe(1);
    expect(after.settings.showAccentSample).toBe(false);
    expect(after.settings).not.toHaveProperty("showGrid");
    const log = fs.readFileSync(path.join(demo.profile, "debug.log"), "utf8");
    expect(log).toContain("[INFO] Settings version 1: removing showGrid.");
    expect(log).toContain("[INFO] Settings version 1: removing the store's obsolete key recentFiles.");
});

test("the page is refused a change to the export folder, which main alone changes; main's is taken, checked, and heard", async ({ demo }) => {
    const main = await demo.mainWindow();
    const config = path.join(demo.profile, "config.json");
    /** What a kitAPI.setSettings() comes to in the page: the setting asked for, or the error it rejects with. */
    const pageSets = (changes, key) => main.evaluate(([changes, key]) => window.kitAPI.setSettings(changes).then((after) => after[key], (err) => err.message), [changes, key]);
    /** What kit.settings.set() comes to in main: the setting asked for, or the error it throws. */
    const mainSets = (changes, key) => demo.app.evaluate((_electron, [changes, key]) => {
        try {
            return globalThis.demoKit.settings.set(changes)[key];
        } catch (err) {
            return err.message;
        }
    }, [changes, key]);
    const read = () => main.evaluate(() => window.kitAPI.getSettings());

    // Main hears every change, and who made it.
    await demo.app.evaluate(() => {
        globalThis.heard = [];
        globalThis.demoKit.settings.onChange((changes, _after, { from }) => globalThis.heard.push({ changes, from }));
    });

    expect(await pageSets({ showAccentSample: false, exportFolder: demo.profile }, "exportFolder")).toContain(`The setting "exportFolder" can't be changed from the page.`);
    expect(await read(), "nothing of that change is stored").toMatchObject({ showAccentSample: true, exportFolder: null });
    expect(JSON.parse(fs.readFileSync(config, "utf8")).settings ?? {}).not.toHaveProperty("showAccentSample", false);

    // Main sets it, and the page reads it; a folder that isn't a whole path is refused by the demo's check.
    expect(await mainSets({ exportFolder: demo.profile }, "exportFolder")).toBe(demo.profile);
    expect(await mainSets({ exportFolder: "exports" }, "exportFolder")).toBe(`The setting "exportFolder" doesn't take that value.`);
    expect((await read()).exportFolder).toBe(demo.profile);
    expect(JSON.parse(fs.readFileSync(config, "utf8")).settings.exportFolder).toBe(demo.profile);

    // The page still changes the demo's other setting.
    expect(await pageSets({ showAccentSample: false }, "showAccentSample")).toBe(false);
    expect(await demo.app.evaluate(() => globalThis.heard)).toEqual([
        { changes: { exportFolder: demo.profile }, from: "main" },
        { changes: { showAccentSample: false }, from: "page" },
    ]);
});

test.describe("the memory log", () => {
    test.use({ demoEnv: { KIT_DEMO_LOG: "memory" } });

    test("nothing is on disk until keepLogOnDisk is on; then the run so far is, until it's off again", async ({ demo }) => {
        let main = await demo.mainWindow();
        const file = path.join(demo.profile, "debug.log");
        expect(fs.existsSync(file)).toBe(false);
        expect(await main.evaluate(() => window.kitAPI.getSettings())).toMatchObject({ keepLogOnDisk: false });

        await main.evaluate(() => window.kitAPI.setSettings({ keepLogOnDisk: true }));
        const text = fs.readFileSync(file, "utf8");
        expect(text).toMatch(/^=== \S.* 0\.0\.0 started at \d{4}-\d\d-\d\dT[\d:.]+Z ===\n/);
        expect(text).toMatch(/\] \[INFO\] Opened with \[/);
        for (const folder of [demo.profile, path.dirname(demo.profile)]) {
            expect(text.includes(folder), folder).toBe(false);
            expect(text.includes(folder.replaceAll("\\", "\\\\")), folder).toBe(false);
        }

        // Kept on, the next launch writes its own run from the start.
        await demo.relaunch();
        main = await demo.mainWindow();
        const next = fs.readFileSync(file, "utf8");
        expect(next.match(/^=== /gm)).toHaveLength(1);
        expect(next).toMatch(/\] \[INFO\] Opened with \[/);

        await main.evaluate(() => window.kitAPI.setSettings({ keepLogOnDisk: false }));
        expect(fs.existsSync(file)).toBe(false);
    });

    test("a debug.log left behind is deleted at launch when the log isn't kept on disk", async ({ demo }) => {
        await demo.mainWindow();
        const file = path.join(demo.profile, "debug.log");
        fs.writeFileSync(file, "an earlier run's log\n");
        await demo.relaunch();
        await demo.mainWindow();
        expect(fs.existsSync(file)).toBe(false);
    });
});
