"use strict";

// kit.ui.dialog(), a small form in the prompts' modal, in real Electron: its
// anatomy and names, the focus going in and coming back, each way out and the
// value it gives, no close on the backdrop, Enter pressing the primary button
// only while it's enabled, an action that leaves it open, its turn in the
// queue with kit.ui.confirm() both ways round, the refusals, and the demo's
// Advanced Options. axe on it is in accessibility.spec.js, its rings in
// keyboard.spec.js.

const { test, expect } = require("./helpers/demo");
const { focused } = require("./helpers/focus");

/** A form's actions, as Dropgate's Advanced Options has them. */
const CANCEL_APPLY = [
    { label: "Cancel", value: false, cancel: true },
    { label: "Apply", value: true, variant: "primary" },
];

/** Two rows: a text field and a number. */
const TWO_FIELDS = [{ id: "f-name", label: "Name" }, { id: "f-count", label: "Count", type: "number" }];

/**
 * Open a form from the page. Its body is described, since elements can't
 * cross from the test: `{ text }` is a line of text; anything else a house
 * form row (its label, the control, a reserved help line). Its value lands
 * on window.results, in the order forms and prompts were opened, and the
 * dialog on window.forms. With `apply: false`, Apply starts disabled.
 */
function openForm(page, { title = "Advanced Options", icon = "tune", body = TWO_FIELDS, actions = CANCEL_APPLY, apply = true } = {}) {
    return page.evaluate(({ title, icon, body, actions, apply }) => {
        const parts = body.map(({ text, id, label, type = "text", disabled = false, hidden = false }) => {
            if (text !== undefined) {
                const line = document.createElement("p");
                line.className = "kit-dialog-text";
                line.textContent = text;
                return line;
            }
            const row = document.createElement("div");
            row.hidden = hidden;
            const control = document.createElement(type === "textarea" ? "textarea" : "input");
            if (type !== "textarea") control.type = type;
            control.id = id;
            control.className = type === "checkbox" ? "form-check-input" : "form-control form-control-sm";
            control.disabled = disabled;
            const labelElement = document.createElement("label");
            labelElement.className = type === "checkbox" ? "form-check-label" : "form-label";
            labelElement.htmlFor = id;
            labelElement.textContent = label;
            const help = document.createElement("div");
            help.className = "form-text reserved";
            help.id = `${id}-help`;
            control.setAttribute("aria-describedby", help.id);
            row.append(...(type === "checkbox" ? [control, labelElement] : [labelElement, control]), help);
            return row;
        });
        window.results ??= [];
        window.forms ??= [];
        const i = window.results.push(undefined) - 1;
        const dialog = window.kit.ui.dialog({ title, icon, body: parts, actions });
        if (!apply) dialog.action(true).disabled = true;
        window.forms.push(dialog);
        dialog.closed.then((value) => {
            window.results[i] = value;
        });
    }, { title, icon, body, actions, apply });
}

/** Ask a prompt from the page, its answer on window.results too, in turn with the forms. */
function ask(page, options) {
    return page.evaluate((options) => {
        window.results ??= [];
        const i = window.results.push(undefined) - 1;
        window.kit.ui.confirm(options).then((answer) => {
            window.results[i] = answer;
        });
    }, options);
}

/** Every value, in the order the forms and prompts were opened, once each has resolved. */
async function results(page) {
    await page.waitForFunction(() => (window.results ?? []).every((value) => value !== undefined));
    return page.evaluate(() => window.results);
}

/** Wait for every transition and animation running in the page to end. */
const settled = (page) => page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
    .map((a) => a.finished.catch(() => {}))));

/** What has the focus: its role and name. */
const where = async (page) => {
    const { role, name } = await focused(page);
    return `${role} ${name}`;
};

test("a form's anatomy: a modal named by its title, the glyph, the app's own rows, the actions left to right, drawn as a prompt is", async ({ demo }) => {
    const main = await demo.mainWindow();
    // Not in the page until it shows.
    await expect(main.locator("dialog.kit-form-dialog")).toHaveCount(0);
    await openForm(main, { actions: [...CANCEL_APPLY, { label: "Reset", value: "reset", variant: "outline-secondary" }] });
    const dialog = main.getByRole("dialog", { name: "Advanced Options" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((d) => d.matches(":modal") && d.classList.contains("kit-dialog"))).toBe(true);
    await expect(dialog.getByRole("heading", { level: 2, name: "Advanced Options" })).toBeVisible();
    await expect(dialog.locator(".kit-dialog-icon")).toHaveText("tune");
    await expect(dialog.locator(".kit-dialog-icon")).toHaveAttribute("aria-hidden", "true");
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeVisible();
    await expect(dialog.getByRole("spinbutton", { name: "Count" })).toBeVisible();
    await expect(dialog.locator(".kit-dialog-body .form-text.reserved")).toHaveCount(2);
    const footer = dialog.locator(".kit-dialog-footer .btn");
    await expect(footer).toHaveText(["Cancel", "Apply", "Reset"]);
    expect(await footer.evaluateAll((els) => els.map((el) => el.className))).toEqual(["btn btn-secondary", "btn btn-primary", "btn btn-outline-secondary"]);
    for (const name of ["Close", "Cancel", "Apply", "Reset"]) await expect(dialog.getByRole("button", { name, exact: true })).toBeVisible();

    // A prompt's look, from the same rules: its width, its edge, its spacing; the rows a little apart.
    await settled(main);
    const look = await dialog.evaluate((d) => {
        const style = (sel) => getComputedStyle(d.querySelector(sel));
        return {
            width: d.getBoundingClientRect().width,
            shadow: getComputedStyle(d).boxShadow,
            padding: [style(".kit-dialog-header").padding, style(".kit-dialog-body").padding, style(".kit-dialog-footer").padding],
            gap: style(".kit-dialog-body").rowGap,
            help: style(".form-text.reserved").minHeight,
            helpLine: style(".form-text.reserved").lineHeight,
        };
    });
    expect(look).toEqual({ width: 500, shadow: "none", padding: ["16px", "16px", "12px"], gap: "12px", help: look.helpLine, helpLine: look.helpLine });
    // An empty help line keeps its height.
    expect(await dialog.locator(".form-text.reserved").first().evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(15);
    await main.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    // Gone from the page once it's closed.
    await expect(main.locator("dialog.kit-form-dialog")).toHaveCount(0);

    // It slides down into place, as a prompt does.
    await openForm(main);
    const frames = await main.locator("dialog[open]").evaluate((d) => d.getAnimations().map((a) => a.effect.getKeyframes().map((k) => k.transform)));
    expect(frames).toEqual([["translateY(-50px)", "none"]]);
    await main.keyboard.press("Escape");
    expect(await results(main)).toEqual([false, false]);
});

test("the focus starts on the first field it can take, Tab stays inside, and the focus goes back on close", async ({ demo }) => {
    const main = await demo.mainWindow();
    const opener = main.getByRole("button", { name: "Open Isolated Window" });
    const dialog = main.locator("dialog[open]");

    // A line of text, a hidden row and a disabled field are passed over.
    await opener.focus();
    await openForm(main, { body: [{ text: "clip.mp4" }, { id: "f-gone", label: "Gone", hidden: true }, { id: "f-off", label: "Off", disabled: true }, ...TWO_FIELDS] });
    await expect(main.getByRole("textbox", { name: "Name" })).toBeFocused();
    const stops = [];
    for (let i = 0; i < 5; i++) {
        await main.keyboard.press("Tab");
        stops.push(await where(main));
    }
    // After Apply, round again: the page behind can't be reached.
    expect(stops).toEqual(["spinbutton Count", "button Cancel", "button Apply", "button Close", "textbox Name"]);
    await main.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    // A checkbox is a field too.
    await opener.focus();
    await openForm(main, { body: [{ text: "Nothing to type." }, { id: "f-box", label: "Keep a copy", type: "checkbox" }] });
    expect(await where(main)).toBe("checkbox Keep a copy");
    await main.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    // No field: the primary button; while it's disabled, the last button that isn't.
    await openForm(main, { body: [{ text: "Nothing to change." }] });
    expect(await where(main)).toBe("button Apply");
    await main.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await openForm(main, { body: [{ text: "Nothing to change." }], apply: false });
    expect(await where(main)).toBe("button Cancel");
    await main.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await results(main)).toEqual([false, true, false, false]);
});

test("each way out gives its value: an action's, the cancel action's for Escape and Close, false without one, and the app's close()", async ({ demo }) => {
    const main = await demo.mainWindow();
    const dialog = main.getByRole("dialog", { name: "Advanced Options" });
    const actions = [{ label: "Cancel", value: "cancelled", cancel: true }, { label: "Keep Both", value: { both: true } }, { label: "Apply", value: 3, variant: "primary" }];
    const ways = [
        async () => dialog.getByRole("button", { name: "Apply" }).click(),
        async () => dialog.getByRole("button", { name: "Keep Both" }).click(),
        async () => dialog.getByRole("button", { name: "Cancel" }).click(),
        async () => main.keyboard.press("Escape"),
        async () => dialog.getByRole("button", { name: "Close" }).click(),
        async () => main.evaluate(() => window.forms.at(-1).close("from the app")),
    ];
    for (const way of ways) {
        await openForm(main, { actions });
        await expect(dialog).toBeVisible();
        await way();
        await expect(dialog).toHaveCount(0);
    }
    // With no cancel action, Escape and Close give false.
    for (const key of ["Escape", "Close"]) {
        await openForm(main, { actions: [{ label: "Done", value: "done", variant: "primary" }] });
        if (key === "Escape") await main.keyboard.press("Escape");
        else await dialog.getByRole("button", { name: "Close" }).click();
        await expect(dialog).toHaveCount(0);
    }
    expect(await results(main)).toEqual([3, { both: true }, "cancelled", "cancelled", "cancelled", "from the app", false, false]);

    // A second close, or a button pressed after it, changes nothing.
    await openForm(main);
    await main.evaluate(() => {
        const form = window.forms.at(-1);
        form.close("first");
        form.close("second");
        form.action(true).click();
    });
    await expect(dialog).toHaveCount(0);
    expect((await results(main)).at(-1)).toBe("first");
});

test("a click on the backdrop doesn't close a form, or throw away what was typed", async ({ demo }) => {
    const main = await demo.mainWindow();
    await openForm(main);
    const dialog = main.getByRole("dialog", { name: "Advanced Options" });
    await main.getByRole("textbox", { name: "Name" }).fill("Typed");
    // The window's corner, outside the dialog, then just beyond each edge.
    const box = await dialog.boundingBox();
    for (const [x, y] of [[5, 5], [box.x - 4, box.y + box.height / 2], [box.x + box.width + 4, box.y + 10], [box.x + 10, box.y + box.height + 4]]) {
        await main.mouse.click(x, y);
    }
    await main.waitForTimeout(500);
    await expect(dialog).toBeVisible();
    await expect(main.getByRole("textbox", { name: "Name" })).toHaveValue("Typed");
    await main.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await results(main)).toEqual([false]);
});

test("Enter in a field presses the primary button, only while it's enabled; not in a text area or on a checkbox", async ({ demo }) => {
    const main = await demo.mainWindow();
    const dialog = main.locator("dialog[open]");
    const body = [...TWO_FIELDS, { id: "f-notes", label: "Notes", type: "textarea" }, { id: "f-box", label: "Keep a copy", type: "checkbox" }];

    await openForm(main, { body, apply: false });
    const name = main.getByRole("textbox", { name: "Name" });
    await name.fill("clip");
    await name.press("Enter");
    // Apply is disabled: nothing.
    await main.waitForTimeout(300);
    await expect(dialog).toHaveCount(1);
    // Enter in a text area is a new line; on a checkbox, nothing.
    await main.getByRole("textbox", { name: "Notes" }).press("Enter");
    await main.getByRole("checkbox", { name: "Keep a copy" }).press("Enter");
    await main.evaluate(() => {
        window.forms.at(-1).action(true).disabled = false;
    });
    await main.getByRole("textbox", { name: "Notes" }).press("Enter");
    await main.getByRole("checkbox", { name: "Keep a copy" }).press("Enter");
    await main.waitForTimeout(300);
    await expect(dialog).toHaveCount(1);
    await expect(main.getByRole("textbox", { name: "Notes" })).toHaveValue("\n\n");
    // Enabled now, Enter in a field is Apply.
    await main.getByRole("spinbutton", { name: "Count" }).press("Enter");
    await expect(dialog).toHaveCount(0);

    // Enter on a button presses that button.
    await openForm(main);
    await main.getByRole("button", { name: "Cancel" }).focus();
    await main.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);

    // With no primary action, Enter in a field presses nothing.
    await openForm(main, { actions: [{ label: "Cancel", value: false, cancel: true }, { label: "Save", value: "save" }] });
    await main.getByRole("textbox", { name: "Name" }).press("Enter");
    await main.waitForTimeout(300);
    await expect(dialog).toHaveCount(1);
    await main.keyboard.press("Escape");
    expect(await results(main)).toEqual([true, false, false]);
});

test("an action with close: false leaves it open for the app, which closes it once its work is done", async ({ demo }) => {
    const main = await demo.mainWindow();
    const dialog = main.getByRole("dialog", { name: "Add Server" });
    await openForm(main, {
        title: "Add Server",
        icon: "dns",
        body: [{ id: "f-address", label: "Server address" }],
        actions: [{ label: "Cancel", value: false, cancel: true }, { label: "Check", value: "check", variant: "primary", close: false }],
    });
    await main.evaluate(() => {
        const form = window.forms.at(-1);
        window.checks = 0;
        // As Dropgate's Add Server: Check, then Add Server, which closes it.
        form.action("check").addEventListener("click", () => {
            window.checks++;
            if (window.checks === 2) form.close("added");
            else form.action("check").textContent = "Add Server";
        });
    });
    await main.getByRole("textbox", { name: "Server address" }).fill("https://drop.example.com");
    await main.getByRole("textbox", { name: "Server address" }).press("Enter");
    await expect(dialog.getByRole("button", { name: "Add Server" })).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Add Server" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await main.evaluate(() => window.checks)).toBe(2);
    expect(await results(main)).toEqual(["added"]);
});

test("a form and a prompt take turns, either way round, one at a time; a form closed before its turn never shows", async ({ demo }) => {
    const main = await demo.mainWindow();
    const open = main.locator("dialog[open]");
    const prompt = { title: "Clear the List", body: "Every card goes.", confirmLabel: "Clear" };

    // A prompt, then a form asked while it shows.
    await ask(main, prompt);
    await openForm(main);
    await expect(open).toHaveCount(1);
    await expect(main.getByRole("alertdialog", { name: "Clear the List" })).toBeVisible();
    await expect(main.locator("dialog.kit-form-dialog")).toHaveCount(0);
    await main.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(main.getByRole("dialog", { name: "Advanced Options" })).toBeVisible();
    await expect(open).toHaveCount(1);
    await expect(main.getByRole("textbox", { name: "Name" })).toBeFocused();

    // A form, then a prompt asked while it shows.
    await ask(main, prompt);
    await main.waitForTimeout(300);
    await expect(open).toHaveCount(1);
    await expect(main.getByRole("dialog", { name: "Advanced Options" })).toBeVisible();
    await main.getByRole("button", { name: "Apply" }).click();
    await expect(main.getByRole("alertdialog", { name: "Clear the List" })).toBeVisible();
    await expect(open).toHaveCount(1);

    // Two forms queued behind it, the first closed by the app before its turn.
    await openForm(main, { title: "First Form" });
    await openForm(main, { title: "Second Form" });
    await main.evaluate(() => window.forms.at(-2).close("skipped"));
    await main.keyboard.press("Escape");
    await expect(main.getByRole("dialog", { name: "Second Form" })).toBeVisible();
    await expect(main.locator("dialog.kit-form-dialog")).toHaveCount(1);
    await main.keyboard.press("Escape");
    await expect(open).toHaveCount(0);
    expect(await results(main)).toEqual([true, true, false, "skipped", false]);
});

test("kit.ui.dialog() is checked: a mistake throws before anything shows, and so does a wrong action() or close()", async ({ demo }) => {
    const main = await demo.mainWindow();
    const errors = await main.evaluate(() => {
        const row = () => document.createElement("div");
        const ok = () => ({ title: "Advanced Options", icon: "tune", body: [row()], actions: [{ label: "Cancel", value: false, cancel: true }, { label: "Apply", value: true, variant: "primary" }] });
        const tries = [
            null,
            { ...ok(), size: "lg" },
            { ...ok(), title: "" },
            { ...ok(), icon: 3 },
            { ...ok(), body: [] },
            { ...ok(), body: "<b>Markup</b>" },
            { ...ok(), body: [row(), "text"] },
            { ...ok(), actions: [] },
            { ...ok(), actions: [null] },
            { ...ok(), actions: [{ label: "Apply", value: true, onClick() {} }] },
            { ...ok(), actions: [{ label: "", value: true }] },
            { ...ok(), actions: [{ label: "Apply" }] },
            { ...ok(), actions: [{ label: "No", value: false }, { label: "Also No", value: false }] },
            { ...ok(), actions: [{ label: "Apply", value: true, variant: "link" }] },
            { ...ok(), actions: [{ label: "Cancel", value: false, cancel: "yes" }] },
            { ...ok(), actions: [{ label: "Check", value: true, close: 0 }] },
            { ...ok(), actions: [{ label: "Cancel", value: false, cancel: true, close: false }] },
            { ...ok(), actions: [{ label: "Cancel", value: false, cancel: true }, { label: "Stop", value: "stop", cancel: true }] },
            { ...ok(), actions: [{ label: "Apply", value: true, variant: "primary" }, { label: "Save", value: "save", variant: "primary" }] },
        ].map((options) => {
            try {
                window.kit.ui.dialog(options);
                return "shown";
            } catch (err) {
                return err.message;
            }
        });
        const form = window.kit.ui.dialog(ok());
        for (const call of [() => form.action("apply"), () => form.close()]) {
            try {
                call();
                tries.push("done");
            } catch (err) {
                tries.push(err.message);
            }
        }
        form.close(false);
        return tries;
    });
    expect(errors).toEqual([
        "kit.ui.dialog(): it takes { title, icon, body, actions }.",
        "kit.ui.dialog(): it has no option \"size\".",
        "kit.ui.dialog(): title must be the dialog's name, in Title Case.",
        "kit.ui.dialog(): icon must be a Material Icons Round glyph.",
        "kit.ui.dialog(): body must be the app's own elements: an element, or a list of them.",
        "kit.ui.dialog(): body must be the app's own elements: an element, or a list of them.",
        "kit.ui.dialog(): body must be the app's own elements: an element, or a list of them.",
        "kit.ui.dialog(): actions must be a list of one or more { label, value, variant }.",
        "kit.ui.dialog(): actions[0] must be { label, value, variant }.",
        "kit.ui.dialog(): actions[0] has no option \"onClick\".",
        "kit.ui.dialog(): actions[0].label must be text.",
        "kit.ui.dialog(): actions[0].value must be given: it's what dialog.closed resolves with.",
        "kit.ui.dialog(): actions[1].value is actions[0]'s already.",
        "kit.ui.dialog(): actions[0].variant must be one of primary, secondary, success, warning, danger, outline-secondary, outline-danger.",
        "kit.ui.dialog(): actions[0].cancel must be true or false.",
        "kit.ui.dialog(): actions[0].close must be true or false.",
        "kit.ui.dialog(): actions[0] is the cancel action, which always closes: leave close out.",
        "kit.ui.dialog(): only one action can be the cancel action.",
        "kit.ui.dialog(): only one action can be primary.",
        "kit.ui.dialog(): action() takes one of the actions' values.",
        "kit.ui.dialog(): close() takes the value dialog.closed resolves with.",
    ]);
    await expect(main.locator("dialog[open]")).toHaveCount(0);
    await expect(main.locator("dialog.kit-form-dialog")).toHaveCount(0);
});

test("the demo's Advanced Options: an upload's options, Apply off while a value is more than the server allows, set on its card", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.getByRole("button", { name: "Queue", exact: true }).click();
    const card = main.getByRole("group", { name: "receipts.csv", exact: true });
    // Queued, so locked: its Advanced Options is off. A ready upload's opens it.
    await expect(card.getByRole("button", { name: "Advanced Options" })).toBeDisabled();
    const ready = main.getByRole("group", { name: "printer-manual.pdf", exact: true });
    await ready.getByRole("button", { name: "Advanced Options" }).click();
    const dialog = main.getByRole("dialog", { name: "Advanced Options" });
    await expect(dialog.locator(".kit-dialog-text")).toHaveText("printer-manual.pdf");
    const lifetime = dialog.getByRole("spinbutton", { name: "File lifetime" });
    const downloads = dialog.getByRole("spinbutton", { name: "Max downloads" });
    await expect(lifetime).toBeFocused();
    await expect(lifetime).toHaveValue("7");
    await expect(lifetime).toHaveAccessibleDescription("The server keeps files up to 30 days.");
    await expect(downloads).toHaveAccessibleDescription("The server allows up to 100 downloads.");
    const apply = dialog.getByRole("button", { name: "Apply" });

    await lifetime.fill("31");
    await expect(lifetime).toHaveAccessibleDescription("Too long: The server keeps files up to 30 days.");
    await expect(apply).toBeDisabled();
    await dialog.getByRole("combobox", { name: "Unit" }).selectOption("hours");
    await expect(apply).toBeEnabled();
    await downloads.fill("0");
    await expect(downloads).toHaveAccessibleDescription("Enter a whole number from 1 to 100.");
    await expect(apply).toBeDisabled();
    await downloads.press("Enter");
    await expect(dialog).toBeVisible();
    await downloads.fill("5");
    await downloads.press("Enter");
    await expect(dialog).toHaveCount(0);
    // Its warning stays on its line; the focus is back on Advanced Options.
    await expect(ready.locator(".kit-card-settings")).toHaveText("Not encrypted: This server is plain HTTP.");
    await expect(ready.getByRole("button", { name: "Advanced Options" })).toBeFocused();

    // An upload with no warning shows what's set on it: receipts.csv, cancelled, then tried again.
    await card.getByRole("button", { name: "Cancel" }).click();
    await card.getByRole("button", { name: "Retry" }).click();
    await card.getByRole("button", { name: "Advanced Options" }).click();
    await expect(lifetime).toHaveValue("7");
    await lifetime.fill("2");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card.locator(".kit-card-settings")).toHaveText("2 Days · 10 Downloads");

    // Bulk Edit: the selected uploads waiting to start, from the first's options (receipts.csv's, first on
    // screen), set on each.
    await ready.locator(".kit-card-meta").click();
    await card.locator(".kit-card-meta").click({ modifiers: ["Control"] });
    await main.getByRole("group", { name: "clip.mp4", exact: true }).locator(".kit-card-meta").click({ modifiers: ["Control"] });
    await main.getByRole("button", { name: "Bulk Edit" }).click();
    await expect(dialog.locator(".kit-dialog-text")).toHaveText("For the 2 uploads selected.");
    await expect(lifetime).toHaveValue("2");
    await expect(dialog.getByRole("combobox", { name: "Unit" })).toHaveValue("days");
    await downloads.fill("1");
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card.locator(".kit-card-settings")).toHaveText("2 Days · 1 Download");
    await expect(ready.locator(".kit-card-settings")).toHaveText("Not encrypted: This server is plain HTTP.");

    // With no upload waiting in the selection, it says so.
    await main.keyboard.press("Escape");
    await main.getByRole("group", { name: "clip.mp4", exact: true }).locator(".kit-card-meta").click();
    await main.getByRole("button", { name: "Bulk Edit" }).click();
    await expect(main.locator("#toast-host .toast-note")).toHaveText(/No selected upload is waiting to start\./);
    await expect(dialog).toHaveCount(0);
});
