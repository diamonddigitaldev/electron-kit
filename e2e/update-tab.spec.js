"use strict";

// Settings > Update, the update dot and the toast, in real Electron. The
// updater's own behaviour, against the real electron-updater and an update
// server, is test/updater.test.js; here the page is shown each state the
// updater pushes (update:status, sent from main as the kit sends it), and its
// controls are checked to reach the main process.

const { default: AxeBuilder } = require("@axe-core/playwright");
const { test, expect } = require("./helpers/demo");
const { contrastRatio, parseColor, over } = require("../testing/contrast");

/** The updater's state at rest, as main/updater.js reports it; each test changes what it needs. */
const IDLE = { state: "idle", reason: null, version: null, percent: null, dot: false, auto: false, error: null, current: "0.0.0", channel: "stable" };

/** Push a state to the page on update:status, as the kit's updater does. */
const push = (demo, status) => demo.app.evaluate(({ BrowserWindow }, status) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("update:status", status);
}, { ...IDLE, ...status });

/** Settings > Update, open. */
async function openUpdate(main) {
    await main.getByRole("button", { name: "Settings", exact: true }).click();
    await main.getByRole("tab", { name: /^Update/ }).click();
    return main.getByRole("tabpanel", { name: /^Update/ });
}

/** Stand in for update:check and update:download in main, counting what the page asks. */
const spyOnUpdates = (demo) => demo.app.evaluate(({ ipcMain }) => {
    globalThis.updateCalls = [];
    for (const channel of ["update:check", "update:download"]) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => {
            globalThis.updateCalls.push(channel);
            return null;
        });
    }
});

test("the Update tab: the app and version, Check for Updates, automatic downloads on, and the build's own channel", async ({ demo }) => {
    const main = await demo.mainWindow();
    const pane = await openUpdate(main);
    const version = await demo.app.evaluate(({ app }) => app.getVersion());

    await expect(pane.locator(".update-version")).toHaveText(`electron-kit Demo ${version}`);
    const check = pane.getByRole("button", { name: "Check for Updates" });
    if (demo.packaged) {
        await expect(pane.locator("#update-status")).toHaveText("");
        await expect(check).toBeEnabled();
    } else {
        await expect(pane.getByRole("status")).toHaveText("Updates are checked in the installed app.");
        await expect(check).toBeDisabled();
    }
    await expect(pane.getByRole("button", { name: "Download Update" })).toBeHidden();

    const auto = pane.getByRole("switch", { name: "Download updates automatically" });
    await expect(auto).toBeChecked();
    await expect(auto).toHaveAccessibleDescription("Updates are installed when you close electron-kit Demo.");
    // The demo is 0.0.0, a finished release: the updater saved Stable when it started.
    const channel = pane.getByRole("combobox", { name: "Update channel" });
    await expect(channel).toHaveValue("stable");
    await expect(channel.locator("option")).toHaveText(["Stable", "Beta", "Alpha"]);
    await expect(channel).toHaveAccessibleDescription("Finished releases only.");
    expect((await main.evaluate(() => window.kitAPI.getSettings())).updateChannel).toBe("stable");
});

test("the switch and the channel are kept as they're changed, and still there after a relaunch", async ({ demo }) => {
    let main = await demo.mainWindow();
    let pane = await openUpdate(main);
    await pane.getByRole("switch", { name: "Download updates automatically" }).click();
    await pane.getByRole("combobox", { name: "Update channel" }).selectOption("beta");
    await expect(pane.getByRole("combobox", { name: "Update channel" })).toHaveAccessibleDescription("Betas and finished releases.");
    await expect.poll(() => main.evaluate(() => window.kitAPI.getSettings().then((s) => [s.autoDownloadUpdates, s.updateChannel]))).toEqual([false, "beta"]);

    await pane.getByRole("combobox", { name: "Update channel" }).selectOption("alpha");
    await expect(pane.getByRole("combobox", { name: "Update channel" })).toHaveAccessibleDescription("Every build, alphas included.");

    await demo.relaunch();
    main = await demo.mainWindow();
    pane = await openUpdate(main);
    await expect(pane.getByRole("switch", { name: "Download updates automatically" })).not.toBeChecked();
    await expect(pane.getByRole("combobox", { name: "Update channel" })).toHaveValue("alpha");
    await expect(pane.getByRole("combobox", { name: "Update channel" })).toHaveAccessibleDescription("Every build, alphas included.");
});

test("the status line says each state of the updater, in a live region that keeps its height", async ({ demo }) => {
    const main = await demo.mainWindow();
    const pane = await openUpdate(main);
    const status = pane.locator("#update-status");
    const check = pane.getByRole("button", { name: "Check for Updates" });
    const download = pane.getByRole("button", { name: "Download Update" });
    await expect(status).toHaveAttribute("role", "status");
    const height = await status.evaluate((el) => el.getBoundingClientRect().height);

    const states = [
        [{ state: "checking" }, "Checking for updates…", { check: false, download: false }],
        [{ state: "none" }, "You're up to date.", { check: true, download: false }],
        [{ state: "available", version: "1.1.0", dot: true }, "Version 1.1.0 is available.", { check: true, download: true }],
        [{ state: "downloading", version: "1.1.0", percent: 45, dot: true }, "Downloading version 1.1.0… 45%", { check: false, download: false }],
        [{ state: "downloaded", version: "1.1.0", percent: 100, dot: true }, "Version 1.1.0 has downloaded and will be installed when you close electron-kit Demo.", { check: false, download: false }],
        [{ state: "error", error: "check" }, "Couldn't check for updates. Try again later.", { check: true, download: false, danger: true }],
        [{ state: "error", error: "download", version: "1.1.0", dot: true }, "Version 1.1.0 couldn't be downloaded.", { check: true, download: true, danger: true }],
        [{ state: "unavailable", reason: "not-packaged" }, "Updates are checked in the installed app.", { check: false, download: false }],
        [{ state: "unavailable", reason: "off" }, "electron-kit Demo doesn't update itself.", { check: false, download: false, off: true }],
        [{ state: "idle" }, "", { check: true, download: false }],
    ];
    for (const [pushed, text, expected] of states) {
        await push(demo, pushed);
        const what = JSON.stringify(pushed);
        await expect(status, what).toHaveText(text);
        await expect(check, what).toBeEnabled({ enabled: expected.check });
        await expect(download, what).toBeVisible({ visible: expected.download });
        await expect(status, what).toHaveClass(expected.danger ? /text-danger-emphasis/ : /^(?!.*text-danger)/);
        await expect(pane.getByRole("switch"), what).toBeEnabled({ enabled: !expected.off });
        await expect(pane.getByRole("combobox"), what).toBeEnabled({ enabled: !expected.off });
        expect(await status.evaluate((el) => el.getBoundingClientRect().height), what).toBeGreaterThanOrEqual(height);
    }
    // The percent is seen, not read out at every step.
    await push(demo, { state: "downloading", version: "1.1.0", percent: 7 });
    await expect(status).toHaveText("Downloading version 1.1.0… 7%");
    await expect(status.locator("[aria-hidden=true]")).toHaveText(" 7%");
});

test("Check for Updates and Download Update ask the main process", async ({ demo }) => {
    const main = await demo.mainWindow();
    const pane = await openUpdate(main);
    await spyOnUpdates(demo);
    await push(demo, { state: "available", version: "1.1.0", dot: true });
    await pane.getByRole("button", { name: "Check for Updates" }).click();
    await pane.getByRole("button", { name: "Download Update" }).click();
    await expect.poll(() => demo.app.evaluate(() => globalThis.updateCalls)).toEqual(["update:check", "update:download"]);
});

test("the dot shows on the rail's Settings and the Update tab while an update waits, and is named", async ({ demo }) => {
    const main = await demo.mainWindow();
    const settings = main.locator(".nav-rail .nav-settings");
    const tab = main.locator("#settings-tab-update");
    await openUpdate(main);
    await expect(main.locator(".update-dot:visible")).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Settings", exact: true })).toBeVisible();

    await push(demo, { state: "available", version: "1.1.0", dot: true });
    await expect(main.locator(".update-dot:visible")).toHaveCount(2);
    await expect(settings).toHaveAccessibleName("Settings Update available");
    await expect(tab).toHaveAccessibleName("Update Update available");

    // Expanded, at the item's end; collapsed, on the corner of the glyph.
    const place = () => settings.evaluate((item) => {
        const box = (el) => el.getBoundingClientRect();
        return { item: box(item), icon: box(item.querySelector(".nav-icon")), dot: box(item.querySelector(".update-dot")) };
    });
    let { item, icon, dot } = await place();
    expect(item.right - dot.right).toBeLessThan(16);
    expect(dot.left).toBeGreaterThan(icon.right + 40);
    await main.getByRole("button", { name: "Collapse", exact: true }).click();
    await main.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    ({ item, icon, dot } = await place());
    const centre = { x: (dot.left + dot.right) / 2, y: (dot.top + dot.bottom) / 2 };
    expect(centre.x).toBeGreaterThan(icon.left + icon.width / 2);
    expect(centre.x).toBeLessThanOrEqual(icon.right + 4);
    expect(centre.y).toBeLessThan(icon.top + icon.height / 2);
    expect(centre.y).toBeGreaterThanOrEqual(icon.top - 4);
    expect(dot.right).toBeLessThanOrEqual(item.right);

    // Gone once there's no update waiting.
    await push(demo, { state: "none" });
    await expect(main.locator(".update-dot:visible")).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Settings", exact: true })).toHaveAccessibleName("Settings");
});

test("the dot's ring holds 3:1 against the rail and the tab's page, in both themes", async ({ demo }) => {
    const main = await demo.mainWindow();
    await openUpdate(main);
    await push(demo, { state: "available", version: "1.1.0", dot: true });
    for (const theme of ["light", "dark"]) {
        await demo.useTheme(main, theme);
        for (const selector of [".nav-rail .nav-settings .update-dot", "#settings-tab-update .update-dot"]) {
            const { ring, behind } = await main.locator(selector).evaluate((dot) => {
                // The first opaque background behind the dot, from its parents.
                let el = dot.parentElement;
                const layers = [];
                while (el) {
                    const bg = getComputedStyle(el).backgroundColor;
                    if (bg !== "rgba(0, 0, 0, 0)") layers.push(bg);
                    if (bg.startsWith("rgb(")) break;
                    el = el.parentElement;
                }
                if (!el) layers.push(getComputedStyle(document.body).backgroundColor);
                return { ring: /rgba?\([^)]*\)/.exec(getComputedStyle(dot).boxShadow)[0], behind: layers };
            });
            const background = behind.reverse().reduce((under, layer) => over(parseColor(layer), under));
            const ratio = contrastRatio(ring, background);
            expect(ratio, `${theme}, ${selector}: ${ring} on ${behind.join(" under ")}`).toBeGreaterThanOrEqual(3);
        }
    }
});

test("one toast when an update downloads by itself; none for Download Update, or for a state already there on load", async ({ demo }) => {
    const main = await demo.mainWindow();
    await openUpdate(main);
    const toasts = main.locator("#toast-host .toast-note");

    await push(demo, { state: "downloaded", version: "1.1.0", percent: 100, auto: true });
    await expect(toasts).toHaveCount(1);
    await expect(toasts.locator(".toast-body")).toHaveText("Version 1.1.0 has downloaded and will be installed when you close electron-kit Demo.");
    await expect(toasts).toHaveClass(/toast-info/);
    await expect(main.locator("#toast-host")).toHaveAttribute("aria-live", "polite");
    // The same state pushed again doesn't toast again.
    await push(demo, { state: "downloaded", version: "1.1.0", percent: 100, auto: true });
    await expect(toasts).toHaveCount(1);
    // It closes itself after --timing-toast.
    await expect(toasts).toHaveCount(0, { timeout: 7000 });

    await push(demo, { state: "downloaded", version: "1.2.0", percent: 100, auto: false, dot: true });
    await main.waitForTimeout(300);
    await expect(toasts).toHaveCount(0);
});

test("kit.ui.toast(): each type, a danger toast is an alert, the close button, a toast that stays, and text only", async ({ demo }) => {
    const main = await demo.mainWindow();
    const toasts = main.locator("#toast-host .toast-note");
    await main.evaluate(() => {
        for (const type of ["info", "success", "warning", "danger"]) window.kit.ui.toast(`A ${type} toast.`, { type, timeout: 0 });
        window.kit.ui.toast("<b>not bold</b>", { timeout: 0 });
    });
    await expect(toasts).toHaveCount(5);
    await expect(toasts.locator(".toast-icon")).toHaveText(["info", "check_circle", "warning", "error", "info"]);
    await expect(toasts.nth(3)).toHaveAttribute("role", "alert");
    await expect(main.getByRole("alert")).toHaveCount(1);
    await expect(toasts.nth(4).locator(".toast-body")).toHaveText("<b>not bold</b>");
    await expect(toasts.nth(4).locator("b")).toHaveCount(0);
    // Each is filled with its colour, with text AA on it.
    for (const i of [0, 1, 2, 3]) {
        const [fg, bg] = await toasts.nth(i).evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
        expect(contrastRatio(fg, bg), `toast ${i}`).toBeGreaterThanOrEqual(4.5);
    }

    await toasts.nth(1).getByRole("button", { name: "Dismiss" }).click();
    await expect(toasts).toHaveCount(4);
    await expect(main.getByText("A success toast.")).toHaveCount(0);

    expect(await main.evaluate(() => {
        const errors = [];
        for (const args of [[""], [42], ["x", { type: "loud" }], ["x", { timeout: -1 }]]) {
            try {
                window.kit.ui.toast(...args);
            } catch (err) {
                errors.push(err.message);
            }
        }
        return errors;
    })).toEqual([
        "kit.ui.toast(): the message must be text.",
        "kit.ui.toast(): the message must be text.",
        "kit.ui.toast(): type must be one of info, success, warning, danger.",
        "kit.ui.toast(): timeout must be a number of ms, or 0.",
    ]);
});

test("a toast slides in and out over --dur-state, at once under reduced motion, and a toast drawn by the page's own code shows too", async ({ demo }) => {
    const main = await demo.mainWindow();
    const timings = () => main.evaluate(async () => {
        const { element, close } = window.kit.ui.toast("Moving.", { timeout: 0 });
        const arriving = getComputedStyle(element).animationDuration;
        close();
        return [arriving, getComputedStyle(element).transitionDuration];
    });
    expect(await timings()).toEqual(["0.2s", "0.2s, 0.2s"]);
    await main.emulateMedia({ reducedMotion: "reduce" });
    expect(await timings()).toEqual(["1e-05s", "1e-05s, 1e-05s"]);
    await main.emulateMedia({ reducedMotion: null });

    // A .toast-note an app's own code puts in the host (File Converter's, until it takes kit.ui.toast()) is drawn
    // whole once it has arrived: nothing in kit.css leaves it hidden.
    const opacity = await main.evaluate(async () => {
        const note = document.createElement("div");
        note.className = "toast-note toast-info";
        note.textContent = "The app's own.";
        document.getElementById("toast-host").append(note);
        await Promise.all(note.getAnimations().map((a) => a.finished));
        return getComputedStyle(note).opacity;
    });
    expect(opacity).toBe("1");
});

test("axe finds nothing on the Update tab with an update waiting, the dot and a toast, in both themes, collapsed and expanded", async ({ demo }) => {
    const main = await demo.mainWindow();
    await openUpdate(main);
    await push(demo, { state: "error", error: "download", version: "1.1.0", dot: true });
    await main.evaluate(() => {
        for (const type of ["info", "success", "warning", "danger"]) window.kit.ui.toast(`A ${type} toast.`, { type, timeout: 0 });
    });
    const found = [];
    for (const theme of ["light", "dark"]) {
        await demo.useTheme(main, theme);
        for (const collapsed of [false, true]) {
            const toggle = main.getByRole("button", { name: collapsed ? "Collapse" : "Expand", exact: true });
            if (await toggle.count()) await toggle.click();
            await main.mouse.move(0, 0);
            await main.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
            const { violations } = await new AxeBuilder({ page: main }).setLegacyMode(true).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
            found.push(...violations.flatMap((v) => v.nodes.map((n) => `${theme}, ${collapsed ? "collapsed" : "expanded"}: ${v.id}: ${n.target.join(" ")}`)));
        }
    }
    expect(found).toEqual([]);
});
