"use strict";

// The token layer (css/kit.css) in real Electron: the demo's page takes its
// accent through the kit, with each theme's text and link shades, and under
// reduced motion the kit's durations go to near zero and its pulse stops.

const path = require("path");
const { test, expect } = require("./helpers/demo");
const { readAccent, parseColor } = require("../testing");

const ACCENT = readAccent(path.join(__dirname, "..", "demo", "src", "styles", "accent.css"));
const DURATIONS = ["--dur-micro", "--dur-state", "--dur-default", "--dur-enter", "--dur-ambient"];

/** A colour as the page computes it: "rgb(r, g, b)". */
const rgb = (color) => {
    const { r, g, b } = parseColor(color);
    return `rgb(${r}, ${g}, ${b})`;
};

/** Switch the page's theme as the kit's theme script will, and wait for its transitions to finish. */
async function setTheme(page, theme) {
    await page.evaluate((theme) => document.documentElement.setAttribute("data-bs-theme", theme), theme);
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished)));
}

/** The colours the page painted its accent parts in. */
function accentColours(page) {
    return page.evaluate(() => {
        const style = (id) => getComputedStyle(document.getElementById(id));
        return {
            text: style("accent-text").color,
            link: style("accent-link").color,
            progress: style("accent-progress").backgroundColor,
            progressLabel: style("accent-progress").color,
            button: style("open-isolated").backgroundColor,
            buttonText: style("open-isolated").color,
        };
    });
}

test("the page takes the accent through kit.css, with the light theme's shades", async ({ demo }) => {
    const main = await demo.mainWindow();
    expect(await accentColours(main)).toEqual({
        text: rgb(ACCENT["--accent-text-light"]),
        link: rgb(ACCENT["--accent-link-light"]),
        progress: rgb(ACCENT["--accent"]),
        progressLabel: rgb(ACCENT["--accent-contrast"]),
        button: rgb(ACCENT["--accent"]),
        buttonText: rgb(ACCENT["--accent-contrast"]),
    });

    // A hovered link and a hovered button take the hover shades.
    await main.locator("#accent-link").hover();
    await expect(main.locator("#accent-link")).toHaveCSS("color", rgb(ACCENT["--accent-text-light"]));
    await main.locator("#open-isolated").hover();
    await expect(main.locator("#open-isolated")).toHaveCSS("background-color", rgb(ACCENT["--accent-hover"]));
});

test("under data-bs-theme=dark the page takes the dark theme's shades, and back", async ({ demo }) => {
    const main = await demo.mainWindow();
    await setTheme(main, "dark");
    expect(await accentColours(main)).toMatchObject({
        text: rgb(ACCENT["--accent-text-dark"]),
        link: rgb(ACCENT["--accent-link-dark"]),
        button: rgb(ACCENT["--accent"]),
    });
    await setTheme(main, "light");
    expect(await accentColours(main)).toMatchObject({
        text: rgb(ACCENT["--accent-text-light"]),
        link: rgb(ACCENT["--accent-link-light"]),
    });
});

test("under reduced motion the kit's durations go to near zero and the pulse stops, and come back", async ({ demo }) => {
    const main = await demo.mainWindow();
    const motion = () => main.evaluate((names) => {
        const root = getComputedStyle(document.documentElement);
        const dot = document.querySelector(".pulse-dot");
        return {
            reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
            tokens: Object.fromEntries(names.map((name) => [name, root.getPropertyValue(name).trim()])),
            // A real property timed by a token: .accent-text's colour transition, --dur-micro.
            transition: getComputedStyle(document.getElementById("accent-text")).transitionDuration,
            // The pulse's running animations, by length, and whether it's drawn at its own opacity.
            pulse: dot.getAnimations().map((a) => String(a.effect.getComputedTiming().activeDuration)),
            pulseAtRest: getComputedStyle(dot).opacity === "1",
        };
    }, DURATIONS);
    /** A CSS time in milliseconds. */
    const ms = (time) => parseFloat(time) * (time.endsWith("ms") ? 1 : 1000);

    const normal = {
        reduce: false,
        tokens: { "--dur-micro": "120ms", "--dur-state": "0.2s", "--dur-default": "0.3s", "--dur-enter": "0.4s", "--dur-ambient": "2s" },
        transition: "0.12s",
        pulse: ["Infinity"],
        pulseAtRest: false,
    };
    expect(await motion()).toEqual(normal);

    await main.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await motion();
    expect(reduced.reduce).toBe(true);
    expect(reduced.tokens).toEqual({ "--dur-micro": "0.01ms", "--dur-state": "0.01ms", "--dur-default": "0.01ms", "--dur-enter": "0.01ms", "--dur-ambient": "0s" });
    expect(ms(reduced.transition)).toBeLessThanOrEqual(0.01);
    expect(ms(reduced.transition)).toBeGreaterThan(0);
    // A pulse that repeats forever at 0s has no length at all: it's over at once, isn't running, and isn't drawn.
    expect(reduced.pulse).toEqual([]);
    expect(reduced.pulseAtRest).toBe(true);

    await main.emulateMedia({ reducedMotion: "no-preference" });
    expect(await motion()).toEqual(normal);
});
