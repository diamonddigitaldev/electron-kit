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
const IDLE = { state: "idle", reason: null, version: null, percent: null, dot: false, auto: false, error: null, pending: false, current: "0.0.0", channel: "stable" };

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

/** Stand in for update:check, update:download and update:install in main, counting what the page asks. */
const spyOnUpdates = (demo) => demo.app.evaluate(({ ipcMain }) => {
    globalThis.updateCalls = [];
    for (const channel of ["update:check", "update:download", "update:install"]) {
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

    await expect(pane.locator(".update-version")).toHaveText(`Version ${version}`);
    const check = pane.getByRole("button", { name: "Check for Updates" });
    if (demo.packaged) {
        // Opened before the launch check, the tab runs it: never an empty line.
        await expect(pane.locator("#update-status")).not.toHaveText("");
        await expect(check).toBeEnabled();
    } else {
        await expect(pane.getByRole("status")).toHaveText("Updates are checked in the installed app.");
        await expect(check).toBeDisabled();
    }
    await expect(pane.getByRole("button", { name: "Download Update" })).toBeHidden();

    const auto = pane.getByRole("switch", { name: "Download updates automatically" });
    await expect(auto).toBeChecked();
    await expect(auto).toHaveAccessibleDescription("Updates download by themselves and are installed when you close electron-kit Demo.");
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
    await expect(pane.getByRole("combobox", { name: "Update channel" })).toHaveAccessibleDescription("Beta and stable releases. Test new features early, issues are expected.");
    await expect.poll(() => main.evaluate(() => window.kitAPI.getSettings().then((s) => [s.autoDownloadUpdates, s.updateChannel]))).toEqual([false, "beta"]);

    await pane.getByRole("combobox", { name: "Update channel" }).selectOption("alpha");
    await expect(pane.getByRole("combobox", { name: "Update channel" })).toHaveAccessibleDescription("Alpha, beta, and stable releases. Unfinished features and many bugs, not recommended for most users.");

    await demo.relaunch();
    main = await demo.mainWindow();
    pane = await openUpdate(main);
    await expect(pane.getByRole("switch", { name: "Download updates automatically" })).not.toBeChecked();
    await expect(pane.getByRole("combobox", { name: "Update channel" })).toHaveValue("alpha");
    await expect(pane.getByRole("combobox", { name: "Update channel" })).toHaveAccessibleDescription("Alpha, beta, and stable releases. Unfinished features and many bugs, not recommended for most users.");
});

test("the status line says each state of the updater, in a live region that keeps its height", async ({ demo }) => {
    const main = await demo.mainWindow();
    const pane = await openUpdate(main);
    const status = pane.locator("#update-status");
    const check = pane.locator("#update-check");
    const download = pane.getByRole("button", { name: "Download Update" });
    const restart = pane.locator("#update-restart");
    await expect(status).toHaveAttribute("role", "status");
    const height = await status.evaluate((el) => el.getBoundingClientRect().height);

    const states = [
        [{ state: "checking" }, "Checking for updates…", { check: false, download: false }],
        [{ state: "none" }, "You're up to date.", { check: true, download: false }],
        [{ state: "available", version: "1.1.0", dot: true }, "Version 1.1.0 is available.", { check: true, download: true }],
        [{ state: "downloading", version: "1.1.0", percent: 45, dot: true }, "Downloading version 1.1.0… 45%", { check: false, download: false }],
        [{ state: "downloaded", version: "1.1.0", percent: 100, dot: true }, "Version 1.1.0 has downloaded and will be installed when you close electron-kit Demo.", { check: true, download: false, restart: true }],
        [{ state: "error", error: "check", reason: "other" }, "Couldn't check for updates. Try again later.", { check: true, download: false, tone: "warning" }],
        [{ state: "error", error: "check", reason: "offline" }, "Couldn't check for updates. You seem to be offline.", { check: true, download: false, tone: "warning" }],
        [{ state: "error", error: "check", reason: "no-files" }, "Couldn't check for updates. The newest release has no update files yet.", { check: true, download: false, tone: "warning" }],
        [{ state: "error", error: "download", version: "1.1.0", dot: true }, "Version 1.1.0 couldn't be downloaded.", { check: true, download: true, tone: "danger" }],
        [{ state: "unavailable", reason: "not-packaged" }, "Updates are checked in the installed app.", { check: false, download: false }],
        [{ state: "unavailable", reason: "off" }, "electron-kit Demo doesn't update itself.", { check: false, download: false, off: true }],
        [{ state: "idle" }, "Updates haven't been checked yet.", { check: true, download: false }],
    ];
    for (const [pushed, text, expected] of states) {
        await push(demo, pushed);
        const what = JSON.stringify(pushed);
        await expect(status, what).toHaveText(text);
        // Once an update has downloaded, Restart Now stands where Check for Updates was.
        await expect(check, what).toBeVisible({ visible: !expected.restart });
        await expect(restart, what).toBeVisible({ visible: expected.restart === true });
        await expect(check, what).toBeEnabled({ enabled: expected.check });
        await expect(download, what).toBeVisible({ visible: expected.download });
        // A failed check is a warning, a failed download a danger, and nothing else has a tone.
        await expect(status, what).toHaveClass(expected.tone === "danger" ? /text-danger-emphasis/ : /^(?!.*text-danger)/);
        await expect(status, what).toHaveClass(expected.tone === "warning" ? /text-warning-emphasis/ : /^(?!.*text-warning)/);
        await expect(pane.getByRole("switch"), what).toBeEnabled({ enabled: !expected.off });
        await expect(pane.getByRole("combobox"), what).toBeEnabled({ enabled: !expected.off });
        expect(await status.evaluate((el) => el.getBoundingClientRect().height), what).toBeGreaterThanOrEqual(height);
    }
    // The percent is seen, not read out at every step.
    await push(demo, { state: "downloading", version: "1.1.0", percent: 7 });
    await expect(status).toHaveText("Downloading version 1.1.0… 7%");
    await expect(status.locator("[aria-hidden=true]")).toHaveText(" 7%");
});

test("\"Checking for updates…\" shows for a second at least, with the button disabled, even when the check fails at once", async ({ demo }) => {
    const main = await demo.mainWindow();
    const pane = await openUpdate(main);
    const status = pane.locator("#update-status");
    const check = pane.getByRole("button", { name: "Check for Updates" });
    await push(demo, { state: "checking" });
    await expect(status).toHaveText("Checking for updates…");
    const since = Date.now();
    await push(demo, { state: "error", error: "check", reason: "offline" });
    await push(demo, { state: "error", error: "check", reason: "no-files" });
    await expect(status).toHaveText("Couldn't check for updates. The newest release has no update files yet.");
    expect(Date.now() - since, "held for a second").toBeGreaterThanOrEqual(900);
    await expect(check).toBeEnabled();
    // The latest state waited, not the first: the offline one was never shown.
    await expect(status).not.toHaveText(/offline/);
    // With no check running, a state shows at once.
    await push(demo, { state: "none" });
    await expect(status).toHaveText("You're up to date.", { timeout: 300 });
});

test("\"Version x\" in \"Version x is available.\" links to the release's page on GitHub, and opens it in the browser", async ({ demo }) => {
    const main = await demo.mainWindow();
    const pane = await openUpdate(main);
    // Stand in for shell.openExternal: it records each URL, and opens nothing (credits.spec.js's).
    await demo.app.evaluate(({ shell }) => {
        globalThis.openedUrls = [];
        shell.openExternal = async (url) => {
            globalThis.openedUrls.push(url);
        };
    });
    const status = pane.locator("#update-status");

    // GitHub's tag, as electron-updater gives it.
    await push(demo, { state: "available", version: "1.1.0", tag: "v1.1.0", dot: true });
    await expect(status).toHaveText("Version 1.1.0 is available.");
    const link = status.getByRole("link", { name: "Version 1.1.0" });
    await expect(link).toHaveAttribute("href", "https://github.com/diamonddigitaldev/electron-kit/releases/tag/v1.1.0");
    await link.click();
    // With no tag, the version is the tag.
    await push(demo, { state: "available", version: "1.2.0-beta.1", dot: true });
    await status.getByRole("link", { name: "Version 1.2.0-beta.1" }).focus();
    await main.keyboard.press("Enter");
    await expect.poll(() => demo.app.evaluate(() => globalThis.openedUrls)).toEqual([
        "https://github.com/diamonddigitaldev/electron-kit/releases/tag/v1.1.0",
        "https://github.com/diamonddigitaldev/electron-kit/releases/tag/1.2.0-beta.1",
    ]);
    // The page never followed it itself.
    expect(main.url()).toMatch(/^file:/);
    expect(demo.app.windows()).toHaveLength(1);

    // Only the available state links.
    await push(demo, { state: "downloading", version: "1.2.0-beta.1", percent: 3, dot: true });
    await expect(status.getByRole("link")).toHaveCount(0);
});

test("the switch's help says what each way does, and changes with it", async ({ demo }) => {
    const main = await demo.mainWindow();
    const pane = await openUpdate(main);
    const auto = pane.getByRole("switch", { name: "Download updates automatically" });
    await expect(auto).toHaveAccessibleDescription("Updates download by themselves and are installed when you close electron-kit Demo.");
    await auto.click();
    await expect(auto).toHaveAccessibleDescription("Updates are checked but not downloaded automatically. You'll be notified when one is available.");
    await auto.click();
    await expect(auto).toHaveAccessibleDescription("Updates download by themselves and are installed when you close electron-kit Demo.");
});

test("the tab is two cards in a column: the version, its status and the buttons, then the preferences", async ({ demo }) => {
    const main = await demo.mainWindow();
    const pane = await openUpdate(main);
    const version = await demo.app.evaluate(({ app }) => app.getVersion());
    const cards = pane.locator("section.card");
    await expect(cards).toHaveCount(2);
    await expect(pane.getByRole("region", { name: `Version ${version}` })).toBeVisible();
    await expect(pane.getByRole("region", { name: "Preferences" })).toBeVisible();
    await expect(pane.getByRole("heading", { level: 3 })).toHaveText([`Version ${version}`, "Preferences"]);
    // The status is under the version, the buttons under the status, side by side.
    await push(demo, { state: "available", version: "1.1.0", dot: true });
    const first = cards.first();
    const box = async (locator) => locator.boundingBox();
    const [v, s, c, d] = await Promise.all([first.locator("h3"), first.locator("#update-status"), first.getByRole("button", { name: "Check for Updates" }), first.getByRole("button", { name: "Download Update" })].map(box));
    expect(s.y).toBeGreaterThan(v.y);
    expect(c.y).toBeGreaterThan(s.y);
    expect(Math.abs(d.y - c.y)).toBeLessThan(2);
    expect(d.x).toBeGreaterThan(c.x);
    // A readable column, not the pane's width.
    const width = await pane.locator(".update-tab").evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(36 * 16 + 1);
});

test("the header's toolbar is hidden on Settings, out of the Tab order, and back on the app's sections", async ({ demo }) => {
    const main = await demo.mainWindow();
    const toolbar = main.locator(".app-toolbar");
    await expect(toolbar).toHaveCount(1);
    await expect(toolbar).toBeVisible();
    const header = await main.locator(".app-header").boundingBox();
    await openUpdate(main);
    await expect(toolbar).toBeHidden();
    expect((await main.locator(".app-header").boundingBox()).height, "the header keeps its height").toBe(header.height);
    await main.getByRole("button", { name: "Settings", exact: true }).focus();
    for (let i = 0; i < 8; i++) {
        await main.keyboard.press("Tab");
        expect(await main.evaluate(() => Boolean(document.activeElement?.closest(".app-toolbar")))).toBe(false);
    }
    await main.locator(".nav-rail .nav-item").first().click();
    await expect(toolbar).toBeVisible();
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
    await main.evaluate(() => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => {}))));
    ({ item, icon, dot } = await place());
    const centre = { x: (dot.left + dot.right) / 2, y: (dot.top + dot.bottom) / 2 };
    expect(centre.x).toBeGreaterThan(icon.left + icon.width / 2);
    expect(centre.x).toBeLessThanOrEqual(icon.right + 4);
    expect(centre.y).toBeLessThan(icon.top + icon.height / 2);
    expect(centre.y).toBeGreaterThanOrEqual(icon.top - 4);
    expect(dot.right).toBeLessThanOrEqual(item.right);
    // In the item's top-right corner, as far in from its right edge as from its top: as laid out, not as it breathes.
    const laidOut = await settings.evaluate((item) => {
        const dot = item.querySelector(".update-dot");
        return { top: dot.offsetTop, right: item.clientWidth - (dot.offsetLeft + dot.offsetWidth), size: dot.offsetWidth };
    });
    expect(laidOut).toEqual({ top: 5, right: 5, size: 6 });

    // Gone once there's no update waiting.
    await push(demo, { state: "none" });
    await expect(main.locator(".update-dot:visible")).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Settings", exact: true })).toHaveAccessibleName("Settings");
});

test("the dot breathes, slowly, wherever it shows, and is still under reduced motion", async ({ demo }) => {
    const main = await demo.mainWindow();
    await openUpdate(main);
    await push(demo, { state: "available", version: "1.1.0", dot: true });
    const dots = main.locator(".update-dot:visible");
    await expect(dots).toHaveCount(2);
    const breathing = () => dots.evaluateAll((all) => all.map((dot) => {
        const style = getComputedStyle(dot);
        return { name: style.animationName, seconds: parseFloat(style.animationDuration), times: style.animationIterationCount };
    }));
    for (const collapsed of [false, true]) {
        if (collapsed) await main.getByRole("button", { name: "Collapse", exact: true }).click();
        const found = await breathing();
        expect(found, collapsed ? "collapsed" : "expanded").toHaveLength(2);
        for (const one of found) {
            expect(one.name).toBe("kit-dot-breathe");
            expect(one.times).toBe("infinite");
            expect(one.seconds).toBeGreaterThanOrEqual(3);
            expect(one.seconds).toBeLessThanOrEqual(5);
        }
    }
    await main.emulateMedia({ reducedMotion: "reduce" });
    expect(await breathing()).toEqual([{ name: "none", seconds: 0, times: "1" }, { name: "none", seconds: 0, times: "1" }]);
    expect(await dots.evaluateAll((all) => all.map((dot) => [getComputedStyle(dot).opacity, getComputedStyle(dot).transform]))).toEqual([["1", "none"], ["1", "none"]]);
});

test("the download's bar shows only while it downloads, in the accent, and is gone the moment it ends", async ({ demo }) => {
    const main = await demo.mainWindow();
    const pane = await openUpdate(main);
    const bar = pane.getByRole("progressbar", { name: "Download progress" });
    await expect(pane.locator(".update-progress")).toBeHidden();
    for (const pushed of [{ state: "none" }, { state: "available", version: "1.1.0", dot: true }]) {
        await push(demo, pushed);
        await expect(pane.locator(".update-progress"), pushed.state).toBeHidden();
    }
    await push(demo, { state: "downloading", version: "1.1.0", percent: 0, dot: true });
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("aria-valuenow", "0");
    await push(demo, { state: "downloading", version: "1.1.0", percent: 62, dot: true });
    await expect(bar).toHaveAttribute("aria-valuenow", "62");
    // The accent's fill, as kit.ui.progress() draws it.
    const [fill, accent] = await bar.evaluate((el) => [getComputedStyle(el.querySelector(".progress-bar")).backgroundColor, getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()]);
    expect(parseColor(fill)).toEqual(parseColor(accent));

    // Finished: gone in the frame the state arrives in, never left at 100% or faded.
    const goneAtOnce = () => main.evaluate(() => new Promise((resolve) => {
        const el = document.querySelector(".update-progress");
        const stop = window.kitAPI.onUpdateStatus(() => requestAnimationFrame(() => {
            stop?.();
            resolve({ hidden: el.hidden, display: getComputedStyle(el).display });
        }));
    }));
    for (const ended of [{ state: "downloaded", version: "1.1.0", percent: 100, dot: true }, { state: "error", error: "download", version: "1.1.0", dot: true }]) {
        await push(demo, { state: "downloading", version: "1.1.0", percent: 90, dot: true });
        await expect(bar).toBeVisible();
        const seen = goneAtOnce();
        await push(demo, ended);
        expect(await seen, ended.state).toEqual({ hidden: true, display: "none" });
    }
    // The next download starts from empty.
    await push(demo, { state: "downloading", version: "1.1.0", percent: 0, dot: true });
    await expect(bar).toHaveAttribute("aria-valuenow", "0");
    expect(await bar.evaluate((el) => el.querySelector(".progress-bar").style.width)).toBe("0%");
});

test("the launch check waiting runs as soon as Settings > Update is on screen, once, and not before", async ({ demo }) => {
    const main = await demo.mainWindow();
    await spyOnUpdates(demo);
    const calls = () => demo.app.evaluate(() => globalThis.updateCalls);
    // Away from the tab, it waits.
    await main.getByRole("button", { name: "Settings", exact: true }).click();
    await main.getByRole("tab", { name: "Credits" }).click();
    await push(demo, { state: "idle", pending: true });
    await main.waitForTimeout(300);
    expect(await calls()).toEqual([]);

    const pane = await openUpdate(main);
    await expect.poll(calls).toEqual(["update:check"]);
    await expect(pane.locator("#update-status")).toHaveText("Updates haven't been checked yet.");
    // Back and forth, before main's answer: asked once.
    await main.getByRole("tab", { name: "Credits" }).click();
    await main.getByRole("tab", { name: /^Update/ }).click();
    await main.waitForTimeout(300);
    expect(await calls()).toEqual(["update:check"]);

    // On the tab when it arrives, it runs at once; with nothing pending, it never does.
    await push(demo, { state: "idle", pending: true });
    await expect.poll(calls).toEqual(["update:check", "update:check"]);
    await push(demo, { state: "idle" });
    await main.waitForTimeout(300);
    expect(await calls()).toEqual(["update:check", "update:check"]);
});

test("Restart Now takes Check for Updates' place once it has downloaded, with the focus, and installs at once", async ({ demo }) => {
    const main = await demo.mainWindow();
    const pane = await openUpdate(main);
    await spyOnUpdates(demo);
    const check = pane.getByRole("button", { name: "Check for Updates" });
    const restart = pane.getByRole("button", { name: "Restart Now" });
    await expect(restart).toHaveCount(0);
    // Run from source the updater is off and the button disabled: at rest, it can be pressed.
    await push(demo, { state: "idle" });
    await expect(check).toBeEnabled();
    await check.focus();
    await expect(check).toBeFocused();
    await push(demo, { state: "downloaded", version: "1.1.0", percent: 100, dot: true });
    await expect(restart).toBeVisible();
    await expect(check).toHaveCount(0);
    await expect(restart).toBeFocused();
    await expect(restart).toHaveClass(/btn-primary/);
    await restart.click();
    await expect.poll(() => demo.app.evaluate(() => globalThis.updateCalls)).toEqual(["update:install"]);
    await expect(main.locator("dialog[open]")).toHaveCount(0);

    // A move to a channel that drops the update brings Check for Updates back.
    await push(demo, { state: "idle" });
    await expect(check).toBeVisible();
    await expect(restart).toHaveCount(0);
});

test("when the app says it's busy, Restart Now asks first, with the app's reason, and Cancel installs nothing", async ({ demo }) => {
    const main = await demo.mainWindow();
    const pane = await openUpdate(main);
    await spyOnUpdates(demo);
    await main.evaluate(() => {
        window.demoBusy = "A conversion is running.";
    });
    await push(demo, { state: "downloaded", version: "1.1.0", percent: 100, dot: true });
    await pane.getByRole("button", { name: "Restart Now" }).click();
    const prompt = main.getByRole("alertdialog", { name: "Restart Now?" });
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText("A conversion is running.");
    await expect(prompt).toContainText("electron-kit Demo will close to install the update, and open again.");
    // A warning: the focus starts on Cancel.
    await expect(prompt.getByRole("button", { name: "Cancel" })).toBeFocused();
    await prompt.getByRole("button", { name: "Cancel" }).click();
    await expect(prompt).toHaveCount(0);
    expect(await demo.app.evaluate(() => globalThis.updateCalls)).toEqual([]);

    await pane.getByRole("button", { name: "Restart Now" }).click();
    await main.getByRole("alertdialog", { name: "Restart Now?" }).getByRole("button", { name: "Restart Now" }).click();
    await expect.poll(() => demo.app.evaluate(() => globalThis.updateCalls)).toEqual(["update:install"]);
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

test("axe finds nothing on the Update tab downloading or ready to restart, in both themes", async ({ demo }) => {
    const main = await demo.mainWindow();
    await openUpdate(main);
    const found = [];
    for (const theme of ["light", "dark"]) {
        await demo.useTheme(main, theme);
        for (const pushed of [{ state: "downloading", version: "1.1.0", percent: 45, dot: true }, { state: "downloaded", version: "1.1.0", percent: 100, dot: true }]) {
            await push(demo, pushed);
            await expect(main.locator(pushed.state === "downloading" ? ".update-progress" : "#update-restart")).toBeVisible();
            const { violations } = await new AxeBuilder({ page: main }).setLegacyMode(true).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
            found.push(...violations.flatMap((v) => v.nodes.map((n) => `${theme}, ${pushed.state}: ${v.id}: ${n.target.join(" ")}`)));
        }
    }
    expect(found).toEqual([]);
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
            await main.evaluate(() => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished.catch(() => {}))));
            const { violations } = await new AxeBuilder({ page: main }).setLegacyMode(true).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
            found.push(...violations.flatMap((v) => v.nodes.map((n) => `${theme}, ${collapsed ? "collapsed" : "expanded"}: ${v.id}: ${n.target.join(" ")}`)));
        }
    }
    expect(found).toEqual([]);
});
