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
    await expect.poll(async () => (await rail.boundingBox()).width).toBe(57);
    // Still named, and still there to press, by the same names.
    expect(await railNames(main)).toEqual(["Overview", "Controls", "Settings", "Expand"]);
    for (const name of ["Overview", "Controls", "Settings", "Expand"]) {
        const item = rail.getByRole("button", { name, exact: true });
        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute("title", name);
    }
    // Faded out and clipped by the narrow item, not display: none (which would take the name with it).
    await expect.poll(() => rail.locator(".nav-label").evaluateAll((spans) => spans.map((s) => getComputedStyle(s).opacity))).toEqual(["0", "0", "0", "0"]);
    const labels = await rail.locator(".nav-label").evaluateAll((spans) => spans.map((s) => getComputedStyle(s).display));
    for (const display of labels) expect(display).not.toBe("none");

    await expand.click();
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => (await rail.boundingBox()).width).toBe(169);
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
    expect((await rail.boundingBox()).width).toBe(57);
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

test("each rail icon is drawn centred: in its item when collapsed, and on the item's middle line when expanded", async ({ demo }) => {
    const { inkBox } = require("./helpers/pixels");
    const main = await demo.mainWindow();
    const rail = main.getByRole("navigation", { name: "Sections" });
    const problems = [];
    for (const collapsed of [false, true]) {
        if (collapsed) {
            await rail.getByRole("button", { name: "Collapse", exact: true }).click();
            await expect.poll(async () => (await rail.boundingBox()).width).toBe(57);
        }
        // Clear of every item, so none is drawn hovered.
        await main.mouse.move(400, 300);
        for (const name of ["Overview", "Controls", "Settings", collapsed ? "Expand" : "Collapse"]) {
            const item = rail.getByRole("button", { name, exact: true });
            // The icon's own ink (not the label's), placed within the item.
            const { ink } = await inkBox(main, item.locator(".nav-icon"));
            const icon = await item.locator(".nav-icon").boundingBox();
            const box = await item.boundingBox();
            // Relative to the item's centre; a glyph's own drawing may be half a pixel off.
            const x = icon.x - box.x + (ink.left + ink.right) / 2 - box.width / 2;
            const y = icon.y - box.y + (ink.top + ink.bottom) / 2 - box.height / 2;
            const where = `${collapsed ? "collapsed" : "expanded"} "${name}"`;
            if (Math.abs(y) > 0.75) problems.push(`${where}: ${y.toFixed(2)}px off the middle line`);
            if (collapsed && Math.abs(x) > 0.75) problems.push(`${where}: ${x.toFixed(2)}px off centre across`);
            // On whole pixels, so the glyph isn't smeared across two.
            if (!Number.isInteger(icon.x - box.x) || !Number.isInteger(icon.y - box.y)) problems.push(`${where}: its icon sits at a fraction of a pixel`);
        }
    }
    expect(problems).toEqual([]);
});

test("each rail item has as much rail on its right, up to the edge's line, as on its left, collapsed and expanded", async ({ demo }) => {
    // The rail's edge is a 1px line drawn inside it, so an item centred in the whole rail
    // would sit a pixel nearer the line, which its border makes plain (Will's review of DFC).
    const main = await demo.mainWindow();
    const rail = main.getByRole("navigation", { name: "Sections" });
    const problems = [];
    for (const collapsed of [false, true]) {
        if (collapsed) {
            await rail.getByRole("button", { name: "Collapse", exact: true }).click();
            await expect.poll(async () => (await rail.boundingBox()).width).toBe(57);
        }
        const edge = await rail.evaluate((r) => getComputedStyle(r).boxShadow);
        if (!/inset -1px 0px 0px/.test(edge) && !/-1px 0px 0px 0px .*inset/.test(edge)) problems.push(`the edge isn't a 1px inset line: ${edge}`);
        const box = await rail.boundingBox();
        for (const name of ["Overview", "Controls", "Settings", collapsed ? "Expand" : "Collapse"]) {
            const item = await rail.getByRole("button", { name, exact: true }).boundingBox();
            const left = item.x - box.x;
            const right = box.x + box.width - 1 - (item.x + item.width);
            if (left !== right) problems.push(`${collapsed ? "collapsed" : "expanded"} "${name}": ${left}px of rail on its left, ${right}px on its right`);
        }
    }
    expect(problems).toEqual([]);
});

test("the Settings tabs sit on a thin line, with an accent bar that slides to the selected tab at its text's width", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.getByRole("button", { name: "Settings", exact: true }).click();
    const tablist = main.getByRole("tablist", { name: "Settings" });
    const bar = tablist.locator(".settings-tab-indicator");
    const accent = await main.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
    const line = await tablist.evaluate((el) => ({ width: getComputedStyle(el).borderBottomWidth, style: getComputedStyle(el).borderBottomStyle }));
    expect(line).toEqual({ width: "1px", style: "solid" });
    await expect(bar).toHaveAttribute("aria-hidden", "true");

    /** Where the bar is against the selected tab, once any move has finished. */
    const placement = async () => {
        await bar.evaluate(async (el) => {
            for (let running = el.getAnimations(); running.length; running = el.getAnimations()) {
                await Promise.all(running.map((a) => a.finished.catch(() => {})));
            }
        });
        const [b, t, l] = await Promise.all([bar.boundingBox(), tablist.getByRole("tab", { selected: true }).boundingBox(), tablist.boundingBox()]);
        const r = (n) => Math.round(n) || 0;
        return { left: r(b.x - t.x), width: r(b.width - t.width), height: b.height, onTheLine: r(b.y + b.height - (l.y + l.height)) };
    };
    // Laid out at once when the view is first shown.
    expect(await placement()).toEqual({ left: 0, width: 0, height: 3, onTheLine: 0 });
    await expect(bar).toHaveCSS("background-color", await main.evaluate((c) => { const d = document.createElement("div"); d.style.color = c; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; }, accent));

    const widths = new Set();
    for (const name of ["Update", "Credits", "General"]) {
        await tablist.getByRole("tab", { name }).click();
        // It moves by animating: the move is running just after the click.
        expect(await bar.evaluate((el) => el.getAnimations().length), name).toBeGreaterThan(0);
        expect(await placement(), name).toEqual({ left: 0, width: 0, height: 3, onTheLine: 0 });
        widths.add((await bar.boundingBox()).width);
    }
    // Each tab's text is its own width, so the bar changes width too.
    expect(widths.size).toBe(3);
});

test("a checkbox's tick is drawn when ticked and springs away when unticked, a switch's knob slides across, in the accent, and both stop moving under reduced motion", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.getByRole("button", { name: "Controls", exact: true }).click();
    const box = main.getByLabel("A checked box");
    const toggle = main.getByLabel("A switch, off");

    /** A pseudo-element's scale (the tick's) or x offset (the knob's), from its computed transform, once it has settled. */
    const drawn = (locator, pseudo) => locator.evaluate(async (el, pseudo) => {
        // Until nothing is moving. A transition cut short (a press let go) rejects its finished, and starts
        // another; a finished animation that fills forward stays listed, so only unfinished ones count, and
        // a frame goes by between rounds so the page's own animationend handlers run.
        const moving = () => el.getAnimations({ subtree: true }).filter((a) => a.playState !== "finished");
        for (let running = moving(); running.length; running = moving()) {
            await Promise.all(running.map((a) => a.finished.catch(() => {})));
            await new Promise(requestAnimationFrame);
        }
        await new Promise(requestAnimationFrame);
        const m = new DOMMatrix(getComputedStyle(el, pseudo).transform);
        return { scale: Math.round(Math.hypot(m.a, m.b) * 100) / 100, x: Math.round(m.e * 10) / 10 };
    }, pseudo);
    // Every transition each control starts, recorded as it starts, so a busy machine that has already
    // finished one by the time the test looks still shows it ran.
    await main.locator("#controls-view").evaluate((view) => {
        window.transitionsRun = [];
        view.addEventListener("transitionrun", (event) => window.transitionsRun.push(`${event.target.id}${event.pseudoElement} ${event.propertyName}`));
        view.addEventListener("animationstart", (event) => window.transitionsRun.push(`${event.target.id}${event.pseudoElement} ${event.animationName}`));
    });
    const started = () => main.evaluate(() => window.transitionsRun.splice(0));
    /** How long a pseudo-element's transitions last, in ms, as its computed style says. */
    const durations = (locator, pseudo) => locator.evaluate((el, pseudo) => getComputedStyle(el, pseudo).transitionDuration.split(",").map((d) => parseFloat(d) * (d.trim().endsWith("ms") ? 1 : 1000)), pseudo);

    expect((await drawn(box, "::after")).scale, "checked: the tick is drawn").toBe(1);
    expect(await box.evaluate((el) => getComputedStyle(el).backgroundImage), "Bootstrap's still image is gone").toBe("none");
    expect(await durations(box, "::after"), "the tick springs over the state duration").toEqual([200]);
    expect(await durations(toggle, "::before"), "the knob: transform, width, colour").toEqual([200, 120, 200]);
    await started();

    await box.uncheck();
    expect((await drawn(box, "::after")).scale).toBe(0);
    expect(await started(), "unchecking shrinks the tick away").toContain("sample-check::after transform");
    await box.check();
    expect((await drawn(box, "::after")).scale).toBe(1);
    const onCheck = await started();
    expect(onCheck, "ticking draws the tick").toContain("sample-check::after kit-tick-draw");
    expect(onCheck, "rather than springing it in").not.toContain("sample-check::after transform");
    // Drawn once: the mark asking for it is gone, and showing the view again doesn't draw it again.
    await expect(box).not.toHaveAttribute("data-kit-tick");
    await main.getByRole("button", { name: "Overview", exact: true }).click();
    await main.getByRole("button", { name: "Controls", exact: true }).click();
    expect((await drawn(box, "::after")).scale).toBe(1);
    expect(await started(), "shown again, the tick is simply there").toEqual([]);
    // Checked by the page, not a person: there at once, not drawn.
    await box.evaluate((el) => { el.checked = false; });
    await drawn(box, "::after");
    await started();
    await box.evaluate((el) => { el.checked = true; });
    expect((await drawn(box, "::after")).scale).toBe(1);
    expect(await started()).not.toContain("sample-check::after kit-tick-draw");
    // Ticked by keyboard, it's drawn too.
    await box.uncheck();
    await drawn(box, "::after");
    await started();
    await box.focus();
    await main.keyboard.press("Space");
    expect((await drawn(box, "::after")).scale).toBe(1);
    expect(await started()).toContain("sample-check::after kit-tick-draw");

    const off = await drawn(toggle, "::before");
    await toggle.check();
    const on = await drawn(toggle, "::before");
    expect(await started(), "the knob slides").toContain("sample-switch::before transform");
    // One em across: the switch is 2em wide and the knob travels the difference.
    expect(on.x - off.x).toBeCloseTo(16, 0);
    const colours = await toggle.evaluate((el) => ({ track: getComputedStyle(el).backgroundColor, knob: getComputedStyle(el, "::before").backgroundColor }));
    expect(colours).toEqual({ track: "rgb(13, 110, 253)", knob: "rgb(255, 255, 255)" });

    // Reduced motion: the same changes, with nothing left to watch.
    await main.emulateMedia({ reducedMotion: "reduce" });
    for (const duration of [...await durations(box, "::after"), ...await durations(toggle, "::before")]) expect(duration).toBeLessThan(1);
    await toggle.uncheck();
    expect((await drawn(toggle, "::before")).x).toBe(off.x);
});

test("the rail closes and opens smoothly: the icons never move, and the labels fade as the rail narrows", async ({ demo }) => {
    const main = await demo.mainWindow();
    const rail = main.getByRole("navigation", { name: "Sections" });
    await main.mouse.move(400, 300);

    /** Press a rail button from the page and record every frame until the rail stops moving. */
    const watch = (name) => rail.evaluate(async (nav, name) => {
        const button = [...nav.querySelectorAll("button")].find((b) => b.querySelector(".nav-label").textContent === name);
        const icons = [...nav.querySelectorAll(".nav-icon")];
        const label = nav.querySelector(".nav-item .nav-label");
        const frames = [];
        const sample = () => frames.push({
            width: nav.getBoundingClientRect().width,
            // Centres: the Collapse chevron turns as it goes, which widens its box but never moves its centre.
            icons: icons.map((i) => { const r = i.getBoundingClientRect(); return Math.round((r.left + r.right) * 50) / 100; }),
            labelLeft: label.getBoundingClientRect().left,
            opacity: Number(getComputedStyle(label).opacity),
        });
        sample();
        button.click();
        const end = performance.now() + 600;
        while (performance.now() < end) {
            await new Promise(requestAnimationFrame);
            sample();
        }
        return frames;
    }, name);

    for (const [name, from, to] of [["Collapse", 169, 57], ["Expand", 57, 169]]) {
        const frames = await watch(name);
        const where = `${name}: ${JSON.stringify(frames.map((f) => [Math.round(f.width), f.icons[0], Math.round(f.opacity * 100) / 100]))}`;
        expect(frames[0].width, where).toBe(from);
        expect(frames.at(-1).width, where).toBe(to);
        // It animated: the rail passed through widths in between.
        expect(frames.some((f) => f.width > 57 && f.width < 169), where).toBe(true);
        // No icon moved at all, in any frame, and nor did the labels.
        for (const i of frames[0].icons.keys()) expect(new Set(frames.map((f) => f.icons[i])).size, `${where}: icon ${i}`).toBe(1);
        expect(new Set(frames.map((f) => f.labelLeft)).size, `${where}: the label`).toBe(1);
        // The labels faded through values in between rather than vanishing, ending hidden or shown.
        expect(frames.some((f) => f.opacity > 0.05 && f.opacity < 0.95), where).toBe(true);
        expect(frames.at(-1).opacity, where).toBe(name === "Collapse" ? 0 : 1);
    }
});
