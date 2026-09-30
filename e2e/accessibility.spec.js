"use strict";

// axe (@axe-core/playwright) on the demo's page in real Electron, against WCAG
// 2.2 A and AA: every view and every Settings tab, with the rail expanded and
// collapsed, in the light and dark themes, with the demo's own accent and
// with each of the three apps' accents (test/fixtures/accents/), laid over the
// demo's in turn. Each theme is switched as the OS switches it (nativeTheme,
// from main), and the kit's theme.js draws the page in it.
//
// axe normally finishes its run in a blank page it opens beside the one it
// checks, which an Electron app doesn't give. Legacy mode runs it whole in the
// page itself; the demo has no frames, which is all legacy mode gives up. axe's
// own script is put into the page from node_modules, so nothing is fetched.

const fs = require("fs");
const path = require("path");
const { default: AxeBuilder } = require("@axe-core/playwright");
const { test, expect } = require("./helpers/demo");

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const APP_ACCENTS = ["file-converter", "media-player", "dropgate"];

/** axe's WCAG 2.2 AA violations on the page, one line each: the rule, then each element it failed. */
async function violations(page) {
    const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_22_AA).analyze();
    return violations.flatMap((v) => v.nodes.map((node) => `${v.id}: ${node.target.join(" ")}: ${node.failureSummary.replace(/\s+/g, " ")}`));
}

/** Each place in the demo axe checks: a rail item, and a Settings tab when it's Settings. */
const PLACES = [["Overview"], ["Controls"], ["Settings", "General"], ["Settings", "Update"], ["Settings", "Credits"]];

/**
 * axe on every view and Settings tab, with the rail expanded and collapsed,
 * in the theme the page is in now. Returns every violation, each line saying
 * where it was found.
 */
async function everyPlace(demo, main, where) {
    const found = [];
    for (const collapsed of [false, true]) {
        const toggle = main.getByRole("button", { name: collapsed ? "Collapse" : "Expand", exact: true });
        if (await toggle.count()) await toggle.click();
        for (const [view, tab] of PLACES) {
            await main.getByRole("button", { name: view, exact: true }).click();
            if (tab) await main.getByRole("tab", { name: tab }).click();
            // Let the hover and the switch's transitions finish, so axe reads the colours at rest.
            await main.mouse.move(0, 0);
            await main.evaluate(() => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished)));
            const place = `${where}, ${collapsed ? "collapsed" : "expanded"}, ${tab ? `Settings > ${tab}` : view}`;
            found.push(...(await violations(main)).map((line) => `${place}: ${line}`));
        }
    }
    return found;
}

test("axe finds nothing in any view or Settings tab, collapsed or expanded, in the light and dark themes", async ({ demo }) => {
    const main = await demo.mainWindow();
    const found = [];
    for (const theme of ["light", "dark"]) {
        await demo.useTheme(main, theme);
        found.push(...await everyPlace(demo, main, `the ${theme} theme`));
    }
    expect(found).toEqual([]);
});

for (const name of APP_ACCENTS) {
    test(`axe finds nothing in any view or Settings tab in ${name}'s accent, collapsed or expanded, in both themes`, async ({ demo }) => {
        const main = await demo.mainWindow();
        const content = fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "accents", `${name}.css`), "utf8");
        // Added last, after the demo's own accent.css, so it wins.
        await main.addStyleTag({ content });
        const found = [];
        for (const theme of ["light", "dark"]) {
            await demo.useTheme(main, theme);
            found.push(...await everyPlace(demo, main, `${name}'s accent, the ${theme} theme`));
        }
        expect(found).toEqual([]);
    });
}

test("axe catches an accent that fails AA, so a clean run means something", async ({ demo }) => {
    const main = await demo.mainWindow();
    // File Converter's accent before the kit: white on #28a745 is 3.13:1, and its green as text 3.13:1.
    await main.addStyleTag({ content: ":root { --accent: #28a745; --accent-hover: #34d058; --accent-rgb: 40, 167, 69; --accent-text-light: #28a745; --accent-link-light: #5dd879; }" });
    await demo.useTheme(main, "light");
    const found = await violations(main);
    for (const target of ["#accent-text", "#accent-link", "#sample-primary", "#accent-progress"]) {
        expect(found.some((line) => line.startsWith(`color-contrast: ${target}`)), `${target} in ${JSON.stringify(found, null, 2)}`).toBe(true);
    }
});

test("axe catches the rail's active item drawn in the fill, as it was before the kit, so the text shade is what passes", async ({ demo }) => {
    const main = await demo.mainWindow();
    const content = fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "accents", "media-player.css"), "utf8");
    // Media Player's purple fill is 2.82:1 on the dark rail.
    await main.addStyleTag({ content: `${content}\n.nav-rail .nav-item.active { color: var(--accent); }` });
    await demo.useTheme(main, "dark");
    const found = await violations(main);
    expect(found.some((line) => line.startsWith('color-contrast: button[aria-current="page"] > .nav-label')), JSON.stringify(found, null, 2)).toBe(true);
});
