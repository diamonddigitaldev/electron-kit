"use strict";

// The kit's scrollbars, in real Electron: every element that scrolls has a
// thin bar, 6px, with no arrow buttons, its thumb the theme's text colour at
// half on a track that isn't drawn, 3:1 or more against the page in both
// themes. Measured on what the window draws, not only on what the page
// computes: Chromium's standard scrollbar-width: thin is thin too, but still
// draws an arrow button at each end, on Windows and on Linux.

const { test, expect } = require("./helpers/demo");
const { contrastRatio, over, parseColor } = require("../testing/contrast");

// One device pixel to a CSS pixel, so a screenshot's rows are the page's.
test.use({ demoSwitches: ["--force-device-scale-factor=1"] });

/** A scroller of each kind the kit draws, reached and made to scroll. */
const SCROLLERS = {
    // The Settings pane, on the Update tab, taller than the window: it scrolls as it is.
    "the Settings pane": async (main) => {
        await main.getByRole("button", { name: "Settings", exact: true }).click();
        await main.getByRole("tab", { name: /^Update/ }).click();
        await main.locator("#settings-pane-update").evaluate((pane) => {
            pane.querySelector(".zz-filler")?.remove();
            pane.append(Object.assign(document.createElement("div"), { className: "zz-filler", style: "height: 2000px" }));
        });
        return main.locator(".settings-panes");
    },
    // The Queue's card grid, held to a height, as an app's list of transfers is.
    "a card grid": async (main) => {
        await main.getByRole("button", { name: "Queue", exact: true }).click();
        const grid = main.locator("#queue");
        await expect(grid).toHaveClass(/kit-card-grid/);
        await grid.evaluate((el) => Object.assign(el.style, { maxHeight: "200px", overflowY: "auto" }));
        return grid;
    },
    // The bottom bar's panel, held to a height, its content taller.
    "the bar's panel": async (main) => {
        await main.getByRole("button", { name: "Controls", exact: true }).click();
        await main.evaluate(() => window.demoShell.statusBar.show(true));
        await main.locator("#kit-statusbar-checks").click();
        const panel = main.getByRole("dialog", { name: "Check Details" });
        await expect(panel).toBeFocused();
        await panel.evaluate((el) => {
            Object.assign(el.style, { maxHeight: "180px", overflowY: "auto" });
            el.append(Object.assign(document.createElement("div"), { style: "height: 1000px" }));
        });
        return panel;
    },
};

/**
 * What the page computes for a scroller's bar, and the thumb's contrast
 * against what's under it: each layer from the page up, laid over the one
 * below.
 */
function computedBar(scroller) {
    return scroller.evaluate((el) => {
        const own = getComputedStyle(el);
        const bar = getComputedStyle(el, "::-webkit-scrollbar");
        const layers = [];
        for (let node = el; node; node = node.parentElement) layers.push(getComputedStyle(node).backgroundColor);
        return {
            standard: [own.scrollbarWidth, own.scrollbarColor],
            width: bar.width,
            height: bar.height,
            track: bar.backgroundColor,
            thumb: getComputedStyle(el, "::-webkit-scrollbar-thumb").backgroundColor,
            text: getComputedStyle(document.body).color,
            thickness: el.offsetWidth - el.clientWidth - parseFloat(own.borderLeftWidth) - parseFloat(own.borderRightWidth),
            layers,
        };
    });
}

/**
 * The vertical bar as the window draws it: the column of pixels down its
 * middle, from the top of the scroller to the bottom, scrolled to the top.
 * A rounded scroller's corners clip its bar, so they're left out.
 */
async function drawnBar(main, scroller) {
    const box = await scroller.evaluate((el) => {
        el.scrollTop = 0;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        const right = r.right - parseFloat(s.borderRightWidth);
        const width = el.offsetWidth - el.clientWidth - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth);
        const top = parseFloat(s.borderTopRightRadius);
        const bottom = parseFloat(s.borderBottomRightRadius);
        return { x: right - width, y: r.top + parseFloat(s.borderTopWidth) + top, width, height: el.clientHeight - top - bottom };
    });
    // Parked where nothing hovers, so the thumb is at rest.
    await main.mouse.move(380, 12);
    const png = await main.screenshot({ clip: box, animations: "disabled" });
    return main.evaluate(async ({ bytes, x }) => {
        const image = await createImageBitmap(new Blob([new Uint8Array(bytes)]), { colorSpaceConversion: "none" });
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(x, 0, 1, image.height).data;
        return Array.from({ length: image.height }, (_, i) => ({ r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2], a: 1 }));
    }, { bytes: [...png], x: Math.floor(box.width / 2) });
}

/** Two drawn colours that are the same, give or take a step of rounding. */
const same = (x, y) => ["r", "g", "b"].every((c) => Math.abs(x[c] - y[c]) <= 2);

for (const theme of ["light", "dark"]) {
    test(`every scroller's bar is 6px, with no arrow buttons, its thumb 3:1 or more against the page: ${theme}`, async ({ demo }) => {
        const main = await demo.mainWindow();
        const win = await demo.app.browserWindow(main);
        await win.evaluate((w) => w.setContentSize(760, 600));
        await main.emulateMedia({ reducedMotion: "reduce" });
        await demo.useTheme(main, theme);
        const seen = {};
        for (const [name, reach] of Object.entries(SCROLLERS)) {
            const scroller = await reach(main);
            await expect.poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight * 2), name).toBe(true);

            // What the page computes: the standard properties left alone (Chromium ignores ::-webkit-scrollbar
            // wherever either is set), and the kit's bar, 6px each way, its track not drawn, its thumb the
            // theme's text colour at half.
            const bar = await computedBar(scroller);
            expect(bar.standard, name).toEqual(["auto", "auto"]);
            expect([bar.width, bar.height, bar.track, bar.thickness], name).toEqual(["6px", "6px", "rgba(0, 0, 0, 0)", 6]);
            const text = parseColor(bar.text);
            expect(parseColor(bar.thumb), name).toEqual({ r: text.r, g: text.g, b: text.b, a: 0.5 });
            const page = bar.layers.reverse().reduce((below, layer) => over(layer, below), { r: 255, g: 255, b: 255, a: 1 });
            const computed = contrastRatio(bar.thumb, page);

            // What the window draws, down the bar's middle: the thumb from its very top, where an arrow button
            // would be, then the page to the very bottom, where the other would be.
            const column = await drawnBar(main, scroller);
            const track = column.at(-1);
            expect(same(track, page), `${name}: the track isn't drawn`).toBe(true);
            const marked = column.map((pixel) => !same(pixel, track));
            const start = marked.indexOf(true);
            const end = marked.indexOf(false, start);
            expect(start, `${name}: the thumb starts at the top`).toBeLessThanOrEqual(1);
            expect(end, `${name}: the thumb is drawn`).toBeGreaterThanOrEqual(8);
            expect(marked.slice(end).includes(true), `${name}: nothing is drawn under the thumb`).toBe(false);
            const drawn = contrastRatio(column[Math.floor(end / 2)], track);
            seen[name] = [Math.round(computed * 100) / 100, Math.round(drawn * 100) / 100];

            if (name === "the bar's panel") {
                await main.keyboard.press("Escape");
                await main.evaluate(() => window.demoShell.statusBar.show(false));
            }
        }
        expect(Object.keys(seen)).toEqual(Object.keys(SCROLLERS));
        const short = Object.entries(seen).filter(([, ratios]) => ratios.some((ratio) => ratio < 3));
        expect(short, JSON.stringify(seen)).toEqual([]);
    });
}

test("an element that sets the standard scrollbar-width gets Chromium's own bar, as the docs say", async ({ demo }) => {
    const main = await demo.mainWindow();
    const thickness = await main.evaluate(() => {
        const box = Object.assign(document.createElement("div"), { style: "position: fixed; top: 0; left: 0; width: 100px; height: 100px; overflow: scroll; scrollbar-width: thin" });
        document.body.append(box);
        const kit = Object.assign(document.createElement("div"), { style: "position: fixed; top: 0; left: 120px; width: 100px; height: 100px; overflow: scroll" });
        document.body.append(kit);
        const sizes = [box.offsetWidth - box.clientWidth, kit.offsetWidth - kit.clientWidth];
        box.remove();
        kit.remove();
        return sizes;
    });
    expect(thickness[1]).toBe(6);
    expect(thickness[0]).toBeGreaterThan(6);
});
