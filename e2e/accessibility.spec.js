"use strict";

// axe (@axe-core/playwright) on the demo's page in real Electron, against WCAG
// 2.2 A and AA, in the light and dark themes: with the demo's own accent, and
// with each of the three apps' accents (test/fixtures/accents/), laid over the
// demo's in turn.
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

/** Switch the page's theme as the kit's theme script will, and wait for its transitions to finish. */
async function setTheme(page, theme) {
    await page.evaluate((theme) => document.documentElement.setAttribute("data-bs-theme", theme), theme);
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished)));
}

/** axe's WCAG 2.2 AA violations on the page, one line each: the rule, then each element it failed. */
async function violations(page) {
    const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_22_AA).analyze();
    return violations.flatMap((v) => v.nodes.map((node) => `${v.id}: ${node.target.join(" ")}: ${node.failureSummary.replace(/\s+/g, " ")}`));
}

test("axe finds nothing on the demo's page, in the light and dark themes", async ({ demo }) => {
    const main = await demo.mainWindow();
    for (const theme of ["light", "dark"]) {
        await setTheme(main, theme);
        expect(await violations(main), `the ${theme} theme`).toEqual([]);
    }
});

test("axe finds nothing on the demo's page in each app's accent, in both themes", async ({ demo }) => {
    const main = await demo.mainWindow();
    for (const name of APP_ACCENTS) {
        const content = fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "accents", `${name}.css`), "utf8");
        // Added last, after the demo's own accent.css, so it wins.
        const style = await main.addStyleTag({ content });
        for (const theme of ["light", "dark"]) {
            await setTheme(main, theme);
            expect(await violations(main), `${name}'s accent, the ${theme} theme`).toEqual([]);
        }
        await style.evaluate((element) => element.remove());
    }
});

test("axe catches an accent that fails AA, so a clean run means something", async ({ demo }) => {
    const main = await demo.mainWindow();
    // File Converter's accent before the kit: white on #28a745 is 3.13:1, and its green as text 3.13:1.
    await main.addStyleTag({ content: ":root { --accent: #28a745; --accent-hover: #34d058; --accent-rgb: 40, 167, 69; --accent-text-light: #28a745; --accent-link-light: #5dd879; }" });
    await setTheme(main, "light");
    const found = await violations(main);
    for (const target of ["#accent-text", "#accent-link", "#open-isolated", "#accent-progress"]) {
        expect(found.some((line) => line.startsWith(`color-contrast: ${target}`)), `${target} in ${JSON.stringify(found, null, 2)}`).toBe(true);
    }
});
