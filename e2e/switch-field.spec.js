"use strict";

// kit.ui.switchField(), in real Electron: a switch is built on the demo's
// Overview by each test, so what onChange hears can be watched; the demo's own
// switch, on Settings > General, and the Update tab's (update-tab.spec.js) are
// built on it. Every plain range's knob, which the Bootstrap bridge puts in
// the accent, is here too: a control that's the accent's fill.

const fs = require("fs");
const path = require("path");
const { default: AxeBuilder } = require("@axe-core/playwright");
const { test, expect } = require("./helpers/demo");

const APP_ACCENTS = ["file-converter", "media-player", "dropgate"];
const ON = "Transfers that stop are tried again, up to three times.";
const OFF = "A transfer that stops is marked as failed.";

/**
 * A switch, "Retry stopped transfers", off, at the top of the Overview, as
 * window.made; what onChange hears goes on window.changes. options are laid
 * over those.
 */
function buildSwitch(page, options = {}) {
    return page.evaluate(({ options, ON, OFF }) => {
        window.changes = [];
        window.made = window.kit.ui.switchField({
            id: "made-switch",
            label: "Retry stopped transfers",
            help: { on: ON, off: OFF },
            onChange: (checked) => window.changes.push(checked),
            ...options,
        });
        document.getElementById("overview-view").prepend(window.made.element);
    }, { options, ON, OFF });
}

/** Each option's error, or "made". */
const refusals = (page, calls) => page.evaluate((calls) => calls.map((call) => {
    try {
        // eslint-disable-next-line no-new-func
        new Function("kit", "ok", call)(window.kit, { id: "r", label: "Retry stopped transfers", help: { on: "Tried again.", off: "Marked as failed." } });
        return "made";
    } catch (err) {
        return err.message;
    }
}), calls);

test("a switch: named by its label, described by the help line for the state it's in, off unless checked", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSwitch(main);
    const toggle = main.getByRole("switch", { name: "Retry stopped transfers" });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toHaveAttribute("type", "checkbox");
    await expect(toggle).toHaveAttribute("aria-describedby", "made-switch-help");
    await expect(toggle).toHaveAccessibleDescription(OFF);
    const field = main.locator(".kit-switch-field:has(#made-switch)");
    await expect(field.locator(".form-check.form-switch label")).toHaveText("Retry stopped transfers");
    // One help line, and it's the one the switch points to.
    await expect(field.locator(".form-text")).toHaveCount(1);
    await expect(field.locator("#made-switch-help")).toHaveText(OFF);
    // The help says what the state does: never which state it is.
    await expect(field.locator(".form-text")).not.toHaveText(/^(On|Off):/);
    expect(await main.evaluate(() => window.made.input === document.getElementById("made-switch"))).toBe(true);

    // checked: true starts it on, with the on help.
    await main.evaluate(() => document.querySelector(".kit-switch-field:has(#made-switch)").remove());
    await buildSwitch(main, { checked: true });
    await expect(toggle).toBeChecked();
    await expect(toggle).toHaveAccessibleDescription(ON);
});

test("flipped by a click or the Space bar, its help follows and onChange hears each change; set() flips it without calling onChange", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSwitch(main);
    const toggle = main.getByRole("switch", { name: "Retry stopped transfers" });
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(toggle).toHaveAccessibleDescription(ON);
    // By its label too, as a person clicks one.
    await main.locator(".kit-switch-field:has(#made-switch) label").click();
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toHaveAccessibleDescription(OFF);
    await toggle.focus();
    await main.keyboard.press("Space");
    await expect(toggle).toBeChecked();
    await expect(toggle).toHaveAccessibleDescription(ON);
    expect(await main.evaluate(() => window.changes)).toEqual([true, false, true]);

    // set(): flipped, its help with it, and onChange not called; setting the state it's in changes nothing.
    for (const checked of [false, false, true]) {
        await main.evaluate((checked) => window.made.set(checked), checked);
        await expect(toggle).toBeChecked({ checked });
        await expect(toggle).toHaveAccessibleDescription(checked ? ON : OFF);
    }
    expect(await main.evaluate(() => window.changes)).toEqual([true, false, true]);

    // Only a change calls it: focusing it, or a click while it's disabled, doesn't.
    await main.evaluate(() => { window.made.input.disabled = true; });
    await toggle.click({ force: true });
    await expect(toggle).toBeChecked();
    expect(await main.evaluate(() => window.changes)).toEqual([true, false, true]);
});

test("the demo's General switch is one: its help follows it, and it's kept as it's flipped", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.getByRole("button", { name: "Settings", exact: true }).click();
    await main.getByRole("tab", { name: "General", exact: true }).click();
    const toggle = main.getByRole("switch", { name: "Show the accent sample" });
    await expect(toggle).toBeChecked();
    await expect(toggle).toHaveAccessibleDescription("The Overview shows the accent's text, a link and a bar.");
    await toggle.click();
    await expect(toggle).toHaveAccessibleDescription("The Overview leaves the accent sample out.");
    await expect.poll(async () => (await main.evaluate(() => window.kitAPI.getSettings())).showAccentSample).toBe(false);
    await toggle.click();
    await expect(toggle).toHaveAccessibleDescription("The Overview shows the accent's text, a link and a bar.");
});

test("its options are checked, and a mistake refused with what's wrong", async ({ demo }) => {
    const main = await demo.mainWindow();
    expect(await refusals(main, [
        "kit.ui.switchField(null)",
        "kit.ui.switchField({ ...ok, value: true })",
        'kit.ui.switchField({ ...ok, id: "" })',
        'kit.ui.switchField({ ...ok, id: "retry stopped" })',
        'kit.ui.switchField({ ...ok, label: "" })',
        'kit.ui.switchField({ ...ok, checked: "yes" })',
        "kit.ui.switchField({ ...ok, help: undefined })",
        'kit.ui.switchField({ ...ok, help: "Tried again." })',
        'kit.ui.switchField({ ...ok, help: { on: "Tried again." } })',
        'kit.ui.switchField({ ...ok, help: { on: "", off: "Marked as failed." } })',
        'kit.ui.switchField({ ...ok, help: { on: "Tried again.", off: "Marked as failed.", disabled: "Not now." } })',
        'kit.ui.switchField({ ...ok, help: { on: "On: tried again.", off: "Marked as failed." } })',
        'kit.ui.switchField({ ...ok, help: { on: "Tried again.", off: "off : marked as failed." } })',
        'kit.ui.switchField({ ...ok, onChange: "save" })',
        'kit.ui.switchField(ok).set("on")',
        "kit.ui.switchField(ok).set(1)",
        "kit.ui.switchField({ ...ok, checked: true, onChange: () => {} })",
        'kit.ui.switchField({ ...ok, help: { on: "Online backups run each night.", off: "Offline: nothing leaves the machine." } })',
    ])).toEqual([
        "kit.ui.switchField(): options must be { id, label, checked, help: { on, off }, onChange }.",
        'kit.ui.switchField(): it has no option "value".',
        "kit.ui.switchField(): id must be the switch's id, with no spaces.",
        "kit.ui.switchField(): id must be the switch's id, with no spaces.",
        "kit.ui.switchField(): label must be text.",
        "kit.ui.switchField(): checked must be true or false.",
        "kit.ui.switchField(): help must be { on, off }: what the switch does in each state.",
        "kit.ui.switchField(): help must be { on, off }: what the switch does in each state.",
        "kit.ui.switchField(): help.off must be text: what the switch does when it's off.",
        "kit.ui.switchField(): help.on must be text: what the switch does when it's on.",
        "kit.ui.switchField(): help must be { on, off }: what the switch does in each state.",
        'kit.ui.switchField(): help.on says what it does, without "On:" or "Off:".',
        'kit.ui.switchField(): help.off says what it does, without "On:" or "Off:".',
        "kit.ui.switchField(): onChange must be a function, or left out.",
        "kit.ui.switchField(): set() takes true or false.",
        "kit.ui.switchField(): set() takes true or false.",
        "made",
        // Words that start with "on" or "off" are words, not a state's name.
        "made",
    ]);
});

test("axe finds nothing on a switch, on and off, in both themes", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSwitch(main);
    const found = [];
    for (const theme of ["light", "dark"]) {
        await demo.useTheme(main, theme);
        for (const checked of [false, true]) {
            await main.evaluate((checked) => window.made.set(checked), checked);
            const { violations } = await new AxeBuilder({ page: main }).include(".kit-switch-field").setLegacyMode(true).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
            found.push(...violations.flatMap((v) => v.nodes.map((n) => `${theme}, ${checked ? "on" : "off"}: ${v.id}: ${n.target.join(" ")}`)));
        }
    }
    expect(found).toEqual([]);
});

/**
 * The colour drawn at points of an element, in CSS pixels from its top-left
 * corner, read back from the window as Electron captures it
 * (webContents.capturePage()): Playwright's screenshots end a press, so its
 * :active with it.
 * @returns {Promise<number[][]>} [r, g, b] at each point
 */
async function drawnAt(demo, page, locator, points) {
    const box = await locator.boundingBox();
    const rect = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width) + 1, height: Math.ceil(box.height) + 1 };
    const win = await demo.app.browserWindow(page);
    const png = await win.evaluate(async (win, rect) => (await win.webContents.capturePage(rect)).toPNG().toString("base64"), rect);
    return page.evaluate(async ({ png, rect, box, points }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const scale = canvas.width / rect.width;
        return points.map(([x, y]) => [...context.getImageData(Math.round((box.x - rect.x + x) * scale), Math.round((box.y - rect.y + y) * scale), 1, 1).data.slice(0, 3)]);
    }, { png, rect, box, points });
}

/** A colour the page resolves (a var(), a name), as [r, g, b]. */
const resolved = (page, colour) => page.evaluate((colour) => {
    const sample = document.createElement("div");
    sample.style.color = colour;
    document.body.append(sample);
    const [r, g, b] = getComputedStyle(sample).color.match(/\d+(\.\d+)?/g).map(Number);
    sample.remove();
    return [r, g, b];
}, colour);

/** Whether two colours are the same, give or take a step of rounding in each channel. */
const same = (a, b) => a.every((c, i) => Math.abs(c - b[i]) <= 2);

test("a plain range's knob is the accent's fill, its hover shade while pressed, with no glow when focused, in every app's accent and both themes", async ({ demo }) => {
    test.slow();
    const main = await demo.mainWindow();
    await main.emulateMedia({ reducedMotion: "reduce" });
    await main.evaluate(() => {
        const range = document.createElement("input");
        range.type = "range";
        range.className = "form-range";
        range.id = "plain-range";
        range.setAttribute("aria-label", "Volume");
        range.style.width = "200px";
        range.style.display = "block";
        range.value = "50";
        document.getElementById("overview-view").prepend(range);
    });
    const range = main.locator("#plain-range");
    const box = await range.boundingBox();
    // At 50, the knob's centre is the range's; the glow, were it there, would be 2 to 5px round the knob's edge (1rem across).
    const centre = [box.width / 2, box.height / 2];
    const aboveKnob = [box.width / 2, box.height / 2 - 8 - 3];
    const wrong = [];
    for (const accent of [null, ...APP_ACCENTS]) {
        const style = accent && await main.addStyleTag({ content: fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "accents", `${accent}.css`), "utf8") });
        for (const theme of ["light", "dark"]) {
            await demo.useTheme(main, theme);
            const where = `${accent ?? "demo"}, ${theme}`;
            const [fill, hover, page] = await Promise.all(["var(--accent)", "var(--accent-hover)", "var(--bs-body-bg)"].map((c) => resolved(main, c)));
            await main.evaluate(() => document.activeElement?.blur());
            const [atRest] = await drawnAt(demo, main, range, [centre]);
            if (!same(atRest, fill)) wrong.push(`${where}: the knob is ${atRest}, not the accent's fill ${fill}`);

            // Focused: the house's ring goes round the range, and no glow round the knob.
            await range.focus();
            const [knob, above] = await drawnAt(demo, main, range, [centre, aboveKnob]);
            if (!same(knob, fill)) wrong.push(`${where}, focused: the knob is ${knob}, not ${fill}`);
            if (!same(above, page)) wrong.push(`${where}, focused: ${above} round the knob, not the page's ${page}: a glow`);

            // Pressed on the knob, which stays where it is.
            await main.mouse.move(box.x + centre[0], box.y + centre[1]);
            await main.mouse.down();
            // Pressed, and drawn so: two frames on.
            expect(await range.evaluate(async (input) => {
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                return input.matches(":active");
            }), `${where}: pressed`).toBe(true);
            const [pressed] = await drawnAt(demo, main, range, [centre]);
            await main.mouse.up();
            if (!same(pressed, hover)) wrong.push(`${where}, pressed: the knob is ${pressed}, not the accent's hover shade ${hover}`);
            await expect(range).toHaveValue("50");
        }
        await style?.evaluate((element) => element.remove());
    }
    expect(wrong).toEqual([]);

    // Bootstrap's own knob, #0d6efd, would be caught: the check sees colour, not just that something is drawn.
    // In File Converter's green, since the demo's accent and Dropgate's are that blue.
    await demo.useTheme(main, "light");
    await main.evaluate(() => document.activeElement?.blur());
    await main.addStyleTag({ content: fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "accents", "file-converter.css"), "utf8") });
    await main.addStyleTag({ content: "#plain-range::-webkit-slider-thumb { background-color: #0d6efd; }" });
    const [blue] = await drawnAt(demo, main, range, [centre]);
    expect(same(blue, [13, 110, 253])).toBe(true);
    expect(same(blue, await resolved(main, "var(--accent)"))).toBe(false);
});
