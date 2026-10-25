"use strict";

// Visual regression: Playwright's toHaveScreenshot() of the demo's window,
// compared with the images in visual.spec.js-snapshots/. Windows only (D15):
// the images are taken on a Windows CI runner, so they show Segoe UI as most
// people see it, and Linux runs every other test without them.
//
// Twenty-two states, each a whole window:
// - Settings > Update with an update waiting (and the dot), downloading, ready
//   to install, restarting (Restart Now busy), checking (Check for Updates
//   busy), and after a check that failed;
// - Settings on its General, Update and Credits tabs;
// - Controls at rest (the box ticked, the switch off, the stepped slider at
//   3), and toggled by keyboard (the box unticked, the switch on, the slider
//   moved to 5 and focused);
// - the rail expanded, and collapsed, on Overview with Controls focused by keyboard;
// - a warning toast with its list shown; the batch prompt (kit.ui.confirm())
//   with Save as New focused by keyboard; and, last, since it replaces the
//   Overview, a section of files (the drop zone, a bar whose amount isn't
//   known, the action bar with Convert focused by keyboard); the Queue, its
//   bulk bar over its cards in two columns on the collapsed rail (a
//   conversion ready, with its format row and output line; a paused upload,
//   its bar faded, with Resume focused by keyboard; a conversion running; a
//   finished upload with its link; and the top of a failed one); the Queue
//   with three cards selected (the bar's box half ticked, "3 selected", its
//   target's note, and the actions a selection shows); then the update dot
//   on the collapsed rail;
// - the bottom bar (kit.ui.mountShell({ statusBar })), shown under Controls
//   with its item focused by keyboard, and with its panel open;
// - a form (kit.ui.dialog()), the demo's Advanced Options over the Queue,
//   its first field focused.
// All twenty-two in the demo's accent, in the light and dark themes. The
// seven that show the most accent (the rail, Controls toggled, the Queue at
// rest and selected, the bar and its panel, the form) again in each of the
// three apps' accents (test/fixtures/accents/), in both themes. 86 images.
//
// So that an image only changes when the look does: the window's page is
// 760 x 600 at a scale factor of 1, drawn without the GPU; motion is reduced, so every transition ends
// at once, and Playwright stops any animation left; the caret is hidden and the
// mouse parked where nothing hovers; the pulse dot, a busy button's spinner
// (which turns forever) and the Electron version (which a dependency update
// changes) are masked, and so are the Update tab's
// Check for Updates and status line at rest, which differ when the demo is packaged. The demo's own version is
// 0.0.0 in demo/package.json, so the Update and Credits tabs show it as it is.
//
// The images are made on the runner, not on a developer's machine: run the CI
// workflow by hand with "Update the visual baselines" ticked, and commit the
// images it uploads (docs/development.md, Visual Tests).

const fs = require("fs");
const path = require("path");
const { test, expect } = require("./helpers/demo");

const APP_ACCENTS = ["file-converter", "media-player", "dropgate"];
const WIDTH = 760;
const HEIGHT = 600;

test.skip(process.platform !== "win32", "the baselines are Windows' (D15)");
// Drawn in software: a GPU rounds off corners and letters differently from the runner, which has none.
// With it off, a Windows machine draws what the runner draws, so the spec passes locally too.
test.use({ demoSwitches: ["--force-device-scale-factor=1", "--disable-gpu"] });

/** The same starting point as keyboard.spec.js: Tab goes from the top of the page. */
const fromTheTop = (page) => page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute("tabindex");
});

/** Press Tab `count` times. */
async function tab(page, count) {
    for (let i = 0; i < count; i++) await page.keyboard.press("Tab");
}

/** Nothing focused: a click leaves its button focused, though without a ring. */
const blur = (page) => page.evaluate(() => document.activeElement?.blur());

/**
 * The main window at a fixed size, with motion reduced, in the theme and
 * accent asked for. An app's accent is laid over the demo's, as the
 * accessibility spec does.
 */
async function openDemo(demo, theme, accent) {
    const main = await demo.mainWindow();
    const win = await demo.app.browserWindow(main);
    await win.evaluate((win, { width, height }) => win.setContentSize(width, height), { width: WIDTH, height: HEIGHT });
    await expect.poll(() => main.evaluate(() => [innerWidth, innerHeight])).toEqual([WIDTH, HEIGHT]);
    await main.emulateMedia({ reducedMotion: "reduce" });
    if (accent) await main.addStyleTag({ content: fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "accents", `${accent}.css`), "utf8") });
    await demo.useTheme(main, theme);
    return main;
}

/** The updater's state at rest, as main/updater.js reports it (update-tab.spec.js's). */
const IDLE = { state: "idle", reason: null, version: null, percent: null, dot: false, auto: false, error: null, current: "0.0.0", channel: "stable" };

/** Push a state to the page on update:status, as the kit's updater does. */
const pushUpdate = (demo, status) => demo.app.evaluate(({ BrowserWindow }, status) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("update:status", status);
}, { ...IDLE, ...status });

/**
 * Restart Now pressed: update:install held, as while the app closes to
 * install, so the button stays busy. The next state lets it answer.
 */
async function pressRestartNow(main, demo) {
    await demo.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("update:install");
        ipcMain.handle("update:install", () => new Promise((resolve) => {
            globalThis.letInstallAnswer = resolve;
        }));
    });
    await main.locator("#update-restart").click();
    await expect(main.locator("#update-restart")).toHaveText("Restarting…");
}

/** The Update tab's states pictured, each pushed as the updater would push it, then anything done on it. */
const UPDATE_STATES = {
    "update-available": [{ state: "available", version: "0.1.0", dot: true }, "Version 0.1.0 is available."],
    "update-downloading": [{ state: "downloading", version: "0.1.0", percent: 45, dot: true }, "Downloading version 0.1.0… 45%"],
    "update-ready": [{ state: "downloaded", version: "0.1.0", percent: 100, dot: true }, /has downloaded/],
    "update-restarting": [{ state: "downloaded", version: "0.1.0", percent: 100, dot: true }, /has downloaded/, pressRestartNow],
    // Check for Updates busy, "Checking…", beside the status line saying so.
    "update-checking": [{ state: "checking" }, "Checking for updates…"],
    "update-check-failed": [{ state: "error", error: "check", reason: "no-files" }, /no update files/],
};

/** Compare the window with its image, once it's still: the mouse parked, fonts loaded, nothing moving. */
async function looksLike(main, name, { pushed = false } = {}) {
    // Over the header's empty middle, where nothing reacts to a hover.
    await main.mouse.move(WIDTH / 2, 12);
    await main.evaluate(async () => {
        await document.fonts.ready;
        const moving = () => document.getAnimations().filter((a) => a.playState !== "finished" && a.effect?.getComputedTiming().iterations !== Infinity);
        for (let running = moving(); running.length; running = moving()) {
            await Promise.all(running.map((a) => a.finished.catch(() => {})));
            await new Promise(requestAnimationFrame);
        }
        await new Promise(requestAnimationFrame);
    });
    // Soft, so every image is compared and each one that changed is reported (and uploaded, in CI).
    await expect.soft(main).toHaveScreenshot(`${name}.png`, {
        animations: "disabled",
        caret: "hide",
        // How far a pixel's colour may drift and still count as the same, from 0 to 1. Playwright's 0.2
        // lets the active item's text shade (#0a58ca) pass for its link shade (#0d6efd); 0.05 is the
        // most that catches it.
        threshold: 0.02,


        // The Update tab's Check for Updates and its status line differ between a run from source (disabled, "Updates
        // are checked in the installed app.") and a packaged one (ready to check); update-tab.spec.js checks both.
        // A state pushed to the page looks the same either way, so it isn't masked.
        mask: [main.locator(".pulse-dot"), main.locator(".spinner-border"), main.locator("#electron-api"), ...(pushed ? [] : [main.locator("#update-check"), main.locator("#update-status")])],
    });
}

/**
 * Each state: how to reach it from wherever the one before left the window,
 * and what its image is called. In this order, since each changes what the
 * next would find: Controls toggled leaves the controls changed, and
 * collapsing the rail is remembered.
 */
const STATES = {
    // First, the Update tab's states, each with the dot where there is one; the at-rest Update tab then clears it.
    ...Object.fromEntries(Object.entries(UPDATE_STATES).map(([state, [status, says, then]]) => [state, async (main, demo) => {
        await main.locator(".nav-rail .nav-settings").click();
        await main.getByRole("tab", { name: /^Update/ }).click();
        // A Restart Now pressed in the state before has its answer.
        await demo.app.evaluate(() => globalThis.letInstallAnswer?.(null));
        await pushUpdate(demo, status);
        await expect(main.locator("#update-status")).toHaveText(says);
        await then?.(main, demo);
        await blur(main);
    }])),
    ...Object.fromEntries(["General", "Update", "Credits"].map((name) => [`settings-${name.toLowerCase()}`, async (main, demo) => {
        await main.locator(".nav-rail .nav-settings").click();
        if (name === "Update") {
            await pushUpdate(demo, { state: "idle" });
            await expect(main.locator(".update-dot:visible")).toHaveCount(0);
        }
        await main.getByRole("tab", { name, exact: name !== "Update" }).click();
        await expect(main.getByRole("tab", { name, exact: name !== "Update" })).toHaveAttribute("aria-selected", "true");
        await blur(main);
    }])),
    "controls-rest": async (main) => {
        await main.getByRole("button", { name: "Controls", exact: true }).click();
        await expect(main.getByLabel("A checked box")).toBeChecked();
        await expect(main.getByLabel("A switch, off")).not.toBeChecked();
        await expect(main.getByRole("slider", { name: "Files at once" })).toHaveValue("3");
        await blur(main);
    },
    "controls-toggled": async (main) => {
        await main.getByRole("button", { name: "Controls", exact: true }).click();
        // By keyboard: the box and the switch toggled, then the slider moved on two, showing its focus ring.
        await main.getByLabel("A checked box").focus();
        await main.keyboard.press("Space");
        await main.keyboard.press("Tab");
        await main.keyboard.press("Space");
        await main.keyboard.press("Tab");
        await main.keyboard.press("ArrowRight");
        await main.keyboard.press("ArrowRight");
        await expect(main.getByLabel("A checked box")).not.toBeChecked();
        await expect(main.getByLabel("A switch, off")).toBeChecked();
        const slider = main.getByRole("slider", { name: "Files at once" });
        await expect(slider).toHaveValue("5");
        await expect(slider).toBeFocused();
    },
    "rail-expanded": async (main) => {
        await main.getByRole("button", { name: "Overview", exact: true }).click();
        // Overview is active; Controls has the keyboard's focus ring.
        await fromTheTop(main);
        await tab(main, 2);
        await expect(main.getByRole("button", { name: "Controls", exact: true })).toBeFocused();
    },
    "rail-collapsed": async (main) => {
        await main.getByRole("button", { name: "Overview", exact: true }).click();
        const rail = main.getByRole("navigation", { name: "Sections" });
        await rail.getByRole("button", { name: "Collapse", exact: true }).click();
        await expect.poll(async () => (await rail.boundingBox()).width).toBe(57);
        await fromTheTop(main);
        await tab(main, 2);
        await expect(main.getByRole("button", { name: "Controls", exact: true })).toBeFocused();
    },
    "toast-detail": async (main) => {
        await main.getByRole("button", { name: "Overview", exact: true }).click();
        await main.evaluate(() => window.kit.ui.toast("Added 12 files, skipped 3.", {
            type: "warning",
            action: { label: "Show Them", items: () => ["notes.txt", "readme.md", "setup.exe"].map((name) => ({ name, note: "not a supported format" })) },
        }));
        await main.getByRole("button", { name: "Show Them" }).click();
        await blur(main);
    },
    "confirm-batch": async (main) => {
        await main.locator("#toast-host .toast-note").evaluateAll((notes) => notes.forEach((note) => note.remove()));
        await main.evaluate(() => {
            window.kit.ui.confirm({
                title: "File Already Exists",
                body: "clip.mp4 already exists.",
                detail: "A file with this name is already in the destination.",
                icon: "file_copy",
                choices: [
                    { value: "cancelAll", label: "Cancel All" },
                    { value: "skip", label: "Skip This File" },
                    { value: "overwrite", label: "Overwrite" },
                    { value: "unique", label: "Save as New" },
                ],
                cancel: "cancelAll",
                defaultChoice: "unique",
                applyToAll: true,
            });
        });
        // Save as New has the focus, and its ring.
        await main.keyboard.press("Tab");
        await main.keyboard.press("Shift+Tab");
        await expect(main.getByRole("button", { name: "Save as New" })).toBeFocused();
    },
    "files": async (main) => {
        // A section of files: the drop zone, an item's bar whose amount isn't known (still, under reduced
        // motion), and the action bar partway through, with Convert focused by keyboard.
        // The prompt before it is answered first.
        await main.keyboard.press("Escape");
        await expect(main.locator("dialog[open]")).toHaveCount(0);
        await main.getByRole("button", { name: "Overview", exact: true }).click();
        await main.evaluate(() => {
            const area = document.createElement("div");
            document.getElementById("overview-view").replaceChildren(area);
            const { zone } = window.kit.ui.dropZone(area, { onPaths() {}, icon: "swap_horiz", label: "Drag & Drop Files or Folders Here", onBrowse() {} });
            const one = window.kit.ui.progress({ label: "clip.mp4", thin: true });
            one.set(null);
            const bar = window.kit.ui.actionBar({ run: { label: "Convert", onClick() {} }, abort: { onClick() {} }, clear: { onClick() {} } });
            bar.update({ summary: "3 files queued", detail: "Ready to convert", percent: 40, canRun: true });
            area.append(zone, one.element, bar.element);
            one.element.style.margin = "1rem 0";
        });
        await main.getByRole("button", { name: "Clear All" }).focus();
        await main.keyboard.press("Tab");
        await expect(main.getByRole("button", { name: "Convert" })).toBeFocused();
    },
    "cards": async (main) => {
        // On the collapsed rail, so the cards sit two to a row, as in the demo's own accent's run.
        await main.getByRole("button", { name: "Queue", exact: true }).click();
        const collapse = main.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Collapse", exact: true });
        if (await collapse.count()) await collapse.click();
        await expect.poll(async () => (await main.getByRole("navigation", { name: "Sections" }).boundingBox()).width).toBe(57);
        // The paused upload's Resume has the keyboard's focus, and its ring.
        const resume = main.getByRole("group", { name: "site-backup.tar" }).getByRole("button", { name: "Resume" });
        await resume.focus();
        await main.keyboard.press("Shift+Tab");
        await main.keyboard.press("Tab");
        await expect(resume).toBeFocused();
    },
    "cards-selected": async (main) => {
        // Three cards selected, by a click and a Shift click: the bar's box half ticked, "3 selected",
        // the target's note, and Bulk Edit, Remove and Deselect.
        await main.getByRole("button", { name: "Queue", exact: true }).click();
        const card = (name) => main.getByRole("group", { name, exact: true });
        await card("clip.mp4").locator(".kit-card-meta").click();
        await card("talk.mov").locator(".kit-card-meta").click({ modifiers: ["Shift"] });
        await expect(main.locator("#queue .kit-card.selected")).toHaveCount(3);
        await expect(main.locator("#queue-view .kit-bulk-count")).toHaveText("3 selected");
        await blur(main);
    },
    "update-dot-collapsed": async (main, demo) => {
        // Last, so no other image has the dot: the collapsed rail's Settings, an update waiting.
        await main.keyboard.press("Escape");
        await expect(main.locator("#queue .kit-card.selected")).toHaveCount(0);
        await pushUpdate(demo, { state: "available", version: "0.1.0", dot: true });
        await expect(main.locator(".nav-rail .update-dot:visible")).toHaveCount(1);
        await blur(main);
    },
    "status-bar": async (main, demo) => {
        // The bottom bar shown, under Controls and the expanded rail, its item focused by keyboard. The dot is gone.
        await pushUpdate(demo, { state: "idle" });
        await expect(main.locator(".update-dot:visible")).toHaveCount(0);
        const expand = main.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Expand", exact: true });
        if (await expand.count()) await expand.click();
        await main.getByRole("button", { name: "Controls", exact: true }).click();
        await main.evaluate(() => window.demoShell.statusBar.show(true));
        await main.getByLabel("A text field").focus();
        await main.keyboard.press("Tab");
        await expect(main.locator("#kit-statusbar-checks")).toBeFocused();
    },
    "status-bar-panel": async (main) => {
        // Its panel open, by a click: the item washed, the focus in the panel.
        await main.locator("#kit-statusbar-checks").click();
        await expect(main.getByRole("dialog", { name: "Check Details" })).toBeFocused();
    },
    "form-dialog": async (main) => {
        // A form (kit.ui.dialog()): the demo's Advanced Options for printer-manual.pdf, over the Queue with
        // nothing selected and the bar hidden again, its first field focused.
        await main.keyboard.press("Escape");
        await expect(main.getByRole("dialog", { name: "Check Details" })).toBeHidden();
        await main.evaluate(() => window.demoShell.statusBar.show(false));
        await main.getByRole("button", { name: "Queue", exact: true }).click();
        await main.keyboard.press("Escape");
        await expect(main.locator("#queue .kit-card.selected")).toHaveCount(0);
        await main.getByRole("group", { name: "printer-manual.pdf", exact: true }).getByRole("button", { name: "Advanced Options" }).click();
        await expect(main.getByRole("spinbutton", { name: "File lifetime" })).toBeFocused();
    },
};

/** Which states each accent is pictured in. */
const PLAN = [
    [null, Object.keys(STATES)],
    ...APP_ACCENTS.map((accent) => [accent, ["controls-toggled", "rail-expanded", "cards", "cards-selected", "status-bar", "status-bar-panel", "form-dialog"]]),
];

for (const [accent, states] of PLAN) {
    for (const theme of ["light", "dark"]) {
        test(`${accent ?? "the demo"}'s accent, ${theme}: ${states.join(", ")}`, async ({ demo }) => {
            const main = await openDemo(demo, theme, accent);
            for (const state of states) {
                await test.step(state, async () => {
                    await STATES[state](main, demo);
                    await looksLike(main, `${accent ?? "demo"}-${theme}-${state}`, { pushed: state in UPDATE_STATES });
                });
            }
        });
    }
}
