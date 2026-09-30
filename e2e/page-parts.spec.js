"use strict";

// The parts of a section that works through a list of files, in real
// Electron: kit.ui.progress() (null is "not known"), kit.ui.actionBar(),
// kit.ui.dropZone() with real files from disk, and kit.keys (the key guard).
// Each is built on the demo's Overview by the test, with axe in both themes,
// the keyboard's rings, and reduced motion.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { default: AxeBuilder } = require("@axe-core/playwright");
const { test, expect } = require("./helpers/demo");
const { focused, ringProblem } = require("./helpers/focus");

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function violations(page) {
    const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_22_AA).analyze();
    return violations.flatMap((v) => v.nodes.map((node) => `${v.id}: ${node.target.join(" ")}: ${node.failureSummary.replace(/\s+/g, " ")}`));
}

/** Wait for every transition and animation in the page to end (not the endless ones). */
const settled = (page) => page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
    .map((a) => a.finished.catch(() => {}))));

/**
 * A section of files on the Overview: an area taking drops, with the drop zone
 * in it, a progress bar and an action bar. What each part does is kept on
 * window.seen.
 */
function buildSection(page) {
    return page.evaluate(() => {
        window.seen = { paths: [], browsed: 0, run: 0, abort: 0, clear: 0 };
        const area = document.createElement("div");
        area.id = "files";
        document.getElementById("overview-view").prepend(area);
        const { zone } = window.kit.ui.dropZone(area, {
            onPaths: (paths) => window.seen.paths.push(paths),
            icon: "swap_horiz",
            label: "Drag & Drop Files or Folders Here",
            onBrowse: () => window.seen.browsed++,
        });
        area.append(zone);
        const one = window.kit.ui.progress({ label: "clip.mp4", thin: true });
        one.element.id = "one";
        area.append(one.element);
        const bar = window.kit.ui.actionBar({
            run: { label: "Convert", onClick: () => window.seen.run++ },
            abort: { onClick: () => window.seen.abort++ },
            clear: { onClick: () => window.seen.clear++ },
            progressLabel: "Converting",
        });
        bar.element.id = "bar";
        area.append(bar.element);
        window.parts = { one, bar };
    });
}

// -- Progress ----------------------------------------------------------------------

test("progress: a percent sets its width and value; null is a bar sliding across, with no value", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSection(main);
    const one = main.getByRole("progressbar", { name: "clip.mp4" });
    await expect(one).toHaveAttribute("aria-valuenow", "0");
    expect(await one.evaluate((el) => el.getBoundingClientRect().height)).toBe(4);
    expect(await main.getByRole("progressbar", { name: "Converting" }).evaluate((el) => el.getBoundingClientRect().height)).toBe(6);

    await main.evaluate(() => window.parts.one.set(42.4));
    await expect(one).toHaveAttribute("aria-valuenow", "42");
    await expect(one.locator(".progress-bar")).toHaveAttribute("style", "width: 42%;");
    await main.evaluate(() => window.parts.one.set(250));
    await expect(one).toHaveAttribute("aria-valuenow", "100");

    await main.evaluate(() => window.parts.one.set(null));
    await expect(one).not.toHaveAttribute("aria-valuenow");
    const sliding = await one.locator(".progress-bar").evaluate((el) => {
        const style = getComputedStyle(el);
        return { name: style.animationName, iterations: style.animationIterationCount, width: el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width };
    });
    expect(sliding).toEqual({ name: "kit-progress-slide", iterations: "infinite", width: expect.closeTo(0.4, 2) });
    // Known again, it stops sliding.
    await main.evaluate(() => window.parts.one.set(10));
    expect(await one.locator(".progress-bar").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");

    const errors = await main.evaluate(() => [() => window.kit.ui.progress({}), () => window.kit.ui.progress({ label: "A", thin: "yes" }), () => window.parts.one.set("50")].map((call) => {
        try {
            call();
            return "made";
        } catch (err) {
            return err.message;
        }
    }));
    expect(errors).toEqual([
        "kit.ui.progress(): label must name what it measures.",
        "kit.ui.progress(): thin must be true or false.",
        "kit.ui.progress(): set() takes a percent, or null when it isn't known.",
    ]);
});

test("progress: under reduced motion, a bar whose amount isn't known is still, full and faded", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.emulateMedia({ reducedMotion: "reduce" });
    await buildSection(main);
    await main.evaluate(() => window.parts.one.set(null));
    const still = await main.locator("#one .progress-bar").evaluate((el) => ({
        name: getComputedStyle(el).animationName,
        opacity: getComputedStyle(el).opacity,
        width: el.getBoundingClientRect().width === el.parentElement.getBoundingClientRect().width,
    }));
    expect(still).toEqual({ name: "none", opacity: "0.5", width: true });
});

// -- The action bar ----------------------------------------------------------------

test("the action bar: one primary action, its abort in its place while it runs, and the focus moves with it", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSection(main);
    const bar = main.locator("#bar");
    await expect(bar.getByRole("button")).toHaveText(["Clear All", "Convert"]);
    await expect(bar.getByRole("button", { name: "Convert" })).toBeDisabled();

    await main.evaluate(() => window.parts.bar.update({ summary: "3 files queued", detail: "Ready to convert", canRun: true }));
    await expect(bar.getByRole("status")).toHaveText("3 files queuedReady to convert");
    const convert = bar.getByRole("button", { name: "Convert" });
    await convert.focus();
    await main.keyboard.press("Enter");
    expect(await main.evaluate(() => window.seen.run)).toBe(1);

    await main.evaluate(() => window.parts.bar.update({ running: true, summary: "Converting 3 files…", detail: "2 running", percent: null, canClear: false }));
    await expect(bar.getByRole("button")).toHaveText(["Clear All", "Cancel"]);
    await expect(bar.getByRole("button", { name: "Clear All" })).toBeDisabled();
    await expect(bar.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(bar.getByRole("progressbar", { name: "Converting" })).not.toHaveAttribute("aria-valuenow");
    await main.keyboard.press("Enter");
    expect(await main.evaluate(() => window.seen.abort)).toBe(1);

    await main.evaluate(() => window.parts.bar.update({ running: false, percent: 100, summary: "3 files converted", detail: "", canClear: true }));
    await expect(convert).toBeFocused();
    await expect(bar.getByRole("progressbar", { name: "Converting" })).toHaveAttribute("aria-valuenow", "100");
    await bar.getByRole("button", { name: "Clear All" }).click();
    expect(await main.evaluate(() => window.seen.clear)).toBe(1);

    const errors = await main.evaluate(() => [
        {},
        { run: { label: "Go" } },
        { run: { label: "Go", onClick() {} }, abort: {} },
        { run: { label: "Go", onClick() {} }, abort: { onClick() {} }, size: "lg" },
    ].map((options) => {
        try {
            window.kit.ui.actionBar(options);
            return "made";
        } catch (err) {
            return err.message;
        }
    }));
    expect(errors).toEqual([
        "kit.ui.actionBar(): run is the primary action: { label, onClick }.",
        "kit.ui.actionBar(): run.onClick must be a function.",
        "kit.ui.actionBar(): abort.onClick must be a function.",
        'kit.ui.actionBar(): size must be "sm", or left out.',
    ]);
});

// -- Dropping files --------------------------------------------------------------------

/** Real files on disk, handed to the page as File objects through a file input, so they have paths. */
async function filesFromDisk(page, names) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "electron-kit-drop-"));
    const files = names.map((name) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, "a test file");
        return file;
    });
    await page.evaluate(() => {
        const input = Object.assign(document.createElement("input"), { type: "file", multiple: true, id: "picker", hidden: true });
        document.body.append(input);
    });
    await page.locator("#picker").setInputFiles(files);
    return { dir, files };
}

/** Drag the picker's files onto an element and drop them: dragenter, then dragover, then drop. */
function dropOn(page, selector, { leaveFirst = false } = {}) {
    return page.evaluate(({ selector, leaveFirst }) => {
        const target = document.querySelector(selector);
        const transfer = new DataTransfer();
        for (const file of document.getElementById("picker").files) transfer.items.add(file);
        const fire = (type, on = target) => {
            const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
            on.dispatchEvent(event);
            return event.defaultPrevented;
        };
        fire("dragenter");
        fire("dragover");
        if (leaveFirst) return null;
        return fire("drop");
    }, { selector, leaveFirst });
}

test("the drop zone takes real files' paths, one File at a time, anywhere in its area", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSection(main);
    const { dir, files } = await filesFromDisk(main, ["a.mp4", "b c.wav"]);
    try {
        // Onto the zone's label, deep in the area.
        expect(await dropOn(main, "#files .kit-drop-label")).toBe(true);
        expect(await main.evaluate(() => window.seen.paths)).toEqual([files]);
        await expect(main.locator("#files")).not.toHaveClass(/drag-over/);

        // Files made in the page have no path: nothing is handed on.
        await main.evaluate(() => {
            const transfer = new DataTransfer();
            transfer.items.add(new File(["x"], "made.txt"));
            document.querySelector("#files").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        });
        expect(await main.evaluate(() => window.seen.paths)).toHaveLength(1);

        // Outside the area, a drop opens nothing: the page is guarded, and the window stays.
        expect(await dropOn(main, ".app-header")).toBe(true);
        expect(await main.evaluate(() => window.seen.paths)).toHaveLength(1);
        await expect(main).toHaveURL(/index\.html$/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("the drop zone lights while files are over its area, counted in and out across its children", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSection(main);
    const { dir } = await filesFromDisk(main, ["a.mp4"]);
    try {
        const area = main.locator("#files");
        await dropOn(main, "#files", { leaveFirst: true });
        await expect(area).toHaveClass(/drag-over/);
        // Onto a child: another dragenter, then the area's own dragleave. Still over it.
        await main.evaluate(() => {
            const transfer = new DataTransfer();
            transfer.items.add(document.getElementById("picker").files[0]);
            const fire = (type, on) => on.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
            fire("dragenter", document.querySelector("#files .kit-drop-label"));
            fire("dragleave", document.querySelector("#files"));
        });
        await expect(area).toHaveClass(/drag-over/);
        const lit = await main.locator("#files .kit-drop-zone").evaluate((el) => getComputedStyle(el).borderStyle);
        expect(lit).toBe("dashed");
        await main.evaluate(() => {
            const transfer = new DataTransfer();
            transfer.items.add(document.getElementById("picker").files[0]);
            document.querySelector("#files .kit-drop-label").dispatchEvent(new DragEvent("dragleave", { bubbles: true, dataTransfer: transfer }));
        });
        await expect(area).not.toHaveClass(/drag-over/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("the drop zone browses from anywhere in the box, once from its button, and its options are checked", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSection(main);
    const zone = main.locator("#files .kit-drop-zone");
    await expect(zone.locator(".kit-drop-icon")).toHaveAttribute("aria-hidden", "true");
    await zone.locator(".kit-drop-label").click();
    await zone.getByRole("button", { name: "Select Files" }).click();
    expect(await main.evaluate(() => window.seen.browsed)).toBe(2);

    const errors = await main.evaluate(() => [
        [null, { onPaths() {} }],
        [document.body, {}],
        [document.createElement("div"), { onPaths() {}, icon: "add" }],
        [document.createElement("div"), { onPaths() {}, icon: "add", label: "Drop Here" }],
        [document.getElementById("files"), { onPaths() {} }],
    ].map(([area, options]) => {
        try {
            window.kit.ui.dropZone(area, options);
            return "made";
        } catch (err) {
            return err.message;
        }
    }));
    expect(errors).toEqual([
        "kit.ui.dropZone(): the area must be an element.",
        "kit.ui.dropZone(): onPaths must be a function.",
        "kit.ui.dropZone(): label must be text, in Title Case.",
        "kit.ui.dropZone(): onBrowse must be a function.",
        "kit.ui.dropZone(): the area already takes drops.",
    ]);
});

// -- Keys ------------------------------------------------------------------------------

test("kit.keys: isTyping() knows a text field from a checkbox or a select, and onKey() stays out of typing, prompts and other views", async ({ demo }) => {
    const main = await demo.mainWindow();
    const typing = await main.evaluate(() => {
        const make = (html) => {
            const holder = document.createElement("div");
            holder.innerHTML = html;
            return holder.firstElementChild;
        };
        return Object.fromEntries([
            ["text", '<input type="text">'], ["search", '<input type="search">'], ["number", '<input type="number">'],
            ["checkbox", '<input type="checkbox">'], ["range", '<input type="range">'], ["select", "<select></select>"],
            ["textarea", "<textarea></textarea>"], ["editable", '<div contenteditable="true"></div>'], ["button", "<button></button>"],
        ].map(([name, html]) => [name, window.kit.keys.isTyping(make(html))]));
    });
    expect(typing).toEqual({ text: true, search: true, number: true, checkbox: false, range: false, select: false, textarea: true, editable: true, button: false });

    await main.evaluate(() => {
        window.heard = [];
        window.stopKeys = window.kit.keys.onKey((event) => window.heard.push(event.key), { view: "controls" });
    });
    const heard = () => main.evaluate(() => window.heard);

    // Another view shows: nothing.
    await main.keyboard.press("Delete");
    expect(await heard()).toEqual([]);
    await main.getByRole("button", { name: "Controls", exact: true }).click();
    await main.keyboard.press("Delete");
    expect(await heard()).toEqual(["Delete"]);
    // Typing: nothing. A checkbox, or a select after a choice: heard.
    await main.getByLabel("A text field").focus();
    await main.keyboard.press("Delete");
    await main.getByLabel("A checked box").focus();
    await main.keyboard.press("Escape");
    await main.getByLabel("A select").focus();
    await main.keyboard.press("Escape");
    expect(await heard()).toEqual(["Delete", "Escape", "Escape"]);
    // A prompt open: nothing, and its Escape answers it.
    await main.evaluate(() => {
        window.kit.ui.confirm({ title: "A Question", body: "Text." }).then((answer) => {
            window.answer = answer;
        });
    });
    await expect(main.getByRole("alertdialog")).toBeVisible();
    await main.keyboard.press("Delete");
    await main.keyboard.press("Escape");
    await expect(main.getByRole("alertdialog")).toBeHidden();
    expect(await main.evaluate(() => window.answer)).toBe(false);
    expect(await heard()).toEqual(["Delete", "Escape", "Escape"]);
    // Stopped: nothing.
    await main.evaluate(() => window.stopKeys());
    await main.locator("body").focus();
    await main.keyboard.press("Delete");
    expect(await heard()).toEqual(["Delete", "Escape", "Escape"]);
});

// -- Accessibility -----------------------------------------------------------------------

test("axe finds nothing in a section of files, with the zone lit and a bar not known, in both themes; each control has its ring", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildSection(main);
    const { dir } = await filesFromDisk(main, ["a.mp4"]);
    try {
        await main.evaluate(() => {
            window.parts.bar.update({ summary: "3 files queued", detail: "Ready to convert", canRun: true, percent: 40 });
            window.parts.one.set(null);
        });
        const found = [];
        for (const theme of ["light", "dark"]) {
            await demo.useTheme(main, theme);
            await dropOn(main, "#files", { leaveFirst: true });
            await main.mouse.move(0, 0);
            await settled(main);
            found.push(...(await violations(main)).map((line) => `${theme}: ${line}`));
            const stops = [];
            for (const name of ["Select Files", "Clear All", "Convert"]) {
                await main.getByRole("button", { name, exact: true }).focus();
                await main.keyboard.press("Shift+Tab");
                await main.keyboard.press("Tab");
                stops.push(await focused(main));
            }
            expect(stops.map((stop) => stop.name)).toEqual(["Select Files", "Clear All", "Convert"]);
            found.push(...stops.map(ringProblem).filter(Boolean).map((line) => `${theme}: ${line}`));
        }
        expect(found).toEqual([]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
