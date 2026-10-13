"use strict";

// kit.ui.cardGrid() and kit.ui.bulkBar(), in real Electron. A grid of six
// cards and its bar are built on the demo's Overview by the test, so every
// rule can be watched through onSelect; the demo's own Queue (a grid and a bar
// of its own, with Delete as the app's key) is checked as an app uses them,
// and axe and the visual spec hold its looks. The rules themselves are unit
// tested in test/selection.test.js.

const fs = require("fs");
const path = require("path");
const { default: AxeBuilder } = require("@axe-core/playwright");
const { over, contrastRatio } = require("../testing/contrast");
const { test, expect } = require("./helpers/demo");

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const APP_ACCENTS = ["file-converter", "media-player", "dropgate"];
const NAMES = ["one.txt", "two.txt", "three.txt", "four.txt", "five.txt", "six.txt"];

/**
 * Six cards in a grid on the Overview, its view, under a bar: a target (a
 * format select) with a note, an action always shown and Remove only with a
 * selection. What onSelect hears and what the actions are given go on
 * window.seen; window.names names each card; three.txt has a text field.
 */
function buildGrid(page) {
    return page.evaluate((names) => {
        window.seen = { selections: [], clicks: [] };
        window.names = new Map();
        const nameOf = (cards) => cards.map((card) => window.names.get(card));
        const area = document.createElement("div");
        area.id = "made-area";
        const container = document.createElement("div");
        container.id = "made";
        window.grid = window.kit.ui.cardGrid(container, { view: "overview", onSelect: (selection) => window.seen.selections.push(nameOf(selection)) });
        window.cards = names.map((name) => {
            const card = window.kit.ui.card({ icon: "description", name, onRemove: () => window.grid.remove(card) });
            const rows = [];
            if (name === "three.txt") {
                const note = document.createElement("input");
                note.className = "form-control form-control-sm";
                note.value = "A note";
                note.setAttribute("aria-label", "Note");
                rows.push(note);
            }
            card.update({ meta: "12 KB", status: { text: "Ready", tone: "ready" }, rows });
            window.names.set(card, name);
            window.grid.add(card);
            return card;
        });
        const select = document.createElement("select");
        select.className = "form-select form-select-sm";
        select.append(new Option("MP4", "mp4"), new Option("WebM", "webm"));
        window.target = select;
        window.bar = window.kit.ui.bulkBar(window.grid, {
            noun: "file",
            target: { verb: "Convert", control: select, note: (scope, { all }) => (all ? "" : `Only ${scope.length} change`) },
            actions: [
                { label: "Convert Each", variant: "primary", onClick: (scope) => window.seen.clicks.push(["Convert Each", ...nameOf(scope)]) },
                { label: "Remove", variant: "outline-danger", selection: true, enabled: () => !window.lockRemove, onClick: (scope) => scope.forEach((card) => window.grid.remove(card)) },
            ],
        });
        area.append(window.bar.element, container);
        document.getElementById("overview-view").prepend(area);
    }, NAMES);
}

/** What the grid says is selected, which cards look it, and which boxes are ticked: each by name. */
const state = (page) => page.evaluate(() => ({
    selection: window.grid.selection.map((card) => window.names.get(card)),
    drawn: [...document.querySelectorAll("#made .kit-card.selected")].map((card) => card.getAttribute("aria-label")),
    boxes: [...document.querySelectorAll("#made .kit-card-select")].filter((box) => box.checked).map((box) => box.getAttribute("aria-label").replace(/^Select /, "")),
}));

/** The selection is these cards, drawn and ticked so. */
async function selected(page, names) {
    await expect.poll(() => state(page)).toEqual({ selection: names, drawn: names, boxes: names });
}

/** A click on a card's own space (its meta line), with keys held. */
const click = (page, name, modifiers = []) => page.getByRole("group", { name, exact: true }).locator(".kit-card-meta").click({ modifiers });

const heard = (page) => page.evaluate(() => window.seen.selections);

/** Each option's error, or "made". */
const refusals = (page, calls) => page.evaluate((calls) => calls.map((call) => {
    try {
        // eslint-disable-next-line no-new-func
        new Function("kit", "grid", "cards", "target", call)(window.kit, window.grid, window.cards, window.target);
        return "made";
    } catch (err) {
        return err.message;
    }
}), calls);

// -- The click rules -------------------------------------------------------------------

test("a plain click selects one card, or keeps a multi-selection it's inside; Ctrl or Cmd toggles; Shift selects from the anchor; Ctrl+Shift adds", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildGrid(main);
    await selected(main, []);

    // Plain: one, then another in its place.
    await click(main, "two.txt");
    await selected(main, ["two.txt"]);
    await click(main, "four.txt");
    await selected(main, ["four.txt"]);
    // Ctrl adds and takes away; Cmd (Meta) is the same.
    await click(main, "one.txt", ["Control"]);
    await selected(main, ["one.txt", "four.txt"]);
    await click(main, "six.txt", ["Meta"]);
    await selected(main, ["one.txt", "four.txt", "six.txt"]);
    await click(main, "four.txt", ["Control"]);
    await selected(main, ["one.txt", "six.txt"]);
    // A plain click inside a multi-selection keeps it (and makes that card the anchor); outside, replaces it.
    await click(main, "six.txt");
    await selected(main, ["one.txt", "six.txt"]);
    await click(main, "three.txt");
    await selected(main, ["three.txt"]);
    // Shift: the range from the anchor, either way, the anchor kept.
    await click(main, "five.txt", ["Shift"]);
    await selected(main, ["three.txt", "four.txt", "five.txt"]);
    await click(main, "one.txt", ["Shift"]);
    await selected(main, ["one.txt", "two.txt", "three.txt"]);
    // Ctrl+Shift adds the range to what's selected: a Ctrl click on six.txt makes it the anchor.
    await click(main, "six.txt", ["Control"]);
    await selected(main, ["one.txt", "two.txt", "three.txt", "six.txt"]);
    await click(main, "five.txt", ["Control", "Shift"]);
    await selected(main, ["one.txt", "two.txt", "three.txt", "five.txt", "six.txt"]);

    // A Shift click doesn't select the text between.
    expect(await main.evaluate(() => getSelection().toString())).toBe("");
    // onSelect heard each change, and only a change (the click inside the selection changed nothing).
    expect(await heard(main)).toEqual([
        ["two.txt"], ["four.txt"], ["one.txt", "four.txt"], ["one.txt", "four.txt", "six.txt"], ["one.txt", "six.txt"],
        ["three.txt"], ["three.txt", "four.txt", "five.txt"], ["one.txt", "two.txt", "three.txt"],
        ["one.txt", "two.txt", "three.txt", "six.txt"], ["one.txt", "two.txt", "three.txt", "five.txt", "six.txt"],
    ]);
});

test("a card's box toggles just its card, whatever is held down; a click on its controls or the grid's empty space doesn't pick", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildGrid(main);
    const box = (name) => main.getByRole("checkbox", { name: `Select ${name}`, exact: true });
    await box("two.txt").click();
    await box("five.txt").click();
    await selected(main, ["two.txt", "five.txt"]);
    // Shift on the box is still a toggle, not a range.
    await box("three.txt").click({ modifiers: ["Shift"] });
    await selected(main, ["two.txt", "three.txt", "five.txt"]);
    await box("two.txt").click();
    await selected(main, ["three.txt", "five.txt"]);
    // By keyboard: Space on a box.
    await box("one.txt").focus();
    await main.keyboard.press("Space");
    await selected(main, ["one.txt", "three.txt", "five.txt"]);

    // The card's own controls: its Remove and its row's field pick nothing.
    await main.getByRole("textbox", { name: "Note" }).click();
    await selected(main, ["one.txt", "three.txt", "five.txt"]);
    // The grid's empty space, the gap between two cards, clears it.
    const [a, b] = await Promise.all(["one.txt", "two.txt"].map((name) => main.getByRole("group", { name, exact: true }).boundingBox()));
    const sideBySide = Math.abs(a.y - b.y) < 1;
    await main.mouse.click(sideBySide ? (a.x + a.width + b.x) / 2 : a.x + a.width / 2, sideBySide ? a.y + a.height / 2 : (a.y + a.height + b.y) / 2);
    await selected(main, []);
});

test("a selected card looks it: the accent's border and active wash, stronger when hovered, and a pointer", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildGrid(main);
    await main.emulateMedia({ reducedMotion: "reduce" });
    await click(main, "two.txt");
    const looks = (name) => main.getByRole("group", { name, exact: true }).evaluate((card) => {
        const probe = document.createElement("span");
        card.append(probe);
        const of = (value) => {
            probe.style.color = value;
            return getComputedStyle(probe).color;
        };
        const want = { border: of("rgba(var(--accent-rgb), 1)"), fill: of("rgba(var(--accent-rgb), 0.06)"), hovered: of("rgba(var(--accent-rgb), 0.108)") };
        probe.remove();
        const style = getComputedStyle(card);
        return { border: style.borderTopColor === want.border, fill: style.backgroundColor === want.fill, hovered: style.backgroundColor === want.hovered, cursor: style.cursor };
    });
    // Polled: a hover, and its end, can land a frame after the mouse moves.
    await main.mouse.move(0, 0);
    await expect.poll(() => looks("two.txt")).toEqual({ border: true, fill: true, hovered: false, cursor: "pointer" });
    await main.getByRole("group", { name: "two.txt", exact: true }).locator(".kit-card-meta").hover();
    await expect.poll(() => looks("two.txt")).toEqual({ border: true, fill: false, hovered: true, cursor: "pointer" });
    await main.mouse.move(0, 0);
    await expect.poll(() => looks("one.txt")).toEqual({ border: false, fill: false, hovered: false, cursor: "pointer" });
});

// -- The keys --------------------------------------------------------------------------

test("Ctrl+A selects every card and Escape clears, only in the grid's view; never while typing or under a prompt; Delete is left to the app", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildGrid(main);
    await main.evaluate(() => document.activeElement?.blur());
    await main.keyboard.press("Control+A");
    await selected(main, NAMES);
    // The page's own text isn't selected as well.
    expect(await main.evaluate(() => getSelection().toString())).toBe("");
    await main.keyboard.press("Escape");
    await selected(main, []);

    // Delete: the grid leaves it alone (the app's own handler is the one to remove).
    await click(main, "two.txt");
    await main.keyboard.press("Delete");
    await selected(main, ["two.txt"]);
    expect(await main.evaluate(() => window.grid.cards.length)).toBe(6);

    // Typing in a card's field: Ctrl+A is the field's, and Escape too.
    const note = main.getByRole("textbox", { name: "Note" });
    await note.focus();
    await main.keyboard.press("Control+A");
    await main.keyboard.press("Escape");
    await selected(main, ["two.txt"]);
    expect(await note.evaluate((input) => [input.selectionStart, input.selectionEnd])).toEqual([0, 6]);
    await note.evaluate((input) => input.blur());

    // A prompt open: nothing, and its Escape answers it, leaving the selection.
    await main.evaluate(() => {
        window.kit.ui.confirm({ title: "A Question", body: "Text." });
    });
    await expect(main.getByRole("alertdialog")).toBeVisible();
    await main.keyboard.press("Control+A");
    await main.keyboard.press("Escape");
    await expect(main.getByRole("alertdialog")).toBeHidden();
    await selected(main, ["two.txt"]);

    // Another view showing: nothing (and the Queue's own grid hears its own keys there).
    await main.getByRole("button", { name: "Controls", exact: true }).click();
    await main.keyboard.press("Escape");
    await selected(main, ["two.txt"]);
    await main.getByRole("button", { name: "Queue", exact: true }).click();
    await main.keyboard.press("Control+A");
    await selected(main, ["two.txt"]);
    await expect(main.locator("#queue .kit-card.selected")).toHaveCount(11);
    await main.keyboard.press("Escape");
    await expect(main.locator("#queue .kit-card.selected")).toHaveCount(0);
    await main.getByRole("button", { name: "Overview", exact: true }).click();
    await main.keyboard.press("Control+A");
    await selected(main, NAMES);
});

// -- Adding and removing ---------------------------------------------------------------

test("cards keep the order they're added in; removing one prunes it from the selection, and a removed anchor is forgotten", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildGrid(main);
    expect(await main.locator("#made > .kit-card").evaluateAll((cards) => cards.map((c) => c.getAttribute("aria-label")))).toEqual(NAMES);
    expect(await main.evaluate(() => window.grid.cards.map((card) => window.names.get(card)))).toEqual(NAMES);

    await click(main, "two.txt");
    await click(main, "four.txt", ["Shift"]);
    await selected(main, ["two.txt", "three.txt", "four.txt"]);
    // A card's own Remove, through the app's grid.remove().
    await main.getByRole("button", { name: "Remove three.txt" }).click();
    await selected(main, ["two.txt", "four.txt"]);
    await expect(main.getByRole("group", { name: "three.txt" })).toHaveCount(0);
    // An unselected one: the selection stands, and onSelect isn't told.
    const before = (await heard(main)).length;
    await main.evaluate(() => window.grid.remove(window.cards[5]));
    await selected(main, ["two.txt", "four.txt"]);
    expect((await heard(main)).length).toBe(before);
    expect((await heard(main)).at(-1)).toEqual(["two.txt", "four.txt"]);
    // The anchor (two.txt) removed: a Shift click is a plain click.
    await main.evaluate(() => window.grid.remove(window.cards[1]));
    await selected(main, ["four.txt"]);
    await click(main, "five.txt", ["Shift"]);
    await selected(main, ["five.txt"]);

    // A removed card can't be picked, and can be added again, at the end.
    expect(await main.evaluate(() => window.cards[1].element.classList.contains("kit-card-pickable"))).toBe(false);
    await main.evaluate(() => window.grid.add(window.cards[1]));
    expect(await main.evaluate(() => window.grid.cards.map((card) => window.names.get(card)))).toEqual(["one.txt", "four.txt", "five.txt", "two.txt"]);
    await click(main, "two.txt", ["Control"]);
    await selected(main, ["five.txt", "two.txt"]);
});

test("select(), selectAll() and clear() set the selection from the app, and onSelect hears each change", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildGrid(main);
    await main.evaluate(() => window.grid.select([window.cards[4], window.cards[1]]));
    await selected(main, ["two.txt", "five.txt"]);
    // The anchor is the first of them on screen.
    await click(main, "four.txt", ["Shift"]);
    await selected(main, ["two.txt", "three.txt", "four.txt"]);
    await main.evaluate(() => window.grid.select(window.cards[0]));
    await selected(main, ["one.txt"]);
    await main.evaluate(() => window.grid.selectAll());
    await selected(main, NAMES);
    await main.evaluate(() => window.grid.selectAll());
    await main.evaluate(() => window.grid.clear());
    await selected(main, []);
    await main.evaluate(() => window.grid.clear());
    expect(await heard(main)).toEqual([["two.txt", "five.txt"], ["two.txt", "three.txt", "four.txt"], ["one.txt"], NAMES, []]);
});

// -- The bulk bar ----------------------------------------------------------------------

test("the select-all box: unticked with none, a bar across it with some, ticked with all; it selects all, or clears", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildGrid(main);
    const all = main.getByRole("checkbox", { name: "Select all files", exact: true });
    const count = main.locator("#made-area .kit-bulk-count");
    const looks = () => all.evaluate((box) => ({ checked: box.checked, indeterminate: box.indeterminate, count: box.parentElement.querySelector(".kit-bulk-count").textContent }));
    await expect(all).toHaveAttribute("title", "Select all");
    await expect(count).toHaveAttribute("role", "status");
    expect(await looks()).toEqual({ checked: false, indeterminate: false, count: "Select all" });
    await click(main, "two.txt");
    await click(main, "three.txt", ["Control"]);
    expect(await looks()).toEqual({ checked: false, indeterminate: true, count: "2 selected" });
    // Some: the box selects them all.
    await all.click();
    await selected(main, NAMES);
    expect(await looks()).toEqual({ checked: true, indeterminate: false, count: "6 selected" });
    // All: it clears.
    await all.click();
    await selected(main, []);
    expect(await looks()).toEqual({ checked: false, indeterminate: false, count: "Select all" });
    // None: it selects all, by keyboard too.
    await all.focus();
    await main.keyboard.press("Space");
    await selected(main, NAMES);

    // The bar shows only while the grid has cards.
    await expect(main.locator("#made-area .kit-bulk-bar")).toBeVisible();
    await main.evaluate(() => window.cards.forEach((card) => window.grid.remove(card)));
    await expect(main.locator("#made-area .kit-bulk-bar")).toBeHidden();
    await main.evaluate(() => window.grid.add(window.cards[0]));
    await expect(main.locator("#made-area .kit-bulk-bar")).toBeVisible();
    expect(await looks()).toEqual({ checked: false, indeterminate: false, count: "Select all" });
});

test("the target is labelled for the scope, with its note; the selection-only actions and Deselect show only with a selection", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildGrid(main);
    const bar = main.locator("#made-area .kit-bulk-bar");
    const buttons = () => bar.getByRole("button").evaluateAll((list) => list.filter((b) => !b.hidden).map((b) => `${b.textContent}${b.disabled ? " (disabled)" : ""}`));

    // None selected: the scope is every card.
    await expect(main.getByRole("combobox", { name: "Convert all to" })).toBeVisible();
    await expect(bar.locator(".kit-bulk-note")).toBeHidden();
    expect(await buttons()).toEqual(["Convert Each"]);
    await bar.getByRole("button", { name: "Convert Each" }).click();
    // Some: the selection.
    await click(main, "two.txt");
    await click(main, "five.txt", ["Control"]);
    const target = main.getByRole("combobox", { name: "Convert selected to" });
    await expect(target).toBeVisible();
    await expect(target).toHaveAccessibleDescription("Only 2 change");
    expect(await buttons()).toEqual(["Convert Each", "Remove", "Deselect"]);
    await bar.getByRole("button", { name: "Convert Each" }).click();
    expect(await main.evaluate(() => window.seen.clicks)).toEqual([["Convert Each", ...NAMES], ["Convert Each", "two.txt", "five.txt"]]);
    // enabled(), drawn again by refresh().
    await main.evaluate(() => {
        window.lockRemove = true;
        window.bar.refresh();
    });
    expect(await buttons()).toEqual(["Convert Each", "Remove (disabled)", "Deselect"]);
    await main.evaluate(() => {
        window.lockRemove = false;
        window.bar.refresh();
    });
    // Remove acts on the selection.
    await bar.getByRole("button", { name: "Remove" }).click();
    await selected(main, []);
    expect(await main.evaluate(() => window.grid.cards.map((card) => window.names.get(card)))).toEqual(["one.txt", "three.txt", "four.txt", "six.txt"]);
    expect(await buttons()).toEqual(["Convert Each"]);
    // Deselect clears, and hands the keyboard's focus to the select-all box rather than losing it.
    await click(main, "one.txt");
    await bar.getByRole("button", { name: "Deselect" }).focus();
    await main.keyboard.press("Enter");
    await selected(main, []);
    await expect(main.getByRole("checkbox", { name: "Select all files" })).toBeFocused();
});

// -- The demo's Queue, as an app uses them ---------------------------------------------

test("the Queue: Delete removes what's selected and can go, the queued upload included; the target sends the uploads waiting", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.getByRole("button", { name: "Queue", exact: true }).click();
    const queue = main.locator("#queue");
    const names = () => queue.locator(".kit-card").evaluateAll((cards) => cards.map((c) => c.getAttribute("aria-label")));
    const card = (name) => main.getByRole("group", { name, exact: true });
    const bar = main.locator("#queue-view .kit-bulk-bar");

    // The queued upload is locked, but keeps Remove.
    await expect(card("receipts.csv").getByRole("button", { name: "Remove receipts.csv" })).toBeEnabled();
    await expect(card("receipts.csv").getByRole("button", { name: "Advanced Options" })).toBeDisabled();
    // At rest, every upload waiting goes to the target's choice.
    await expect(main.getByRole("combobox", { name: "Upload all to" })).toBeVisible();
    await main.getByRole("combobox", { name: "Upload all to" }).selectOption("family");
    await expect(card("printer-manual.pdf").getByRole("combobox", { name: "Upload to" })).toHaveValue("family");
    await expect(card("receipts.csv").getByRole("combobox", { name: "Upload to" })).toHaveValue("drop");

    // A selection with no upload waiting: the note says so.
    await card("clip.mp4").locator(".kit-card-meta").click();
    await card("talk.mov").locator(".kit-card-meta").click({ modifiers: ["Shift"] });
    await expect(main.getByRole("combobox", { name: "Upload selected to" })).toHaveAccessibleDescription("No selected upload is waiting to start");
    // Delete: clip.mp4 goes; the paused upload and the running conversion are at work, and stay selected.
    await main.keyboard.press("Delete");
    expect(await names()).not.toContain("clip.mp4");
    expect(await names()).toContain("site-backup.tar");
    await expect(queue.locator(".kit-card.selected")).toHaveCount(2);
    // Only cards at work selected: the bar's Remove can't act.
    await expect(bar.getByRole("button", { name: "Remove" })).toBeDisabled();
    await card("receipts.csv").getByRole("checkbox", { name: "Select receipts.csv" }).click();
    await expect(bar.getByRole("button", { name: "Remove" })).toBeEnabled();
    await bar.getByRole("button", { name: "Remove" }).click();
    expect(await names()).not.toContain("receipts.csv");
    await expect(queue.locator(".kit-card.selected")).toHaveCount(2);
    await expect(bar.locator(".kit-bulk-count")).toHaveText("2 selected");
});

// -- Refusals and axe ------------------------------------------------------------------

test("the grid's and the bar's options are checked, and so is what they're given", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildGrid(main);
    expect(await refusals(main, [
        "kit.ui.cardGrid()",
        'kit.ui.cardGrid(document.getElementById("made"))',
        "kit.ui.cardGrid(document.createElement(\"div\"), null)",
        'kit.ui.cardGrid(document.createElement("div"), { veiw: "x" })',
        'kit.ui.cardGrid(document.createElement("div"), { view: "Queue" })',
        'kit.ui.cardGrid(document.createElement("div"), { onSelect: true })',
        "grid.add({ element: document.createElement(\"div\"), update() {} })",
        "grid.add(cards[0])",
        'kit.ui.cardGrid(document.createElement("div")).add(cards[0])',
        'grid.add(kit.ui.card({ icon: "description", name: "a.txt", onPick() {} }))',
        'grid.remove(kit.ui.card({ icon: "description", name: "a.txt" }))',
        'grid.select([cards[0], kit.ui.card({ icon: "description", name: "a.txt" })])',
        'kit.ui.bulkBar({}, { noun: "file" })',
        'kit.ui.bulkBar(grid, { noun: "file" })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), {})',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: { many: "files" } })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: "file", title: "A" })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: "file", target: { verb: "", control: target } })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: "file", target: { verb: "Convert", control: document.createElement("input") } })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: "file", target: { verb: "Convert", control: document.createElement("select"), note: "None" } })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: "file", target: { verb: "Convert", control: document.createElement("select"), label: "A" } })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: "file", actions: {} })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: "file", actions: [{ label: "", onClick() {} }] })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: "file", actions: [{ label: "Go", variant: "link", onClick() {} }] })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: "file", actions: [{ label: "Go", selection: "yes", onClick() {} }] })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: "file", actions: [{ label: "Go", enabled: true, onClick() {} }] })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: "file", actions: [{ label: "Go" }] })',
        'kit.ui.bulkBar(kit.ui.cardGrid(document.createElement("div")), { noun: "file", actions: [{ label: "Go", icon: "tune", onClick() {} }] })',
    ])).toEqual([
        "kit.ui.cardGrid(): the container must be the app's element.",
        "kit.ui.cardGrid(): the container is a grid already.",
        "kit.ui.cardGrid(): options must be { view, onSelect }.",
        'kit.ui.cardGrid(): it has no option "veiw".',
        "kit.ui.cardGrid(): view must be the shell's name for the view, or left out.",
        "kit.ui.cardGrid(): onSelect must be a function, or left out.",
        "kit.ui.cardGrid(): add() takes a card from kit.ui.card().",
        "kit.ui.cardGrid(): add(): the card is in a grid already.",
        "kit.ui.cardGrid(): add(): the card is in a grid already.",
        "kit.ui.cardGrid(): add(): the card has its own onPick; in a grid, the grid picks it.",
        "kit.ui.cardGrid(): remove() takes a card in this grid.",
        "kit.ui.cardGrid(): select() takes a card in this grid.",
        "kit.ui.bulkBar(): the grid must be one from kit.ui.cardGrid().",
        "kit.ui.bulkBar(): the grid has a bulk bar already.",
        'kit.ui.bulkBar(): noun must be what a card is, such as "file", or { one, many }.',
        'kit.ui.bulkBar(): noun must be what a card is, such as "file", or { one, many }.',
        'kit.ui.bulkBar(): it has no option "title".',
        'kit.ui.bulkBar(): target.verb must be text, such as "Convert".',
        "kit.ui.bulkBar(): target.control must be the app's <select>.",
        "kit.ui.bulkBar(): target.note must be a function, or left out.",
        'kit.ui.bulkBar(): target has no option "label".',
        "kit.ui.bulkBar(): actions must be a list of { label, variant, selection, onClick }.",
        "kit.ui.bulkBar(): actions[0].label must be text.",
        "kit.ui.bulkBar(): actions[0].variant must be one of primary, secondary, success, warning, danger, outline-secondary, outline-danger.",
        "kit.ui.bulkBar(): actions[0].selection must be true or false: whether it shows only with a selection.",
        "kit.ui.bulkBar(): actions[0].enabled must be a function, or left out.",
        "kit.ui.bulkBar(): actions[0].onClick must be a function.",
        'kit.ui.bulkBar(): actions[0] has no option "icon".',
    ]);
    // None of those touched the grid.
    expect(await main.evaluate(() => window.grid.cards.length)).toBe(6);
    await selected(main, []);
});

/**
 * Each button's text against what's painted under it, worked out from the
 * colours themselves: the button's fill over the card's or the bar's wash,
 * over the page. axe passes over some of these.
 */
async function buttonContrasts(page, where) {
    const painted = await page.locator(`${where} .btn`).evaluateAll((buttons) => buttons.filter((b) => b.checkVisibility() && !b.disabled).map((button) => {
        const layers = [];
        for (let node = button; node; node = node.parentElement) layers.push(getComputedStyle(node).backgroundColor);
        return { name: `${button.closest(".kit-card")?.getAttribute("aria-label") ?? "the bar"}: ${button.textContent}`, text: getComputedStyle(button).color, layers };
    }));
    return painted.map(({ name, text, layers }) => {
        // From the page up: each layer laid over what's under it.
        const under = layers.reverse().reduce((below, layer) => over(layer, below), { r: 255, g: 255, b: 255, a: 1 });
        return [name, Math.round(contrastRatio(text, under) * 100) / 100];
    });
}

test("every button on a selected or hovered card, and on the bar, holds 4.5:1 on what's under it, in both themes and every accent", async ({ demo }) => {
    test.slow();
    const main = await demo.mainWindow();
    await main.emulateMedia({ reducedMotion: "reduce" });
    await main.getByRole("button", { name: "Queue", exact: true }).click();
    const card = (name) => main.getByRole("group", { name, exact: true });
    // Every kind of button: a running card's Cancel, a paused one's Resume, a finished one's Copy Link and Delete, a ready one's Upload.
    await card("site-backup.tar").locator(".kit-card-meta").click();
    for (const name of ["talk.mov", "quarterly-report.pdf", "printer-manual.pdf", "interview.wav"]) await card(name).locator(".kit-card-meta").click({ modifiers: ["Control"] });
    const short = [];
    for (const accent of [null, ...APP_ACCENTS]) {
        const style = accent && await main.addStyleTag({ content: fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "accents", `${accent}.css`), "utf8") });
        for (const theme of ["light", "dark"]) {
            await demo.useTheme(main, theme);
            await main.mouse.move(0, 0);
            const seen = await buttonContrasts(main, "#queue-view");
            expect(seen.length).toBeGreaterThanOrEqual(10);
            // An unselected card, hovered: its lighter wash.
            await card("poster.png").locator(".kit-card-meta").hover();
            await expect(main.locator("#queue-view .kit-card:hover")).toHaveAttribute("aria-label", "poster.png");
            seen.push(...await buttonContrasts(main, "#queue-view .kit-card:hover"));
            // A selected one, hovered: the strongest wash.
            await card("talk.mov").locator(".kit-card-meta").hover();
            await expect(main.locator("#queue-view .kit-card:hover")).toHaveAttribute("aria-label", "talk.mov");
            seen.push(...await buttonContrasts(main, "#queue-view .kit-card:hover"));
            short.push(...seen.filter(([, ratio]) => ratio < 4.5).map(([name, ratio]) => `${accent ?? "demo"}, ${theme}: ${name} is ${ratio}:1`));
        }
        await style?.evaluate((element) => element.remove());
    }
    expect(short).toEqual([]);
});

test("axe finds nothing in the Queue with a selection and its bar, in both themes, in the demo's accent and each app's", async ({ demo }) => {
    test.slow();
    const main = await demo.mainWindow();
    await main.getByRole("button", { name: "Queue", exact: true }).click();
    const card = (name) => main.getByRole("group", { name, exact: true });
    await card("clip.mp4").locator(".kit-card-meta").click();
    await card("talk.mov").locator(".kit-card-meta").click({ modifiers: ["Shift"] });
    await card("printer-manual.pdf").getByRole("checkbox").click();
    await expect(main.locator("#queue .kit-card.selected")).toHaveCount(4);
    const found = [];
    for (const accent of [null, ...APP_ACCENTS]) {
        const style = accent && await main.addStyleTag({ content: fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "accents", `${accent}.css`), "utf8") });
        for (const theme of ["light", "dark"]) {
            await demo.useTheme(main, theme);
            for (const hovered of [false, true]) {
                if (hovered) {
                    await card("talk.mov").locator(".kit-card-meta").hover();
                    await expect(main.locator("#queue-view .kit-card:hover")).toHaveAttribute("aria-label", "talk.mov");
                } else {
                    await main.mouse.move(0, 0);
                    await expect(main.locator("#queue-view .kit-card:hover")).toHaveCount(0);
                }
                await main.evaluate(() => Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished)));
                const { violations } = await new AxeBuilder({ page: main }).setLegacyMode(true).include("#queue-view").withTags(WCAG_22_AA).analyze();
                found.push(...violations.flatMap((v) => v.nodes.map((node) => `${accent ?? "demo"}, ${theme}${hovered ? ", hovered" : ""}: ${v.id}: ${node.target.join(" ")}: ${node.failureSummary.replace(/\s+/g, " ")}`)));
            }
        }
        await style?.evaluate((element) => element.remove());
    }
    expect(found).toEqual([]);
});
