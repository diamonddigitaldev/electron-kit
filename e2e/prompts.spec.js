"use strict";

// The toast's action and detail list, and kit.ui.confirm() with its batch
// form, in real Electron: what each resolves, every way out of a prompt, one
// prompt at a time, the keyboard (the focus inside, Escape, the focus going
// back), axe in both themes with a toast's list and a prompt open, and
// reduced motion.

const { default: AxeBuilder } = require("@axe-core/playwright");
const { test, expect } = require("./helpers/demo");
const { focused, ringProblem } = require("./helpers/focus");
const { contrastRatio, parseColor, over } = require("../testing");

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** axe's WCAG 2.2 AA violations on the page, one line each. */
async function violations(page) {
    const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_22_AA).analyze();
    return violations.flatMap((v) => v.nodes.map((node) => `${v.id}: ${node.target.join(" ")}: ${node.failureSummary.replace(/\s+/g, " ")}`));
}

/** Wait for every transition and animation running in the page to end (not the pulse, which never does). */
const settled = (page) => page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
    .map((a) => a.finished.catch(() => {}))));

/** The batch prompt DFC asks when an output already exists. */
const FILE_EXISTS = {
    title: "File Already Exists",
    body: "clip.mp4 already exists.",
    icon: "file_copy",
    choices: [
        { value: "cancelAll", label: "Cancel All" },
        { value: "skip", label: "Skip This File" },
        { value: "overwrite", label: "Overwrite" },
        { value: "unique", label: "Save as New" },
    ],
    cancel: "cancelAll",
    defaultChoice: "unique",
    applyToAll: true,
};

/**
 * Ask a prompt from the page, and keep its answer on window.answers, so the
 * test can act on the dialog and then read what it resolved.
 */
function ask(page, options) {
    return page.evaluate((options) => {
        window.answers ??= [];
        const i = window.answers.push(undefined) - 1;
        window.kit.ui.confirm(options).then((answer) => {
            window.answers[i] = answer;
        });
    }, options);
}

/** The answers resolved so far, in the order they were asked. */
const answers = (page) => page.evaluate(() => window.answers);

// -- The toast's action --------------------------------------------------------

test("a toast's action shows its list and hides it, stays until closed, and is text only", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.evaluate(() => {
        window.built = 0;
        window.kit.ui.toast("Added 3 files, skipped 2.", {
            type: "warning",
            action: {
                label: "Show Them",
                items: () => {
                    window.built++;
                    return [{ name: "notes.txt", note: "not a supported format" }, { name: "<b>bold</b>.doc", note: "not a supported format" }, "a plain row"];
                },
            },
        });
    });
    const toast = main.locator("#toast-host .toast-note");
    const action = toast.getByRole("button", { name: "Show Them" });
    await expect(action).toHaveAttribute("aria-expanded", "false");
    // Nothing is built until it's asked for.
    expect(await main.evaluate(() => window.built)).toBe(0);

    await action.click();
    const list = toast.getByRole("list", { name: "Show Them" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveText(["notes.txt — not a supported format", "<b>bold</b>.doc — not a supported format", "a plain row"]);
    await expect(list.locator("b")).toHaveCount(0);
    await expect(list.locator(".toast-detail-name")).toHaveText(["notes.txt", "<b>bold</b>.doc"]);
    expect(await list.locator(".toast-detail-name").first().evaluate((el) => getComputedStyle(el).userSelect)).toBe("text");
    const hide = toast.getByRole("button", { name: "Hide" });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    await expect(hide).toHaveAttribute("aria-controls", await list.getAttribute("id"));

    await hide.click();
    await expect(list).toBeHidden();
    await expect(action).toHaveAttribute("aria-expanded", "false");
    await action.click();
    await expect(list).toBeVisible();
    // Built once, however often it's shown.
    expect(await main.evaluate(() => window.built)).toBe(1);

    // A toast with an action has no timeout of its own: still there after --timing-toast.
    await main.waitForTimeout(5000);
    await expect(toast).toHaveCount(1);
    await toast.getByRole("button", { name: "Dismiss" }).click();
    await expect(toast).toHaveCount(0);
});

test("a toast's list holds 50 rows, then says how many more; a timeout given still closes it", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.evaluate(() => {
        window.kit.ui.toast("Skipped 57 files.", { action: { label: "Show Them", items: () => Array.from({ length: 57 }, (_, i) => `file-${i + 1}.txt`) }, timeout: 1500 });
    });
    const toast = main.locator("#toast-host .toast-note");
    await toast.getByRole("button", { name: "Show Them" }).click();
    const rows = toast.getByRole("listitem");
    await expect(rows).toHaveCount(51);
    await expect(rows.nth(49)).toHaveText("file-50.txt");
    await expect(rows.nth(50)).toHaveText("and 7 more");
    await expect(toast).toHaveCount(0, { timeout: 5000 });
});

test("a toast's action is checked: a label and a function giving the list", async ({ demo }) => {
    const main = await demo.mainWindow();
    const errors = await main.evaluate(() => [
        { label: "", items: () => [] },
        { label: "Show Them" },
        { label: "Show Them", items: ["a"] },
        "Show Them",
    ].map((action) => {
        try {
            window.kit.ui.toast("A toast.", { action });
            return "shown";
        } catch (err) {
            return err.message;
        }
    }));
    expect(errors).toEqual(Array(4).fill("kit.ui.toast(): action must be { label, items }, items a function returning the list."));
    await expect(main.locator("#toast-host .toast-note")).toHaveCount(0);
});

test("a toast's list holds AA on every type's fill, and its action and list take a ring in the toast's colour", async ({ demo }) => {
    const main = await demo.mainWindow();
    const toast = main.locator("#toast-host .toast-note");
    const problems = [];
    for (const type of ["info", "success", "warning", "danger"]) {
        await main.evaluate((type) => {
            window.kit.ui.toast(`A ${type} toast.`, { type, action: { label: "Show Them", items: () => [{ name: "a.txt", note: "a note" }, ...Array.from({ length: 51 }, () => "row")] } });
        }, type);
        await toast.getByRole("button", { name: "Show Them" }).click();
        await settled(main);
        const fill = parseColor(await toast.evaluate((el) => getComputedStyle(el).backgroundColor));
        const list = toast.locator(".toast-detail");
        const inset = over(parseColor(await list.evaluate((el) => getComputedStyle(el).backgroundColor)), fill);
        for (const row of [list.locator("li").first(), list.locator(".toast-detail-more")]) {
            const text = parseColor(await row.evaluate((el) => getComputedStyle(el).color));
            const ratio = contrastRatio(text, inset);
            if (ratio < 4.5) problems.push(`${type}: ${ratio.toFixed(2)}:1`);
        }
        // The action by keyboard, then the list (it scrolls, so it takes the focus too).
        await toast.getByRole("button", { name: "Hide" }).focus();
        await main.keyboard.press("Shift+Tab");
        await main.keyboard.press("Tab");
        const action = await focused(main);
        await main.keyboard.press("Tab");
        const scroller = await focused(main);
        for (const stop of [action, scroller]) {
            // The ring is the toast's text colour, drawn on the toast's fill.
            const problem = ringProblem(stop);
            if (problem) problems.push(`${type}: ${problem}`);
        }
        expect(`${action.role} ${action.name}`).toBe("button Hide");
        expect(`${scroller.role} ${scroller.name}`).toBe("list Show Them");
        await toast.getByRole("button", { name: "Dismiss" }).click();
        await expect(toast).toHaveCount(0);
    }
    expect(problems).toEqual([]);
});

// -- Confirm ---------------------------------------------------------------------

test("confirm() resolves true on its button, and false on Cancel, Escape, the backdrop and the close button", async ({ demo }) => {
    const main = await demo.mainWindow();
    const dialog = main.getByRole("alertdialog", { name: "Large Frame Export" });
    const options = { title: "Large Frame Export", body: "This writes about 4,000 images.", confirmLabel: "Write Them", variant: "warning", icon: "burst_mode" };
    const ways = [
        async () => dialog.getByRole("button", { name: "Write Them" }).click(),
        async () => dialog.getByRole("button", { name: "Cancel" }).click(),
        async () => main.keyboard.press("Escape"),
        // The backdrop: the window's corner, outside the dialog.
        async () => main.mouse.click(5, 5),
        async () => dialog.getByRole("button", { name: "Close" }).click(),
    ];
    for (const way of ways) {
        await ask(main, options);
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAccessibleDescription("This writes about 4,000 images.");
        await expect(dialog.locator(".kit-dialog-icon")).toHaveText("burst_mode");
        await expect(dialog.locator(".kit-dialog-all")).toBeHidden();
        await way();
        await expect(dialog).toBeHidden();
    }
    expect(await answers(main)).toEqual([true, false, false, false, false]);
});

test("confirm()'s batch form resolves the choice and the box, Escape gives the cancel choice, and each button has its variant", async ({ demo }) => {
    const main = await demo.mainWindow();
    const dialog = main.getByRole("alertdialog", { name: "File Already Exists" });

    await ask(main, FILE_EXISTS);
    const buttons = dialog.locator(".kit-dialog-footer .btn");
    await expect(buttons).toHaveText(["Cancel All", "Skip This File", "Overwrite", "Save as New"]);
    expect(await buttons.evaluateAll((els) => els.map((el) => el.className))).toEqual([
        "btn btn-outline-secondary", "btn btn-outline-secondary", "btn btn-outline-secondary", "btn btn-primary",
    ]);
    // The safe answer takes the focus.
    await expect(dialog.getByRole("button", { name: "Save as New" })).toBeFocused();
    await dialog.getByRole("checkbox", { name: "Apply to All Remaining" }).check();
    await dialog.getByRole("button", { name: "Overwrite" }).click();
    await expect(dialog).toBeHidden();

    // The box starts unticked each time.
    await ask(main, FILE_EXISTS);
    await expect(dialog.getByRole("checkbox", { name: "Apply to All Remaining" })).not.toBeChecked();
    await main.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Enter on the focused button: Save as New.
    await ask(main, { ...FILE_EXISTS, applyToAll: "Do This for Every File" });
    await expect(dialog.getByRole("checkbox", { name: "Do This for Every File" })).toBeVisible();
    await main.keyboard.press("Enter");
    await expect(dialog).toBeHidden();

    expect(await answers(main)).toEqual([
        { choice: "overwrite", all: true },
        { choice: "cancelAll", all: false },
        { choice: "unique", all: false },
    ]);
});

test("prompts are asked one at a time, each after the last is answered", async ({ demo }) => {
    const main = await demo.mainWindow();
    for (const name of ["a.mp4", "b.mp4", "c.mp4"]) await ask(main, { ...FILE_EXISTS, body: `${name} already exists.` });
    const dialogs = main.locator("dialog[open]");
    for (const [i, name] of ["a.mp4", "b.mp4", "c.mp4"].entries()) {
        await expect(dialogs).toHaveCount(1);
        await expect(dialogs).toHaveAccessibleDescription(`${name} already exists.`);
        await dialogs.getByRole("button", { name: ["Skip This File", "Overwrite", "Save as New"][i] }).click();
    }
    await expect(dialogs).toHaveCount(0);
    expect((await answers(main)).map((a) => a.choice)).toEqual(["skip", "overwrite", "unique"]);
});

test("confirm() is checked: a mistake throws before anything shows", async ({ demo }) => {
    const main = await demo.mainWindow();
    const errors = await main.evaluate((FILE_EXISTS) => [
        {},
        { title: "A Question", body: "" },
        { title: "A Question", body: "Text.", variant: "link" },
        { title: "A Question", body: "Text.", applyToAll: true },
        { ...FILE_EXISTS, choices: [FILE_EXISTS.choices[0]] },
        { ...FILE_EXISTS, choices: [FILE_EXISTS.choices[0], FILE_EXISTS.choices[0]] },
        { ...FILE_EXISTS, cancel: "stop" },
        { ...FILE_EXISTS, defaultChoice: "stop" },
        { ...FILE_EXISTS, applyToAll: 1 },
    ].map((options) => {
        try {
            window.kit.ui.confirm(options);
            return "asked";
        } catch (err) {
            return err.message;
        }
    }), FILE_EXISTS);
    expect(errors).toEqual([
        "kit.ui.confirm(): title must be the question, in Title Case.",
        "kit.ui.confirm(): body must be text.",
        "kit.ui.confirm(): variant must be one of primary, secondary, success, warning, danger, outline-secondary, outline-danger.",
        "kit.ui.confirm(): applyToAll, cancel and defaultChoice go with choices.",
        "kit.ui.confirm(): choices must be a list of two or more.",
        "kit.ui.confirm(): choices[1].value \"cancelAll\" is taken.",
        "kit.ui.confirm(): cancel \"stop\" isn't one of the choices.",
        "kit.ui.confirm(): defaultChoice \"stop\" isn't one of the choices.",
        "kit.ui.confirm(): applyToAll must be true, or the checkbox's label.",
    ]);
    await expect(main.locator("dialog[open]")).toHaveCount(0);
});

test("a prompt keeps the keyboard: the focus starts inside, Tab stays inside, each stop has its ring, and the focus goes back", async ({ demo }) => {
    const main = await demo.mainWindow();
    const opener = main.getByRole("button", { name: "Open Isolated Window" });
    for (const theme of ["light", "dark"]) {
        await demo.useTheme(main, theme);
        await opener.focus();
        await ask(main, FILE_EXISTS);
        const dialog = main.getByRole("alertdialog", { name: "File Already Exists" });
        await expect(dialog.getByRole("button", { name: "Save as New" })).toBeFocused();
        await settled(main);
        const stops = [];
        for (let i = 0; i < 7; i++) {
            await main.keyboard.press("Tab");
            stops.push(await focused(main));
        }
        // After Save as New, round again: the page behind can't be reached.
        expect(stops.map((stop) => `${stop.role} ${stop.name}`)).toEqual([
            "button Close", "checkbox Apply to All Remaining", "button Cancel All", "button Skip This File", "button Overwrite", "button Save as New", "button Close",
        ]);
        expect(stops.map(ringProblem).filter(Boolean)).toEqual([]);
        await main.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(opener).toBeFocused();
    }

    // A risky confirm starts on Cancel; a plain one on its button.
    await ask(main, { title: "Large Frame Export", body: "Text.", confirmLabel: "Write Them", variant: "warning" });
    await expect(main.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await main.keyboard.press("Enter");
    await ask(main, { title: "Clear the List", body: "Text.", confirmLabel: "Clear" });
    await expect(main.getByRole("button", { name: "Clear", exact: true })).toBeFocused();
    await main.keyboard.press("Enter");
    await expect(main.locator("dialog[open]")).toHaveCount(0);
    expect(await answers(main)).toEqual([{ choice: "cancelAll", all: false }, { choice: "cancelAll", all: false }, false, true]);
});

test("axe finds nothing with a toast's list open, or a prompt open, in both themes", async ({ demo }) => {
    const main = await demo.mainWindow();
    const found = [];
    for (const theme of ["light", "dark"]) {
        await demo.useTheme(main, theme);
        for (const type of ["info", "success", "warning", "danger"]) {
            await main.evaluate((type) => {
                window.kit.ui.toast(`A ${type} toast.`, { type, action: { label: "Show Them", items: () => [{ name: "a.txt", note: "a note" }, ...Array.from({ length: 60 }, (_, i) => `row ${i}`)] } });
            }, type);
            await main.getByRole("button", { name: "Show Them" }).click();
            await main.mouse.move(0, 0);
            await settled(main);
            found.push(...(await violations(main)).map((line) => `${theme}, a ${type} toast: ${line}`));
            await main.getByRole("button", { name: "Dismiss" }).click();
            await expect(main.locator("#toast-host .toast-note")).toHaveCount(0);
        }

        await ask(main, FILE_EXISTS);
        await settled(main);
        found.push(...(await violations(main)).map((line) => `${theme}, a prompt: ${line}`));
        await main.keyboard.press("Escape");
        await expect(main.locator("dialog[open]")).toHaveCount(0);
    }
    expect(found).toEqual([]);
});

test("under reduced motion a prompt comes and goes at once, as a toast does", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.emulateMedia({ reducedMotion: "reduce" });
    await ask(main, FILE_EXISTS);
    const dialog = main.locator("dialog[open]");
    const timing = await dialog.evaluate((el) => [getComputedStyle(el).animationDuration, getComputedStyle(el, "::backdrop").animationDuration]);
    expect(timing.map(parseFloat).every((s) => s < 0.001)).toBe(true);
    await dialog.getByRole("button", { name: "Overwrite" }).click();
    const leaving = await main.locator("dialog.kit-dialog").evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(leaving.split(",").map(parseFloat).every((s) => s < 0.001)).toBe(true);
    await expect(dialog).toHaveCount(0);

    await main.evaluate(() => window.kit.ui.toast("A toast.", { action: { label: "Show Them", items: () => ["a"] } }));
    const toast = main.locator("#toast-host .toast-note");
    expect(parseFloat(await toast.evaluate((el) => getComputedStyle(el).animationDuration))).toBeLessThan(0.001);
});
