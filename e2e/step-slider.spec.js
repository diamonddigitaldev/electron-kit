"use strict";

// kit.ui.stepSlider(), in real Electron: a slider is built on the demo's
// Overview by each test, so what onChange hears can be watched; the demo's own
// slider, in Controls, is checked for its colours, and axe and the visual spec
// hold its looks there (accessibility.spec.js, visual.spec.js).

const fs = require("fs");
const path = require("path");
const { over, contrastRatio } = require("../testing/contrast");
const { test, expect } = require("./helpers/demo");

const APP_ACCENTS = ["file-converter", "media-player", "dropgate"];

/**
 * A slider of 1 to 6 transfers at 3, at the top of the Overview, as
 * window.made; what onChange hears goes on window.changes. options are laid
 * over those.
 */
function buildSlider(page, options = {}) {
    return page.evaluate((options) => {
        window.changes = [];
        const { countOf } = window.kit.format;
        window.made = window.kit.ui.stepSlider({
            id: "made-steps",
            label: "Transfers at once",
            min: 1,
            max: 6,
            value: 3,
            valueText: (n) => countOf(n, "transfer"),
            help: (n) => `Up to ${countOf(n, "transfer")} at once.`,
            onChange: (n) => window.changes.push(n),
            ...options,
        });
        document.getElementById("overview-view").prepend(window.made.element);
    }, options);
}

/**
 * What the slider shows: how many nodes are filled, where the fill ends and
 * where each dot's centre is (in pixels from the page's left), once the fill
 * has finished moving.
 */
const drawn = (page) => page.locator("#made-steps").evaluate(async (input) => {
    const slider = input.closest(".kit-step-slider");
    await Promise.all(slider.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
    const fill = slider.querySelector(".kit-step-fill").getBoundingClientRect();
    const dots = [...slider.querySelectorAll(".kit-step-dot")].map((dot) => {
        const box = dot.getBoundingClientRect();
        return box.left + box.width / 2;
    });
    return {
        filled: slider.querySelectorAll(".kit-step-node.on").length,
        fillStart: fill.left,
        fillEnd: fill.right,
        dots,
        // Where a click on the range lands: its middle, top to bottom.
        y: input.getBoundingClientRect().top + input.getBoundingClientRect().height / 2,
    };
});

/** The slider at value n, as a person would see and hear it: its value, words and help; the nodes and the line filled to n. */
async function expectAt(page, n) {
    const range = page.getByRole("slider", { name: "Transfers at once" });
    await expect(range).toHaveValue(String(n));
    await expect(range).toHaveAttribute("aria-valuetext", n === 1 ? "1 transfer" : `${n} transfers`);
    await expect(range).toHaveAccessibleDescription(`Up to ${n === 1 ? "1 transfer" : `${n} transfers`} at once.`);
    const { filled, fillStart, fillEnd, dots } = await drawn(page);
    expect(filled, "the nodes up to the knob are filled").toBe(n);
    expect(Math.abs(fillStart - dots[0]), "the line starts at the first node").toBeLessThanOrEqual(1);
    expect(Math.abs(fillEnd - dots[n - 1]), "the line is filled to the knob's node").toBeLessThanOrEqual(1);
}

/** Each option's error, or "made". */
const refusals = (page, calls) => page.evaluate((calls) => calls.map((call) => {
    try {
        // eslint-disable-next-line no-new-func
        new Function("kit", "ok", call)(window.kit, { id: "r", label: "Transfers at once", min: 1, max: 6, value: 3 });
        return "made";
    } catch (err) {
        return err.message;
    }
}), calls);

test("a stepped slider: a range named by its label, its value in words, its help, and a node per value", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSlider(main);
    const range = main.getByRole("slider", { name: "Transfers at once" });
    await expect(range).toBeVisible();
    await expect(range).toHaveAttribute("type", "range");
    for (const [name, value] of [["min", "1"], ["max", "6"], ["step", "1"], ["aria-describedby", "made-steps-help"]]) await expect(range).toHaveAttribute(name, value);
    await expectAt(main, 3);
    const nodes = main.locator(".kit-step-field:has(#made-steps) .kit-step-nodes");
    await expect(nodes).toHaveAttribute("aria-hidden", "true");
    await expect(nodes.locator(".kit-step-number")).toHaveText(["1", "2", "3", "4", "5", "6"]);
    // The nodes are evenly spaced, and the slider has nothing else for a screen reader.
    const { dots } = await drawn(main);
    const gaps = dots.slice(1).map((x, i) => x - dots[i]);
    for (const gap of gaps) expect(Math.abs(gap - gaps[0])).toBeLessThanOrEqual(1);
    expect(await main.locator(".kit-step-field:has(#made-steps) :is(input, button, select, [tabindex])").count()).toBe(1);

    // Left out, valueText and help leave the range as it is: no words, no description.
    await main.evaluate(() => document.querySelector(".kit-step-field:has(#made-steps)").remove());
    await buildSlider(main, { valueText: undefined, help: undefined });
    await expect(range).not.toHaveAttribute("aria-valuetext");
    await expect(range).not.toHaveAttribute("aria-describedby");
    await expect(main.locator(".kit-step-field:has(#made-steps) .form-text")).toHaveCount(0);
});

test("the arrows, Home and End move it a value at a step, the fill, the words and the help following, onChange at each", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSlider(main);
    const range = main.getByRole("slider", { name: "Transfers at once" });
    await range.focus();
    for (const [key, n] of [["ArrowRight", 4], ["ArrowUp", 5], ["ArrowLeft", 4], ["ArrowDown", 3], ["Home", 1], ["End", 6]]) {
        await main.keyboard.press(key);
        await expectAt(main, n);
    }
    // Past the ends, it stays.
    await main.keyboard.press("ArrowRight");
    await expectAt(main, 6);
    await main.keyboard.press("Home");
    await main.keyboard.press("ArrowLeft");
    await expectAt(main, 1);
    expect(await main.evaluate(() => window.changes)).toEqual([4, 5, 4, 3, 1, 6, 1]);
});

test("a click snaps to the nearest value; a drag fills as it goes and calls onChange once, as it lets go", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSlider(main);
    const { dots, y } = await drawn(main);
    const gap = dots[1] - dots[0];
    // On a node, a little past one, and a little short of the next.
    for (const [x, n] of [[dots[4], 5], [dots[1] + gap * 0.3, 2], [dots[3] - gap * 0.3, 4], [dots[0] - 4, 1]]) {
        await main.mouse.click(x, y);
        await expectAt(main, n);
    }
    expect(await main.evaluate(() => window.changes)).toEqual([5, 2, 4, 1]);

    // A drag from the knob at 1 across to 4, then on to 6.
    await main.evaluate(() => window.changes.splice(0));
    await main.mouse.move(dots[0], y);
    await main.mouse.down();
    await main.mouse.move(dots[3], y, { steps: 6 });
    await expectAt(main, 4);
    expect(await main.evaluate(() => window.changes), "not while it's held").toEqual([]);
    await main.mouse.move(dots[5], y, { steps: 4 });
    await expectAt(main, 6);
    await main.mouse.up();
    expect(await main.evaluate(() => window.changes)).toEqual([6]);
});

test("set(n) moves it, its words, help and fill, without calling onChange", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSlider(main);
    for (const n of [5, 1, 6, 2]) {
        await main.evaluate((n) => window.made.set(n), n);
        await expectAt(main, n);
    }
    expect(await main.evaluate(() => window.changes)).toEqual([]);
    expect(await main.evaluate(() => window.made.input === document.getElementById("made-steps"))).toBe(true);
});

test("disabled through its input: faded, grey where it was the accent, and a click moves nothing", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSlider(main);
    await main.evaluate(() => { window.made.input.disabled = true; });
    const range = main.getByRole("slider", { name: "Transfers at once" });
    await expect(range).toBeDisabled();
    const look = await main.locator(".kit-step-field:has(#made-steps)").evaluate(async (field) => {
        await Promise.all(field.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
        const style = (selector) => getComputedStyle(field.querySelector(selector));
        // Bootstrap's secondary text colour in the theme in force, as the range's own disabled knob is.
        const sample = document.createElement("div");
        sample.style.backgroundColor = "var(--bs-secondary-color)";
        field.append(sample);
        const grey = getComputedStyle(sample).backgroundColor;
        sample.remove();
        return {
            opacity: style(".kit-step-slider").opacity,
            fill: style(".kit-step-fill").backgroundColor,
            dot: style(".kit-step-node.on .kit-step-dot").backgroundColor,
            grey,
        };
    });
    expect(look.opacity).toBe("0.5");
    expect(look.fill).toBe(look.grey);
    expect(look.dot).toBe(look.grey);
    const { dots, y } = await drawn(main);
    await main.mouse.click(dots[5], y);
    await expectAt(main, 3);
    expect(await main.evaluate(() => window.changes)).toEqual([]);
});

test("its options are checked, and a mistake refused with what's wrong", async ({ demo }) => {
    const main = await demo.mainWindow();
    expect(await refusals(main, [
        "kit.ui.stepSlider(null)",
        "kit.ui.stepSlider({ ...ok, step: 2 })",
        'kit.ui.stepSlider({ ...ok, id: "" })',
        'kit.ui.stepSlider({ ...ok, id: "at once" })',
        'kit.ui.stepSlider({ ...ok, label: "" })',
        "kit.ui.stepSlider({ ...ok, min: 1.5 })",
        'kit.ui.stepSlider({ ...ok, max: "6" })',
        "kit.ui.stepSlider({ ...ok, min: 6, max: 6, value: 6 })",
        "kit.ui.stepSlider({ ...ok, min: 0, max: 10 })",
        "kit.ui.stepSlider({ ...ok, min: 1, max: 10 })",
        "kit.ui.stepSlider({ ...ok, value: undefined })",
        "kit.ui.stepSlider({ ...ok, value: 7 })",
        "kit.ui.stepSlider({ ...ok, value: 2.5 })",
        'kit.ui.stepSlider({ ...ok, valueText: "3 transfers" })',
        'kit.ui.stepSlider({ ...ok, help: "Up to 3" })',
        "kit.ui.stepSlider({ ...ok, onChange: true })",
        'kit.ui.stepSlider({ ...ok, valueText: () => "" })',
        "kit.ui.stepSlider({ ...ok, help: (n) => n })",
        "kit.ui.stepSlider(ok).set(0)",
        'kit.ui.stepSlider(ok).set("3")',
        "kit.ui.stepSlider(ok)",
    ])).toEqual([
        "kit.ui.stepSlider(): options must be { id, label, min, max, value, … }.",
        'kit.ui.stepSlider(): it has no option "step".',
        "kit.ui.stepSlider(): id must be the range's id, with no spaces.",
        "kit.ui.stepSlider(): id must be the range's id, with no spaces.",
        "kit.ui.stepSlider(): label must be text.",
        "kit.ui.stepSlider(): min and max must be whole numbers.",
        "kit.ui.stepSlider(): min and max must be whole numbers.",
        "kit.ui.stepSlider(): max must be more than min.",
        "kit.ui.stepSlider(): it takes at most 10 values, and 0 to 10 is 11: a wider range is a number field.",
        "made",
        "kit.ui.stepSlider(): value must be a whole number from 1 to 6.",
        "kit.ui.stepSlider(): value must be a whole number from 1 to 6.",
        "kit.ui.stepSlider(): value must be a whole number from 1 to 6.",
        "kit.ui.stepSlider(): valueText must be a function, or left out.",
        "kit.ui.stepSlider(): help must be a function, or left out.",
        "kit.ui.stepSlider(): onChange must be a function, or left out.",
        "kit.ui.stepSlider(): valueText(3) must return text.",
        "kit.ui.stepSlider(): help(3) must return text.",
        "kit.ui.stepSlider(): set() must be a whole number from 1 to 6.",
        "kit.ui.stepSlider(): set() must be a whole number from 1 to 6.",
        "made",
    ]);
});

/**
 * The colours of the demo's slider's fill line and each filled dot, against
 * what's under them: each layer from the page up, laid over the one below.
 */
async function fillContrasts(page) {
    const painted = await page.locator("#controls-view .kit-step-slider :is(.kit-step-fill, .kit-step-node.on .kit-step-dot)").evaluateAll(async (parts) => {
        // Once the dots' colours have finished changing.
        await Promise.all(parts.flatMap((part) => part.getAnimations()).map((a) => a.finished.catch(() => {})));
        return parts.map((part) => {
            const layers = [];
            for (let node = part.parentElement; node; node = node.parentElement) layers.push(getComputedStyle(node).backgroundColor);
            return { name: part.classList.contains("kit-step-fill") ? "the line" : `node ${part.nextElementSibling.textContent}`, colour: getComputedStyle(part).backgroundColor, layers };
        });
    });
    return painted.map(({ name, colour, layers }) => {
        const under = layers.reverse().reduce((below, layer) => over(layer, below), { r: 255, g: 255, b: 255, a: 1 });
        return [name, Math.round(contrastRatio(colour, under) * 100) / 100];
    });
}

test("the fill line and the filled nodes hold 3:1 against the page, in both themes and every accent", async ({ demo }) => {
    test.slow();
    const main = await demo.mainWindow();
    await main.emulateMedia({ reducedMotion: "reduce" });
    await main.getByRole("button", { name: "Controls", exact: true }).click();
    await expect(main.getByRole("slider", { name: "Files at once" })).toHaveAttribute("aria-valuetext", "3 files");
    const short = [];
    for (const accent of [null, ...APP_ACCENTS]) {
        const style = accent && await main.addStyleTag({ content: fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "accents", `${accent}.css`), "utf8") });
        for (const theme of ["light", "dark"]) {
            await demo.useTheme(main, theme);
            const seen = await fillContrasts(main);
            expect(seen.map(([name]) => name)).toEqual(["the line", "node 1", "node 2", "node 3"]);
            short.push(...seen.filter(([, ratio]) => ratio < 3).map(([name, ratio]) => `${accent ?? "demo"}, ${theme}: ${name} is ${ratio}:1`));
        }
        await style?.evaluate((element) => element.remove());
    }
    expect(short).toEqual([]);

    // A fill as faint as Bootstrap's pressed knob is caught, so a clean run means something.
    await demo.useTheme(main, "light");
    await main.addStyleTag({ content: ".kit-step-fill, .kit-step-node.on .kit-step-dot { background-color: #b6d4fe; }" });
    const faint = await fillContrasts(main);
    expect(faint.filter(([, ratio]) => ratio >= 3), JSON.stringify(faint)).toEqual([]);
});
