"use strict";

// The log and the settings' migration in real Electron: the demo keeps its
// log in debug.log in its profile (userData), started with a banner and
// emptied at each launch, with what it was opened with logged and no folder
// in it; and a profile from before the demo's settings version 1 is migrated
// once, as the store is first opened, before the page reads anything.

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
