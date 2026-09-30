"use strict";

// Visual regression: Playwright's toHaveScreenshot() of the demo's window,
// compared with the images in visual.spec.js-snapshots/. Windows only (D15):
// the images are taken on a Windows CI runner, so they show Segoe UI as most
// people see it, and Linux runs every other test without them.
//
// Nine states, each a whole window:
// - Settings on its General, Update and Credits tabs;
// - Controls at rest (the box ticked, the switch off), and toggled by keyboard
//   (the box unticked, the switch on and focused);
// - the rail expanded, and collapsed, on Overview with Controls focused by keyboard;
// - a warning toast with its list shown, and the batch prompt (kit.ui.confirm())
//   with Save as New focused by keyboard.
// All nine in the demo's accent, in the light and dark themes. The two that
// show the most accent (the rail, and Controls toggled) again in each of the
// three apps' accents (test/fixtures/accents/), in both themes. 30 images.
//
// So that an image only changes when the look does: the window's page is
// 760 x 600 at a scale factor of 1, drawn without the GPU; motion is reduced, so every transition ends
// at once, and Playwright stops any animation left; the caret is hidden and the
// mouse parked where nothing hovers; the pulse dot and the Electron version
// (which a dependency update changes) are masked, and so are the Update tab's
// Check for Updates and status line, which differ when the demo is packaged. The demo's own version is
// 0.0.0 in demo/package.json, so the Update and Credits tabs show it as it is.
//
// The images are made on the runner, not on a developer's machine: run the CI
// workflow by hand with "Update the visual baselines" ticked, and commit the
// images it uploads (README, Development).

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

/** Compare the window with its image, once it's still: the mouse parked, fonts loaded, nothing moving. */
async function looksLike(main, name) {
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
        mask: [main.locator(".pulse-dot"), main.locator("#electron-api"), main.locator("#update-check"), main.locator("#update-status")],
    });
}

/**
 * Each state: how to reach it from wherever the one before left the window,
 * and what its image is called. In this order, since each changes what the
 * next would find: Controls toggled leaves the controls changed, and
 * collapsing the rail is remembered.
 */
const STATES = {
    ...Object.fromEntries(["General", "Update", "Credits"].map((name) => [`settings-${name.toLowerCase()}`, async (main) => {
        await main.getByRole("button", { name: "Settings", exact: true }).click();
        await main.getByRole("tab", { name }).click();
        await expect(main.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
        await blur(main);
    }])),
    "controls-rest": async (main) => {
        await main.getByRole("button", { name: "Controls", exact: true }).click();
        await expect(main.getByLabel("A checked box")).toBeChecked();
        await expect(main.getByLabel("A switch, off")).not.toBeChecked();
        await blur(main);
    },
    "controls-toggled": async (main) => {
        await main.getByRole("button", { name: "Controls", exact: true }).click();
        // By keyboard, so the switch shows its focus ring.
        await main.getByLabel("A checked box").focus();
        await main.keyboard.press("Space");
        await main.keyboard.press("Tab");
        await main.keyboard.press("Space");
        await expect(main.getByLabel("A checked box")).not.toBeChecked();
        await expect(main.getByLabel("A switch, off")).toBeChecked();
        await expect(main.getByLabel("A switch, off")).toBeFocused();
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
};

/** Which states each accent is pictured in. */
const PLAN = [
    [null, Object.keys(STATES)],
    ...APP_ACCENTS.map((accent) => [accent, ["controls-toggled", "rail-expanded"]]),
];

for (const [accent, states] of PLAN) {
    for (const theme of ["light", "dark"]) {
        test(`${accent ?? "the demo"}'s accent, ${theme}: ${states.join(", ")}`, async ({ demo }) => {
            const main = await openDemo(demo, theme, accent);
            for (const state of states) {
                await test.step(state, async () => {
                    await STATES[state](main);
                    await looksLike(main, `${accent ?? "demo"}-${theme}-${state}`);
                });
            }
        });
    }
}
