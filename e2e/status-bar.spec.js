"use strict";

// The bottom bar kit.ui.mountShell({ statusBar }) adds, and kit.ui.statusLine(),
// in real Electron: the bar hidden until shown, then under the rail and the
// sections with nothing scrolling; its item's name and expanded state; its
// panel opened by a click, Enter and Space, taking the focus, and each way out
// (Escape, Close, Tab past its last control, Shift+Tab before its first, a
// click outside, the app's close()) with the focus going back to the item, or
// staying where a click put it; one panel at a time; an item read out as it
// changes only when it asks; the options' refusals; and the status line's
// tones and refusals. The demo's bar has one item (Checks); a test needing
// other items mounts a shell of its own in the demo's page in place of the
// demo's. axe on the bar and its panel is in accessibility.spec.js, their
// focus rings in keyboard.spec.js, and their look in visual.spec.js.

const { test, expect } = require("./helpers/demo");

/** The demo's window, with its bar shown. */
async function withBar(demo) {
    const main = await demo.mainWindow();
    await main.evaluate(() => window.demoShell.statusBar.show(true));
    return main;
}

/**
 * Put a shell of the test's own in place of the demo's: one section, and the
 * bar's items given, each filled with its own text and, in its panel, two
 * buttons. The bar is shown; the shell is window.remounted.
 */
const remount = (page, items, { show = true } = {}) => page.evaluate(({ items, show }) => {
    document.querySelector(".app-frame").remove();
    document.querySelector(".kit-statusbar")?.remove();
    const section = document.createElement("div");
    section.textContent = "A section of the test's own.";
    const shell = window.kit.ui.mountShell({
        title: "A Test App",
        sections: [{ view: "only", label: "Only", icon: "dashboard", element: section }],
        ...(items ? { statusBar: { items } } : {}),
    });
    window.remounted = shell;
    for (const { id } of items ?? []) {
        const item = shell.statusBar.item(id);
        item.button.textContent = `${id} is fine`;
        for (const label of ["First", "Last"]) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = `${label} of ${id}`;
            item.panel.append(button);
        }
    }
    if (items && show) shell.statusBar.show(true);
}, { items, show });

/** The error a call in the page throws, or null. */
const thrown = (page, fn, arg) => page.evaluate(([source, arg]) => {
    try {
        // eslint-disable-next-line no-new-func
        new Function("arg", source)(arg);
        return null;
    } catch (err) {
        return err.message;
    }
}, [fn, arg]);

/** What has the focus: its id, or its tag. */
const focusedId = (page) => page.evaluate(() => document.activeElement.id || document.activeElement.tagName.toLowerCase());

test("the bar is hidden until shown, then sits under the rail and the sections, 26px, with nothing scrolling", async ({ demo }) => {
    const main = await demo.mainWindow();
    const bar = main.locator("footer.kit-statusbar");
    await expect(bar).toBeAttached();
    await expect(bar).toBeHidden();
    const frameHeight = () => main.locator(".app-frame").evaluate((frame) => frame.getBoundingClientRect().height);
    expect(await frameHeight()).toBe(await main.evaluate(() => innerHeight));

    await main.evaluate(() => window.demoShell.statusBar.show(true));
    await expect(bar).toBeVisible();
    const layout = await main.evaluate(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        const style = getComputedStyle(document.querySelector(".kit-statusbar"));
        return {
            window: [innerWidth, innerHeight],
            bar: box(".kit-statusbar").toJSON(),
            rail: box(".nav-rail").bottom,
            column: box(".app-shell").bottom,
            frame: box(".app-frame").height,
            scrolls: [document.scrollingElement.scrollHeight, document.scrollingElement.scrollWidth],
            follows: document.querySelector(".app-frame").nextElementSibling === document.querySelector(".kit-statusbar"),
            border: [style.borderTopWidth, style.borderTopStyle, style.borderTopColor, style.borderBottomWidth],
            background: style.backgroundColor,
            tertiary: (() => {
                const probe = document.createElement("div");
                probe.style.backgroundColor = "var(--bs-tertiary-bg)";
                document.body.append(probe);
                const colour = getComputedStyle(probe).backgroundColor;
                probe.remove();
                return colour;
            })(),
            borderColour: getComputedStyle(document.querySelector(".kit-card") ?? document.body).getPropertyValue("--bs-border-color").trim(),
            fontSize: style.fontSize,
        };
    });
    const [width, height] = layout.window;
    // Across the whole window at its bottom, under the rail as well as the column, which end where it starts.
    expect(layout.bar).toMatchObject({ x: 0, width, height: 26, bottom: height });
    expect(layout.rail).toBe(layout.bar.top);
    expect(layout.column).toBe(layout.bar.top);
    expect(layout.frame).toBe(height - 26);
    expect(layout.scrolls).toEqual([height, width]);
    expect(layout.follows).toBe(true);
    expect(layout.border.slice(0, 2)).toEqual(["1px", "solid"]);
    expect(layout.border[3]).toBe("0px");
    expect(layout.background).toBe(layout.tertiary);
    expect(layout.fontSize).toBe("12px");

    // Hidden again, the frame takes the whole window once more.
    await main.evaluate(() => window.demoShell.statusBar.show(false));
    await expect(bar).toBeHidden();
    expect(await frameHeight()).toBe(height);
});

test("without statusBar there's no bar, and the frame is as it was", async ({ demo }) => {
    const main = await demo.mainWindow();
    await remount(main, null);
    await expect(main.locator(".kit-statusbar")).toHaveCount(0);
    expect(await main.evaluate(() => window.remounted.statusBar)).toBeNull();
    expect(await main.locator(".app-frame").evaluate((frame) => [frame.getBoundingClientRect().height === innerHeight, frame.className])).toEqual([true, "app-frame"]);
});

test("an item is a button named by its label and its content, with aria-haspopup, aria-expanded and aria-controls", async ({ demo }) => {
    const main = await withBar(demo);
    // The wash read at rest, not partway in.
    await main.emulateMedia({ reducedMotion: "reduce" });
    const item = main.getByRole("button", { name: "Checks All Checks Passed", exact: true });
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute("aria-haspopup", "dialog");
    await expect(item).toHaveAttribute("aria-expanded", "false");
    const panelId = await item.getAttribute("aria-controls");
    const panel = main.locator(`[id="${panelId}"]`);
    await expect(panel).toHaveAttribute("role", "dialog");
    await expect(panel).toBeHidden();
    // Its label is in the page only for its name.
    await expect(main.getByText("Checks", { exact: true })).toBeHidden();

    await item.click();
    await expect(item).toHaveAttribute("aria-expanded", "true");
    await expect(main.getByRole("dialog", { name: "Check Details" })).toBeVisible();
    // Washed while open, the pointer gone from it.
    await main.mouse.move(400, 12);
    // Its status line's title says what its colour means.
    await expect(item.locator(".kit-status-text")).toHaveAttribute("title", "Every check on the Overview passed.");
    // Borderless, and washed in the accent while it's open.
    const look = await item.evaluate((button) => {
        const style = getComputedStyle(button);
        return { border: style.borderTopWidth, background: style.backgroundColor, height: button.getBoundingClientRect().height };
    });
    expect(look.border).toBe("0px");
    expect(look.background).toMatch(/^rgba\(13, 110, 253, 0\.04\)$/);
    expect(look.height).toBe(22);
    await item.click();
    await expect(item).toHaveAttribute("aria-expanded", "false");
});

test("the panel opens on a click, Enter or Space, over its item, takes the focus, and holds the app's own elements beside Close", async ({ demo }) => {
    const main = await withBar(demo);
    const item = main.locator("#kit-statusbar-checks");
    const panel = main.getByRole("dialog", { name: "Check Details" });
    for (const how of ["click", "Enter", "Space"]) {
        if (how === "click") {
            await item.click();
        } else {
            await item.focus();
            await main.keyboard.press(how);
        }
        await expect(panel, how).toBeVisible();
        await expect(panel, how).toBeFocused();
        await main.keyboard.press("Escape");
        await expect(panel, how).toBeHidden();
    }

    await item.click();
    const place = await main.evaluate(() => {
        const panel = document.querySelector("#kit-statusbar-checks-panel").getBoundingClientRect();
        const bar = document.querySelector(".kit-statusbar").getBoundingClientRect();
        return { left: panel.left, width: panel.width, gap: bar.top - panel.bottom };
    });
    // 360px, as the demo asks; 6px over the bar, its left edge 8px from the window's.
    expect(place).toEqual({ left: 8, width: 360, gap: 6 });
    // The kit's Close first, at its top right, then the demo's own.
    expect(await panel.getByRole("button").allTextContents()).toEqual(["close", "Check Again", "Show Overview"]);
    await expect(panel.getByRole("button", { name: "Close", exact: true })).toHaveAttribute("title", "Close");
    await expect(panel.getByRole("term")).toHaveText(["Shared Bridge", "App Bridge", "Sandboxed", "Page Library", "Kit Styles"]);
    const close = await panel.getByRole("button", { name: "Close", exact: true }).boundingBox();
    const box = await panel.boundingBox();
    expect(box.x + box.width - (close.x + close.width)).toBeGreaterThan(10);
    expect(close.y - box.y).toBeLessThan(16);
});

test("a panel wider than the window is capped to it", async ({ demo }) => {
    const main = await demo.mainWindow();
    await remount(main, [{ id: "wide", label: "Wide", panel: { label: "Wide Details", width: 5000 } }]);
    await main.getByRole("button", { name: "Wide wide is fine" }).click();
    const [width, left] = await main.getByRole("dialog", { name: "Wide Details" }).evaluate((panel) => [panel.getBoundingClientRect().width, panel.getBoundingClientRect().left]);
    expect(width).toBe(await main.evaluate(() => innerWidth - 16));
    expect(left).toBe(8);
});

test("Escape, Close and Tab past the last control close the panel, the focus back on its item; so does Shift+Tab before the first", async ({ demo }) => {
    const main = await withBar(demo);
    const item = main.locator("#kit-statusbar-checks");
    const panel = main.getByRole("dialog", { name: "Check Details" });
    const ways = {
        Escape: () => main.keyboard.press("Escape"),
        Close: () => panel.getByRole("button", { name: "Close", exact: true }).click(),
        "Close by keyboard": async () => {
            await main.keyboard.press("Tab");
            await expect(panel.getByRole("button", { name: "Close", exact: true })).toBeFocused();
            await main.keyboard.press("Enter");
        },
        "Tab past the last": async () => {
            // Close, Check Again, Show Overview, then out.
            for (const name of ["Close", "Check Again", "Show Overview"]) {
                await main.keyboard.press("Tab");
                await expect(panel.getByRole("button", { name, exact: true })).toBeFocused();
            }
            await main.keyboard.press("Tab");
        },
        "Shift+Tab before the first": async () => {
            await main.keyboard.press("Tab");
            await main.keyboard.press("Shift+Tab");
        },
        "Shift+Tab from the panel": () => main.keyboard.press("Shift+Tab"),
    };
    for (const [way, leave] of Object.entries(ways)) {
        await item.focus();
        await main.keyboard.press("Enter");
        await expect(panel, way).toBeFocused();
        await leave();
        await expect(panel, way).toBeHidden();
        await expect(item, way).toBeFocused();
        await expect(item, way).toHaveAttribute("aria-expanded", "false");
    }
});

test("a click outside closes the panel and leaves the focus where it put it; a click inside doesn't close it", async ({ demo }) => {
    const main = await withBar(demo);
    const item = main.locator("#kit-statusbar-checks");
    const panel = main.getByRole("dialog", { name: "Check Details" });

    // Inside, on its text: it stays open, the focus in it.
    await item.click();
    await panel.getByRole("term").first().click();
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((p) => p.contains(document.activeElement))).toBe(true);

    // Outside, on the page's text: closed, and the focus not sent back to the item.
    await main.getByRole("heading", { name: "Accent" }).click();
    await expect(panel).toBeHidden();
    expect(await focusedId(main)).toBe("body");

    // Outside, on another control: closed, the focus on that control.
    await item.click();
    await main.getByRole("button", { name: "Controls", exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(main.getByRole("button", { name: "Controls", exact: true })).toBeFocused();

    // Tabbing to the page's own controls while it's open (a focus moved by the app): closed behind it.
    await item.click();
    await main.getByRole("button", { name: "Overview", exact: true }).focus();
    await expect(panel).toBeHidden();
});

test("the app's own buttons work in the panel: Check Again checks, read out as it changes, and Show Overview closes it", async ({ demo }) => {
    const main = await withBar(demo);
    const item = main.locator("#kit-statusbar-checks");
    const panel = main.getByRole("dialog", { name: "Check Details" });
    await main.getByRole("button", { name: "Controls", exact: true }).click();
    await item.click();
    await panel.getByRole("button", { name: "Check Again" }).click();
    await expect(item).toHaveAccessibleName("Checks Checking…");
    await expect(panel.getByRole("button", { name: "Checking…" })).toBeDisabled();
    await expect(item).toHaveAccessibleName("Checks All Checks Passed");
    await expect(panel).toBeVisible();

    // The app's close(), with the focus in the panel: it goes back to the item before the app moves on.
    await panel.getByRole("button", { name: "Show Overview" }).click();
    await expect(panel).toBeHidden();
    await expect(item).toBeFocused();
    await expect(main.locator("#overview-view")).toBeVisible();
    expect(await main.evaluate(() => window.demoShell.statusBar.item("checks").opened)).toBe(false);
});

test("open(), close() and opened, from the app; show(false) closes an open panel; one panel is open at a time", async ({ demo }) => {
    const main = await demo.mainWindow();
    await remount(main, [
        { id: "first", label: "First", panel: { label: "First Details", width: 300 } },
        { id: "second", label: "Second", panel: { label: "Second Details", width: 300 } },
    ]);
    const first = main.getByRole("dialog", { name: "First Details" });
    const second = main.getByRole("dialog", { name: "Second Details" });
    const opened = () => main.evaluate(() => ["first", "second"].map((id) => window.remounted.statusBar.item(id).opened));

    await main.evaluate(() => window.remounted.statusBar.item("first").open());
    await expect(first).toBeFocused();
    expect(await opened()).toEqual([true, false]);
    // The second, by a click on its item: the first closes as it opens.
    await main.getByRole("button", { name: "Second second is fine" }).click();
    await expect(second).toBeFocused();
    await expect(first).toBeHidden();
    expect(await opened()).toEqual([false, true]);
    await expect(main.locator(".kit-statusbar-item[aria-expanded=true]")).toHaveCount(1);
    // The second's panel sits over its own item.
    const [panelLeft, itemLeft] = await main.evaluate(() => ["#kit-statusbar-second-panel", "#kit-statusbar-second"].map((s) => document.querySelector(s).getBoundingClientRect().left));
    expect(panelLeft).toBe(itemLeft);

    // The app's close(): closed, the focus back on the item it was in.
    await main.evaluate(() => window.remounted.statusBar.item("second").close());
    await expect(second).toBeHidden();
    await expect(main.locator("#kit-statusbar-second")).toBeFocused();
    expect(await opened()).toEqual([false, false]);

    // Hiding the bar closes what's open.
    await main.evaluate(() => window.remounted.statusBar.item("first").open());
    await main.evaluate(() => window.remounted.statusBar.show(false));
    await expect(first).toBeHidden();
    expect(await opened()).toEqual([false, false]);
    await expect(main.locator("#kit-statusbar-first")).toHaveAttribute("aria-expanded", "false");
});

test("an item is read out as it changes only when it asks (live), and the bar itself never is", async ({ demo }) => {
    const main = await withBar(demo);
    const demoItem = main.locator("#kit-statusbar-checks");
    await expect(demoItem).toHaveAttribute("aria-live", "polite");
    await expect(demoItem).toHaveAttribute("aria-atomic", "true");

    await remount(main, [
        { id: "quiet", label: "Quiet", panel: { label: "Quiet Details", width: 300 } },
        { id: "loud", label: "Loud", live: true, panel: { label: "Loud Details", width: 300 } },
        { id: "said", label: "Said", live: false, panel: { label: "Said Details", width: 300 } },
    ]);
    const live = await main.evaluate(() => ({
        bar: [...document.querySelector(".kit-statusbar").attributes].map((a) => a.name),
        items: [...document.querySelectorAll(".kit-statusbar-item")].map((b) => [b.id, b.getAttribute("aria-live"), b.getAttribute("aria-atomic")]),
        regions: document.querySelectorAll(".kit-statusbar [aria-live], .kit-statusbar [role=status], .kit-statusbar [role=log]").length,
    }));
    expect(live.bar).toEqual(["class"]);
    expect(live.items).toEqual([
        ["kit-statusbar-quiet", null, null],
        ["kit-statusbar-loud", "polite", "true"],
        ["kit-statusbar-said", null, null],
    ]);
    expect(live.regions).toBe(1);
});

test("the bar's options, show(), item() and open() are checked, each refused with what it must be", async ({ demo }) => {
    const main = await demo.mainWindow();
    const panel = { label: "Details", width: 300 };
    const item = { id: "net", label: "Connection", panel };
    const refusals = [
        [null, "statusBar must be { items }."],
        [[], "statusBar must be { items }."],
        [{ items: [item], size: 26 }, 'statusBar has no option "size".'],
        [{}, "statusBar.items must be a list of one or more."],
        [{ items: [] }, "statusBar.items must be a list of one or more."],
        [{ items: [null] }, "statusBar.items[0] must be { id, label, live, panel }."],
        [{ items: [{ ...item, element: "x" }] }, 'statusBar.items[0] has no option "element".'],
        [{ items: [{ ...item, id: "Net" }] }, "statusBar.items[0].id must be a lowercase name."],
        [{ items: [{ ...item, id: undefined }] }, "statusBar.items[0].id must be a lowercase name."],
        [{ items: [item, item] }, 'statusBar.items[1].id "net" is taken.'],
        [{ items: [{ ...item, label: "" }] }, "statusBar.items[0].label must be its name."],
        [{ items: [{ ...item, live: "yes" }] }, "statusBar.items[0].live must be true or false."],
        [{ items: [{ id: "net", label: "Connection" }] }, "statusBar.items[0].panel must be { label, width }."],
        [{ items: [{ ...item, panel: { ...panel, height: 1 } }] }, 'statusBar.items[0].panel has no option "height".'],
        [{ items: [{ ...item, panel: { width: 300 } }] }, "statusBar.items[0].panel.label must be its name."],
        [{ items: [{ ...item, panel: { label: "Details" } }] }, "statusBar.items[0].panel.width must be its width in pixels, a whole number."],
        [{ items: [{ ...item, panel: { ...panel, width: 0 } }] }, "statusBar.items[0].panel.width must be its width in pixels, a whole number."],
        [{ items: [{ ...item, panel: { ...panel, width: 300.5 } }] }, "statusBar.items[0].panel.width must be its width in pixels, a whole number."],
        [{ items: [{ ...item, panel: { ...panel, width: "440px" } }] }, "statusBar.items[0].panel.width must be its width in pixels, a whole number."],
    ];
    for (const [statusBar, message] of refusals) {
        // Refused before anything is built, so the demo's own shell is still the only one.
        const said = await thrown(main, "window.kit.ui.mountShell({ title: 'A Test App', statusBar: arg });", statusBar);
        expect(said, JSON.stringify(statusBar)).toBe(`kit.ui.mountShell(): ${message}`);
    }
    await expect(main.locator(".app-frame")).toHaveCount(1);
    await expect(main.locator(".kit-statusbar")).toHaveCount(1);

    const bar = "window.demoShell.statusBar";
    expect(await thrown(main, `${bar}.show("yes");`)).toBe("kit.ui.mountShell(): statusBar.show() takes true or false.");
    expect(await thrown(main, `${bar}.show();`)).toBe("kit.ui.mountShell(): statusBar.show() takes true or false.");
    expect(await thrown(main, `${bar}.item("network");`)).toBe('kit.ui.mountShell(): statusBar has no item "network".');
    // Hidden, nothing opens.
    expect(await thrown(main, `${bar}.item("checks").open();`)).toBe('kit.ui.mountShell(): statusBar.item("checks").open(): the bar is hidden; show it first.');
    await expect(main.locator(".kit-statusbar-panel:visible")).toHaveCount(0);
});

test("kit.ui.statusLine() is the card's status line on its own: a span with its dot and text, in each tone, its title the text unless given", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.emulateMedia({ reducedMotion: "no-preference" });
    const lines = await main.evaluate(() => {
        const host = document.createElement("div");
        host.id = "lines";
        document.getElementById("overview-view").prepend(host);
        return ["ready", "running", "warning", "danger", "success", "muted"].map((tone) => {
            const line = window.kit.ui.statusLine({ text: `It's ${tone}`, tone });
            host.append(line.element);
            const dot = line.element.querySelector(".kit-status-dot");
            const text = line.element.querySelector(".kit-status-text");
            return {
                tag: line.element.tagName.toLowerCase(),
                className: line.element.className,
                parts: [...line.element.children].map((child) => `${child.tagName.toLowerCase()}.${child.className}`),
                text: text.textContent,
                title: text.title,
                display: getComputedStyle(line.element).display,
                pulse: getComputedStyle(dot).animationName,
                textColour: getComputedStyle(text).color,
            };
        });
    });
    for (const line of lines) {
        const tone = line.className.replace("kit-card-status kit-tone-", "");
        expect(line).toMatchObject({ tag: "span", parts: ["span.kit-status-dot", "span.kit-status-text"], text: `It's ${tone}`, title: `It's ${tone}`, display: "flex" });
        expect(line.pulse, tone).toBe(tone === "running" ? "kit-status-pulse" : "none");
    }
    expect(lines.map((l) => l.className)).toEqual(["ready", "running", "warning", "danger", "success", "muted"].map((t) => `kit-card-status kit-tone-${t}`));
    // Each tone's text in its own colour, as a card's.
    expect(new Set(lines.map((l) => l.textColour)).size).toBeGreaterThanOrEqual(5);

    // set() takes the whole of it again: a title given, then left out (the text again).
    const after = await main.evaluate(() => {
        const line = window.kit.ui.statusLine({ text: "Connected", tone: "success", title: "Connected, through whichever adapter Windows chooses." });
        const read = () => [line.element.className, line.element.textContent, line.element.querySelector(".kit-status-text").title];
        const first = read();
        line.set({ text: "Checking…", tone: "running" });
        return [first, read()];
    });
    expect(after).toEqual([
        ["kit-card-status kit-tone-success", "Connected", "Connected, through whichever adapter Windows chooses."],
        ["kit-card-status kit-tone-running", "Checking…", "Checking…"],
    ]);

    // Under reduced motion, running is still.
    await main.emulateMedia({ reducedMotion: "reduce" });
    expect(await main.locator("#lines .kit-tone-running .kit-status-dot").evaluate((dot) => getComputedStyle(dot).animationName)).toBe("none");
});

test("kit.ui.statusLine() and its set() refuse what they can't draw, and a refused set() leaves the line as it was", async ({ demo }) => {
    const main = await demo.mainWindow();
    const tones = "ready, running, warning, danger, success, muted";
    const refusals = [
        [undefined, "it takes { text, tone, title }."],
        [null, "it takes { text, tone, title }."],
        ["Ready", "it takes { text, tone, title }."],
        [{ text: "Ready", tone: "ready", dot: true }, 'it has no option "dot".'],
        [{ tone: "ready" }, "it: text must be text."],
        [{ text: 3, tone: "ready" }, "it: text must be text."],
        [{ text: "Ready" }, `it: tone must be one of ${tones}.`],
        [{ text: "Ready", tone: "info" }, `it: tone must be one of ${tones}.`],
        [{ text: "Ready", tone: "ready", title: 3 }, "it: title must be text, or left out."],
        [{ text: "Ready", tone: "ready", title: null }, "it: title must be text, or left out."],
    ];
    for (const [options, message] of refusals) {
        expect(await thrown(main, "window.kit.ui.statusLine(arg);", options), JSON.stringify(options)).toBe(`kit.ui.statusLine(): ${message}`);
    }
    const kept = await main.evaluate(() => {
        const line = window.kit.ui.statusLine({ text: "Ready", tone: "ready" });
        const said = [];
        for (const state of [{ text: "Gone", tone: "lost" }, { text: "Gone" }, null, { text: "Gone", tone: "danger", colour: "red" }]) {
            try {
                line.set(state);
            } catch (err) {
                said.push(err.message);
            }
        }
        return { said, className: line.element.className, text: line.element.textContent };
    });
    expect(kept).toEqual({
        said: [
            `kit.ui.statusLine(): set(): tone must be one of ${tones}.`,
            `kit.ui.statusLine(): set(): tone must be one of ${tones}.`,
            "kit.ui.statusLine(): set() takes { text, tone, title }.",
            'kit.ui.statusLine(): set() has no option "colour".',
        ],
        className: "kit-card-status kit-tone-ready",
        text: "Ready",
    });
});
