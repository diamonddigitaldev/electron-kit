"use strict";

// The shell kit.ui.mountShell() builds, in real Electron: the nav rail (the
// demo's sections, then Settings above Collapse), routing between views, the
// collapsed rail and what it remembers, the Settings view's tabs, the house
// menu, and CmdOrCtrl+, reaching Settings.

const { test, expect } = require("./helpers/demo");

/** The rail's buttons' names, in order, as a screen reader has them. */
const railNames = (page) => page.getByRole("navigation", { name: "Sections" }).getByRole("button").evaluateAll(
    // Playwright's getByRole names each; read them back in document order.
    (buttons) => buttons.map((b) => b.getAttribute("aria-label") ?? b.querySelector(".nav-label").textContent),
);

/** Which views are showing. */
const showing = (page) => page.locator(".kit-view").evaluateAll((views) => views.filter((v) => v.checkVisibility()).map((v) => v.dataset.view));

/** The menu the app has set: each item's id, label, accelerator and role, submenus in place. */
const appMenu = (demo) => demo.app.evaluate(({ Menu }) => {
    const read = (menu) => menu.items.map((item) => ({
        ...(item.id && !/^\d+$/.test(item.id) ? { id: item.id } : {}),
        label: item.type === "separator" ? "—" : item.label,
        ...(item.accelerator ? { accelerator: item.accelerator } : {}),
        ...(item.role ? { role: item.role } : {}),
        ...(item.submenu ? { submenu: read(item.submenu) } : {}),
    }));
    return read(Menu.getApplicationMenu());
});

test("the rail has the app's sections, then Settings, then Collapse, each named by its label, and every icon hidden", async ({ demo }) => {
    const main = await demo.mainWindow();
    const rail = main.getByRole("navigation", { name: "Sections" });
    for (const name of ["Overview", "Controls", "Settings", "Collapse"]) {
        await expect(rail.getByRole("button", { name, exact: true })).toBeVisible();
    }
    expect(await railNames(main)).toEqual(["Overview", "Controls", "Settings", "Collapse"]);
    // Every Material Icons glyph on the page is hidden from screen readers, so no name reads "dashboard Overview".
    expect(await main.locator(".material-icons-round:not([aria-hidden=true])").count()).toBe(0);
    const snapshot = await main.locator("body").ariaSnapshot();
    for (const glyph of ["dashboard", "tune", "chevron_left", "open_in_new"]) expect(snapshot).not.toContain(glyph);
    // Settings sits at the bottom, directly above Collapse.
    const [settings, collapse, controls] = await Promise.all(["Settings", "Collapse", "Controls"].map((name) => rail.getByRole("button", { name, exact: true }).boundingBox()));
    expect(collapse.y - (settings.y + settings.height)).toBeLessThan(8);
    expect(settings.y - (controls.y + controls.height)).toBeGreaterThan(100);
});

test("the rail shows one view at a time, and marks its item active with aria-current", async ({ demo }) => {
    const main = await demo.mainWindow();
    const rail = main.getByRole("navigation", { name: "Sections" });
    const current = () => rail.locator("[aria-current=page]").evaluateAll((items) => items.map((i) => i.dataset.view));

    expect(await showing(main)).toEqual(["overview"]);
    expect(await current()).toEqual(["overview"]);
    for (const [name, view] of [["Controls", "controls"], ["Settings", "settings"], ["Overview", "overview"]]) {
        await rail.getByRole("button", { name, exact: true }).click();
        expect(await showing(main), name).toEqual([view]);
        expect(await current(), name).toEqual([view]);
        await expect(rail.locator(".nav-item.active")).toHaveCount(1);
    }
    // A view keeps its state while hidden: the demo's checkbox, unticked, is still unticked on return.
    await rail.getByRole("button", { name: "Controls", exact: true }).click();
    await main.getByLabel("A checked box").uncheck();
    await rail.getByRole("button", { name: "Overview", exact: true }).click();
    await rail.getByRole("button", { name: "Controls", exact: true }).click();
    await expect(main.getByLabel("A checked box")).not.toBeChecked();
});

test("Collapse has aria-expanded; collapsed, the labels are hidden visually but still name each item", async ({ demo }) => {
    const main = await demo.mainWindow();
    const rail = main.getByRole("navigation", { name: "Sections" });
    const collapse = rail.getByRole("button", { name: "Collapse", exact: true });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await expect(collapse).toHaveAttribute("aria-controls", "nav-rail");

    await collapse.click();
    const expand = rail.getByRole("button", { name: "Expand", exact: true });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect.poll(async () => (await rail.boundingBox()).width).toBe(56);
    // Still named, and still there to press, by the same names.
    expect(await railNames(main)).toEqual(["Overview", "Controls", "Settings", "Expand"]);
    for (const name of ["Overview", "Controls", "Settings", "Expand"]) {
        const item = rail.getByRole("button", { name, exact: true });
        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute("title", name);
    }
    // Hidden visually, not display: none (which would take the name with it).
    const labels = await rail.locator(".nav-label").evaluateAll((spans) => spans.map((s) => {
        const style = getComputedStyle(s);
        return { display: style.display, width: s.getBoundingClientRect().width, clipPath: style.clipPath };
    }));
    for (const label of labels) {
        expect(label.display).not.toBe("none");
        expect(label).toMatchObject({ width: 1, clipPath: "inset(50%)" });
    }

    await expand.click();
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => (await rail.boundingBox()).width).toBe(168);
    await expect(rail.getByRole("button", { name: "Overview", exact: true })).not.toHaveAttribute("title");
});

test("the collapsed rail and the app's own settings are remembered at the next launch, in the test's own profile", async ({ demo }) => {
    let main = await demo.mainWindow();
    // The kit's settings live in the throwaway profile, never in a real one.
    const userData = await demo.app.evaluate(({ app }) => app.getPath("userData"));
    expect(userData.toLowerCase()).toBe(demo.profile.toLowerCase());

    await main.getByRole("button", { name: "Collapse", exact: true }).click();
    await main.getByRole("button", { name: "Settings", exact: true }).click();
    await main.getByLabel("Show the accent sample").uncheck();
    await expect(main.locator("#accent-sample")).toBeHidden();

    await demo.relaunch();
    main = await demo.mainWindow();
    const rail = main.getByRole("navigation", { name: "Sections" });
    await expect(rail).toHaveClass(/\bcollapsed\b/);
    await expect(rail.getByRole("button", { name: "Expand", exact: true })).toHaveAttribute("aria-expanded", "false");
    // Put in place at once, not animated from wide to narrow.
    expect((await rail.boundingBox()).width).toBe(56);
    await expect(main.getByLabel("Show the accent sample")).not.toBeChecked();
    await expect(main.locator("#accent-sample")).toBeHidden();
});

test("Settings has tabs across the top: the app's own, then Update, then Credits last, with arrow keys, Home and End", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(main.getByRole("heading", { name: "Settings", level: 2 })).toBeVisible();
    const tablist = main.getByRole("tablist", { name: "Settings" });
    await expect(tablist.getByRole("tab")).toHaveText(["General", "Update", "Credits"]);
    const selected = () => tablist.getByRole("tab", { selected: true });
    const panel = () => main.getByRole("tabpanel");

    await expect(selected()).toHaveText("General");
    await expect(panel()).toHaveAccessibleName("General");
    // Only the selected tab is a Tab stop.
    await expect(tablist.locator("[role=tab][tabindex='0']")).toHaveCount(1);

    await selected().focus();
    for (const [key, name] of [["ArrowRight", "Update"], ["ArrowRight", "Credits"], ["ArrowRight", "General"], ["ArrowLeft", "Credits"], ["Home", "General"], ["End", "Credits"]]) {
        await main.keyboard.press(key);
        await expect(selected(), key).toHaveText(name);
        await expect(selected(), key).toBeFocused();
        await expect(panel(), key).toHaveAccessibleName(name);
        await expect(tablist.locator("[role=tab][tabindex='0']")).toHaveText(name);
    }
    // Tab leaves the tabs for the pane.
    await main.keyboard.press("Tab");
    await expect(panel()).toBeFocused();
    // A click selects too, and each pane keeps its content while hidden.
    await tablist.getByRole("tab", { name: "General" }).click();
    await expect(main.getByLabel("Show the accent sample")).toBeVisible();
    await expect(main.locator("#settings-pane-credits")).toBeHidden();
    await expect(main.locator("#settings-pane-credits .credits-name")).toHaveCount(1);
});

test("the Update tab shows the version until the updater arrives", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.getByRole("button", { name: "Settings", exact: true }).click();
    await main.getByRole("tab", { name: "Update" }).click();
    const version = await demo.app.evaluate(({ app }) => app.getVersion());
    await expect(main.getByRole("tabpanel", { name: "Update" })).toContainText(`Version ${version}`);
});

test("the menu is the house menu, with the demo's own item, Settings on CmdOrCtrl+, and no Credits", async ({ demo }) => {
    await demo.mainWindow();
    const version = await demo.app.evaluate(({ app }) => app.getVersion());
    expect(version, "the demo is a stable version, so it has no DevTools item").not.toContain("-");
    expect(await appMenu(demo)).toEqual([{
        label: "Menu",
        submenu: [
            { label: "Open Isolated Window", accelerator: "CmdOrCtrl+Shift+N" },
            { label: "—" },
            { id: "kit-settings", label: "Settings", accelerator: "CmdOrCtrl+," },
            { id: "kit-check-for-updates", label: "Check for Updates" },
            { label: "—" },
            { id: "kit-exit", label: "Exit", accelerator: "Alt+F4", role: "quit" },
        ],
    }]);
});

test("CmdOrCtrl+, reaches Settings from any view, and puts focus on its selected tab", async ({ demo }) => {
    const main = await demo.mainWindow();
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await main.getByRole("button", { name: "Controls", exact: true }).click();
    await main.getByLabel("A text field").click();

    // As the OS delivers it: Playwright's own keys come through DevTools, which never hands an unused key to the menu.
    await demo.pressKeys(main, ",", [modifier === "Meta" ? "meta" : "control"]);
    await expect.poll(() => showing(main)).toEqual(["settings"]);
    await expect(main.getByRole("tab", { selected: true })).toBeFocused();
    await expect(main.getByRole("button", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page");
    // Typing a comma into a text field is still a comma: the accelerator needs its modifier.
    await main.getByRole("button", { name: "Controls", exact: true }).click();
    await main.getByLabel("A text field").fill("");
    await main.getByLabel("A text field").pressSequentially("a,b");
    await expect(main.getByLabel("A text field")).toHaveValue("a,b");
    expect(await showing(main)).toEqual(["controls"]);
});

test("the menu's Settings and Check for Updates reach Settings, and its Update tab", async ({ demo }) => {
    const main = await demo.mainWindow();
    const click = (id) => demo.app.evaluate(({ Menu, BrowserWindow }, id) => {
        Menu.getApplicationMenu().getMenuItemById(id).click(undefined, BrowserWindow.getAllWindows()[0]);
    }, id);

    await click("kit-check-for-updates");
    await expect.poll(() => showing(main)).toEqual(["settings"]);
    await expect(main.getByRole("tab", { selected: true })).toHaveText("Update");
    await expect(main.getByRole("tab", { selected: true })).toBeFocused();

    await main.getByRole("button", { name: "Overview", exact: true }).click();
    await click("kit-settings");
    await expect.poll(() => showing(main)).toEqual(["settings"]);
    // Settings on its own keeps the tab last shown.
    await expect(main.getByRole("tab", { selected: true })).toHaveText("Update");
});

test("a view taller than the window scrolls, so nothing in it is out of reach", async ({ demo }) => {
    const main = await demo.mainWindow();
    // The demo's smallest window, where the Overview no longer fits.
    await (await demo.app.browserWindow(main)).evaluate((win) => win.setContentSize(480, 400));
    await expect.poll(() => main.evaluate(() => window.innerHeight)).toBe(400);
    const content = main.locator("main.app-content");
    expect(await content.evaluate((el) => el.scrollHeight > el.clientHeight), "the Overview is taller than the window").toBe(true);

    await content.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const button = main.getByRole("button", { name: "Primary Action" });
    await expect(button).toBeInViewport();
    // The rail and the header stay where they are.
    expect((await main.getByRole("heading", { level: 1 }).boundingBox()).y).toBeLessThan(30);
    await expect(main.getByRole("button", { name: "Settings", exact: true })).toBeInViewport();
});
