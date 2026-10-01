"use strict";

// A keyboard walk through the demo in real Electron: Tab goes through every
// control in a sensible order, and each one shows a focus ring that's solid,
// 2px, and 3:1 or more against what's behind it (01 §4), in both themes,
// with the rail expanded and collapsed, in the demo's accent and each app's.
// Nothing here opens a modal or popover: a prompt's keyboard (the focus kept
// inside, Escape, the focus going back) is in prompts.spec.js.

const fs = require("fs");
const path = require("path");
const { test, expect } = require("./helpers/demo");
const { focused, ringProblem } = require("./helpers/focus");

const APP_ACCENTS = ["file-converter", "media-player", "dropgate"];

/**
 * Start a walk from the top of the page. Blurring isn't enough: Chromium's
 * Tab starts from the last thing focused or clicked, so the body takes focus
 * for a moment instead.
 */
const fromTheTop = (page) => page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute("tabindex");
});

/** Press Tab `count` times, and say what took focus each time and how its ring was drawn. */
async function walk(page, count) {
    const stops = [];
    for (let i = 0; i < count; i++) {
        await page.keyboard.press("Tab");
        stops.push(await focused(page));
    }
    return stops;
}

/** Every stop whose focus ring falls short, one line each. */
const ringProblems = (stops) => stops.map(ringProblem).filter(Boolean);

test("Tab goes through the rail, the header's toolbar, then the view, each with a visible ring", async ({ demo }) => {
    const main = await demo.mainWindow();
    await fromTheTop(main);
    const stops = await walk(main, 7);
    expect(stops.map((stop) => stop.name)).toEqual(["Overview", "Controls", "Settings", "Collapse", "Open Isolated Window", "a link", "Primary Action"]);
    expect(ringProblems(stops)).toEqual([]);
});

test("in Settings, Tab reaches the selected tab only, then its pane, then the pane's controls", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.getByRole("button", { name: "Settings", exact: true }).click();
    await fromTheTop(main);
    let stops = await walk(main, 8);
    expect(stops.map((stop) => `${stop.role} ${stop.name}`)).toEqual([
        "button Overview", "button Controls", "button Settings", "button Collapse", "button Open Isolated Window",
        "tab General", "tabpanel General", "switch Show the accent sample",
    ]);
    expect(ringProblems(stops)).toEqual([]);

    // Credits: its link and both buttons, in order.
    await main.getByRole("tab", { name: "Credits" }).click();
    await main.keyboard.press("Tab");
    stops = await walk(main, 3);
    expect(stops.map((stop) => stop.name)).toEqual(["Diamond Digital Development", "Donate on Buy Me a Coffee", "View Source Code on GitHub"]);
    expect(ringProblems(stops)).toEqual([]);
});

test("Bootstrap's controls show the kit's ring, not Bootstrap's blue glow", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.getByRole("button", { name: "Controls", exact: true }).click();
    await main.getByRole("button", { name: "Controls", exact: true }).focus();
    const stops = await walk(main, 7);
    const controls = stops.slice(3);
    expect(controls.map((stop) => stop.name)).toEqual(["A checked box", "A switch, off", "A select", "A text field"]);
    expect(ringProblems(controls)).toEqual([]);
    const shadows = await main.locator("#controls-view :is(input, select)").evaluateAll((els) => els.map((el) => {
        el.focus();
        return getComputedStyle(el).boxShadow;
    }));
    expect(shadows).toEqual(["none", "none", "none", "none"]);
});

test("every focus ring holds 3:1 in both themes, the rail expanded and collapsed, in the demo's accent and each app's", async ({ demo }) => {
    test.slow();
    const main = await demo.mainWindow();
    const problems = [];
    const accents = [null, ...APP_ACCENTS];
    for (const name of accents) {
        const style = name && await main.addStyleTag({ content: fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "accents", `${name}.css`), "utf8") });
        for (const theme of ["light", "dark"]) {
            await demo.useTheme(main, theme);
            for (const collapsed of [false, true]) {
                const toggle = main.getByRole("button", { name: collapsed ? "Collapse" : "Expand", exact: true });
                if (await toggle.count()) await toggle.click();
                for (const view of ["Overview", "Settings"]) {
                    await main.getByRole("button", { name: view, exact: true }).click();
                    await fromTheTop(main);
                    const where = `${name ?? "the demo"}'s accent, ${theme}, ${collapsed ? "collapsed" : "expanded"}, ${view}`;
                    problems.push(...ringProblems(await walk(main, 7)).map((line) => `${where}: ${line}`));
                }
            }
        }
        await style?.evaluate((element) => element.remove());
    }
    expect(problems).toEqual([]);
});

test("a check that catches a faint ring, so a clean walk means something", async ({ demo }) => {
    const main = await demo.mainWindow();
    // Bootstrap's own ring: its blue at a quarter, as a glow.
    await main.addStyleTag({ content: ".nav-rail .nav-item:focus-visible { outline: 2px solid rgba(13, 110, 253, 0.25); }" });
    await fromTheTop(main);
    const problems = ringProblems(await walk(main, 1));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^"Overview": its ring is 1\.\d\d:1 against what's behind it$/);
});
