"use strict";

// kit.ui.card(), the paused bar and kit.ui.busy(), in real Electron. Each card
// is built on the demo's Overview by the test (the demo's own Queue shows the
// two apps' shapes, and the accessibility and visual specs hold those): its
// anatomy and names, what a click picks, its buttons kept across an update,
// locked and canRemove, the status line's tones, the paused bar, a busy button and its
// restore, the options' refusals, and every button on a card one size.

const { default: AxeBuilder } = require("@axe-core/playwright");
const { test, expect } = require("./helpers/demo");

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * A card on the Overview with everything: a route with the app's select, a
 * row of its own (a link field), and what each part does kept on window.seen.
 * The card is window.made; its options can be changed with `change`.
 */
function buildCard(page, change = {}) {
    return page.evaluate((change) => {
        window.seen = { configure: 0, remove: 0, picks: [], clicks: [] };
        const select = document.createElement("select");
        select.className = "form-select form-select-sm";
        select.setAttribute("aria-label", "Upload to");
        select.append(new Option("Example Drop", "drop"), new Option("Family Files", "family"));
        const link = document.createElement("input");
        link.className = "form-control form-control-sm";
        link.readOnly = true;
        link.value = "https://drop.example.com/abc";
        link.setAttribute("aria-label", "Link");
        window.link = link;
        const options = {
            icon: "upload_file",
            name: "site-backup.tar",
            onConfigure: () => window.seen.configure++,
            onRemove: () => window.seen.remove++,
            route: { label: "To", control: select },
            onPick: (_event, { box }) => window.seen.picks.push(box ? "box" : "card"),
        };
        for (const [key, value] of Object.entries(change)) {
            if (value === null) delete options[key];
            else options[key] = value;
        }
        if (change.route === "from") options.route = { from: "MP4", control: select };
        window.made = window.kit.ui.card(options);
        window.made.element.id = "made";
        window.made.element.style.maxWidth = "320px";
        document.getElementById("overview-view").prepend(window.made.element);
    }, change);
}

/** Draw the card, with actions that note their clicks on window.seen.clicks. */
const draw = (page, state) => page.evaluate((state) => {
    const actions = (state.actions ?? []).map(([label, variant]) => ({ label, variant, onClick: (button) => window.seen.clicks.push(`${label}:${button.tagName}`) }));
    const rows = state.rows ? [window.link] : undefined;
    window.made.update({ ...state, actions, rows });
}, state);

const PAUSED = {
    meta: "3.1 GB",
    settings: "3 Days · 10 Downloads",
    status: { text: "Paused. Kept until 14:32.", tone: "warning" },
    percent: 35,
    paused: true,
    actions: [["Resume", "outline-secondary"], ["Cancel", "outline-danger"]],
    rows: true,
    locked: true,
};

async function violations(page) {
    const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).include("#made").withTags(WCAG_22_AA).analyze();
    return violations.flatMap((v) => v.nodes.map((node) => `${v.id}: ${node.target.join(" ")}: ${node.failureSummary.replace(/\s+/g, " ")}`));
}

/** Each option's error, or "made". */
const refusals = (page, calls) => page.evaluate((calls) => calls.map((call) => {
    try {
        // eslint-disable-next-line no-new-func
        new Function("kit", "made", "select", call)(window.kit, window.made, document.querySelector("#made select"));
        return "made";
    } catch (err) {
        return err.message;
    }
}), calls);

// -- Anatomy ------------------------------------------------------------------------

test("a card: its head, its lines, its route, its status, its bar, the app's rows and its buttons, each named", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildCard(main);
    await draw(main, PAUSED);
    const made = main.getByRole("group", { name: "site-backup.tar" });
    await expect(made).toBeVisible();

    // The head, in order: the box, the glyph (hidden), the name, Advanced Options, Remove.
    const head = made.locator(".kit-card-head > *");
    expect(await head.evaluateAll((parts) => parts.map((p) => p.getAttribute("aria-label") ?? p.textContent))).toEqual([
        "Select site-backup.tar", "upload_file", "site-backup.tar", "Advanced Options", "Remove site-backup.tar",
    ]);
    await expect(made.getByRole("checkbox", { name: "Select site-backup.tar" })).toBeVisible();
    await expect(made.locator(".kit-card-icon")).toHaveAttribute("aria-hidden", "true");
    await expect(made.locator(".kit-card-name")).toHaveAttribute("title", "site-backup.tar");
    await expect(made.getByRole("button", { name: "Advanced Options" })).toHaveAttribute("title", "Advanced Options");
    await expect(made.getByRole("button", { name: "Remove site-backup.tar" })).toHaveAttribute("title", "Remove");
    for (const glyph of await made.locator(".material-icons-round").all()) await expect(glyph).toHaveAttribute("aria-hidden", "true");

    // Under it, in order.
    const parts = await made.evaluate((card) => [...card.children].filter((c) => !c.hidden).map((c) => c.className.split(" ").find((n) => n.startsWith("kit-card-"))));
    expect(parts).toEqual(["kit-card-head", "kit-card-meta", "kit-card-settings", "kit-card-route", "kit-card-status", "kit-card-progress", "kit-card-rows", "kit-card-actions"]);
    await expect(made.locator(".kit-card-meta")).toHaveText("3.1 GB");
    await expect(made.locator(".kit-card-settings")).toHaveText("3 Days · 10 Downloads");
    // The route's label is uppercase on screen, "To" to a screen reader; then the app's control.
    await expect(made.locator(".kit-card-route-label")).toHaveText("To");
    expect(await made.locator(".kit-card-route-label").evaluate((el) => getComputedStyle(el).textTransform)).toBe("uppercase");
    await expect(made.locator(".kit-card-route > :last-child")).toHaveAttribute("aria-label", "Upload to");
    await expect(made.locator(".kit-card-status")).toHaveClass(/kit-tone-warning/);
    await expect(made.locator(".kit-status-text")).toHaveText("Paused. Kept until 14:32.");
    await expect(made.locator(".kit-status-text")).toHaveAttribute("title", "Paused. Kept until 14:32.");
    await expect(made.getByRole("progressbar", { name: "site-backup.tar" })).toHaveAttribute("aria-valuenow", "35");
    await expect(made.getByRole("textbox", { name: "Link" })).toHaveValue("https://drop.example.com/abc");
    await expect(made.locator(".kit-card-actions").getByRole("button")).toHaveText(["Resume", "Cancel"]);
    await expect(made.getByRole("button", { name: "Cancel" })).toHaveClass(/btn btn-sm btn-outline-danger/);

    // DFC's route: "MP4 →", the arrow hidden; and no Advanced Options or Remove when they aren't given.
    await main.evaluate(() => window.made.element.remove());
    await buildCard(main, { route: "from", onConfigure: null, onRemove: null });
    await draw(main, { status: { text: "Ready", tone: "ready" } });
    const route = main.locator("#made .kit-card-route");
    await expect(route.locator(".kit-card-from")).toHaveText("MP4");
    await expect(route.locator(".kit-card-arrow")).toHaveText("arrow_forward");
    await expect(route.locator(".kit-card-arrow")).toHaveAttribute("aria-hidden", "true");
    await expect(main.locator("#made .kit-card-head button")).toHaveCount(0);
});

test("update() draws the whole state each time: what's left out is hidden, a name renames everything, route: false hides the route", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildCard(main);
    await draw(main, PAUSED);
    await draw(main, { status: { text: "Ready", tone: "ready" } });
    const shown = () => main.locator("#made").evaluate((card) => [...card.children].filter((c) => getComputedStyle(c).display !== "none").map((c) => c.className.split(" ").find((n) => n.startsWith("kit-card-"))));
    expect(await shown()).toEqual(["kit-card-head", "kit-card-route", "kit-card-status"]);
    await expect(main.locator("#made select")).toBeEnabled();

    await draw(main, { name: "Link from drop.example.com", route: false, settings: { text: "Not encrypted: This server is plain HTTP.", tone: "warning" } });
    expect(await shown()).toEqual(["kit-card-head", "kit-card-settings"]);
    await expect(main.locator("#made .kit-card-settings")).toHaveClass(/kit-card-settings-warning/);
    const made = main.getByRole("group", { name: "Link from drop.example.com" });
    await expect(made.getByRole("checkbox", { name: "Select Link from drop.example.com" })).toHaveCount(1);
    await expect(made.getByRole("button", { name: "Remove Link from drop.example.com" })).toHaveCount(1);
    await expect(made.locator(".kit-card-name")).toHaveAttribute("title", "Link from drop.example.com");
    await draw(main, { percent: null });
    await expect(made.getByRole("progressbar", { name: "Link from drop.example.com" })).not.toHaveAttribute("aria-valuenow");
});

// -- Picking -------------------------------------------------------------------------

test("a click on the card or its box picks it; one on its own controls or the app's rows doesn't", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildCard(main);
    await draw(main, { ...PAUSED, locked: false });
    const made = main.locator("#made");
    await made.locator(".kit-card-meta").click();
    await made.locator(".kit-card-status").click();
    await made.getByRole("checkbox", { name: "Select site-backup.tar" }).click();
    await made.getByRole("button", { name: "Advanced Options" }).click();
    await made.getByRole("button", { name: "Remove site-backup.tar" }).click();
    // A select's own click, without opening its list.
    await made.getByRole("combobox", { name: "Upload to" }).dispatchEvent("click");
    await made.getByRole("textbox", { name: "Link" }).click();
    await made.getByRole("button", { name: "Resume" }).click();
    expect(await main.evaluate(() => window.seen)).toEqual({ configure: 1, remove: 1, picks: ["card", "card", "box"], clicks: ["Resume:BUTTON"] });
    await expect(made).toHaveCSS("cursor", "pointer");

    // Without onPick, a click does nothing, and the card doesn't look as if it would.
    await main.evaluate(() => window.made.element.remove());
    await buildCard(main, { onPick: null });
    await draw(main, PAUSED);
    await main.locator("#made .kit-card-meta").click();
    expect(await main.evaluate(() => window.seen.picks)).toEqual([]);
    await expect(main.locator("#made")).toHaveCSS("cursor", "auto");
});

// -- Buttons -------------------------------------------------------------------------

test("the buttons are kept across an update with the same actions, each calling the onClick it was last given; rebuilt when they change", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildCard(main);
    await draw(main, PAUSED);
    await main.evaluate(() => {
        window.before = [...document.querySelectorAll("#made .kit-card-actions button")];
    });
    // Ticks: the same buttons, the bar moving.
    for (const percent of [36, 37, 38]) await draw(main, { ...PAUSED, percent });
    expect(await main.evaluate(() => [...document.querySelectorAll("#made .kit-card-actions button")].every((b, i) => b === window.before[i]))).toBe(true);
    // A new onClick for the same button is the one called.
    await main.evaluate(() => window.made.update({ actions: [{ label: "Resume", onClick: () => window.seen.clicks.push("newer") }, { label: "Cancel", variant: "outline-danger", onClick() {} }] }));
    expect(await main.evaluate(() => document.querySelector("#made .kit-card-actions button") === window.before[0])).toBe(true);
    await main.getByRole("button", { name: "Resume" }).click();
    expect(await main.evaluate(() => window.seen.clicks)).toEqual(["newer"]);
    // Another label, or another variant: rebuilt.
    await draw(main, { ...PAUSED, actions: [["Pause", "outline-secondary"], ["Cancel", "outline-danger"]] });
    expect(await main.evaluate(() => document.querySelector("#made .kit-card-actions button") === window.before[0])).toBe(false);
    await main.evaluate(() => {
        window.before = [...document.querySelectorAll("#made .kit-card-actions button")];
    });
    await draw(main, { ...PAUSED, actions: [["Pause", "outline-secondary"], ["Cancel", "danger"]] });
    expect(await main.evaluate(() => document.querySelector("#made .kit-card-actions button") === window.before[0])).toBe(false);
    // None: the line goes.
    await draw(main, { ...PAUSED, actions: [] });
    await expect(main.locator("#made .kit-card-actions")).toBeHidden();
});

test("the app's rows are put back only when they're other elements, so a field keeps its selection", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildCard(main);
    await draw(main, PAUSED);
    const link = main.getByRole("textbox", { name: "Link" });
    await link.focus();
    await link.selectText();
    await draw(main, { ...PAUSED, percent: 40 });
    await expect(link).toBeFocused();
    expect(await link.evaluate((input) => [input.selectionStart, input.selectionEnd])).toEqual([0, 28]);
});

test("locked disables Advanced Options, the route's control and Remove, and unlocked gives them back; canRemove sets Remove apart", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildCard(main);
    const made = main.locator("#made");
    const locks = () => Promise.all([
        made.getByRole("button", { name: "Advanced Options" }),
        made.getByRole("combobox", { name: "Upload to" }),
        made.getByRole("button", { name: "Remove site-backup.tar" }),
    ].map((control) => control.isDisabled()));
    await draw(main, PAUSED);
    expect(await locks()).toEqual([true, true, true]);
    // A locked card's buttons still work: Cancel is how its work is stopped.
    await expect(made.getByRole("button", { name: "Cancel" })).toBeEnabled();
    await draw(main, { ...PAUSED, locked: false });
    expect(await locks()).toEqual([false, false, false]);
    await draw(main, { ...PAUSED, locked: true });
    await made.getByRole("button", { name: "Remove site-backup.tar" }).click({ force: true });
    expect(await main.evaluate(() => window.seen.remove)).toBe(0);

    // canRemove, which follows locked unless given: a queued card keeps Remove while the rest is locked.
    await draw(main, { ...PAUSED, locked: true, canRemove: true });
    expect(await locks()).toEqual([true, true, false]);
    await made.getByRole("button", { name: "Remove site-backup.tar" }).click();
    expect(await main.evaluate(() => window.seen.remove)).toBe(1);
    await draw(main, { ...PAUSED, locked: false, canRemove: false });
    expect(await locks()).toEqual([false, false, true]);
    // Whole state each time: left out, it follows locked again.
    await draw(main, { ...PAUSED, locked: false });
    expect(await locks()).toEqual([false, false, false]);
});

// -- The status line -----------------------------------------------------------------

test("the status line's dot takes its tone's colour, and only running pulses; under reduced motion it's still", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildCard(main);
    const looks = async (tone) => {
        await draw(main, { status: { text: "Words", tone } });
        return main.locator("#made .kit-status-dot").evaluate((dot) => {
            const style = getComputedStyle(dot);
            const probe = document.createElement("span");
            dot.parentElement.append(probe);
            const of = (value) => {
                probe.style.color = value;
                return getComputedStyle(probe).color;
            };
            const colours = { accent: of("var(--accent)"), warning: of("var(--bs-warning)"), danger: of("var(--bs-danger)"), success: of("var(--bs-success)"), secondary: of("var(--bs-secondary-color)") };
            probe.remove();
            const named = Object.entries(colours).find(([, value]) => value === style.backgroundColor)?.[0];
            return { colour: named, pulse: style.animationName, iterations: style.animationIterationCount, width: style.width };
        });
    };
    const seen = {};
    for (const tone of ["ready", "running", "warning", "danger", "success", "muted"]) seen[tone] = await looks(tone);
    expect(seen).toEqual({
        ready: { colour: "accent", pulse: "none", iterations: "1", width: "7px" },
        running: { colour: "accent", pulse: "kit-status-pulse", iterations: "infinite", width: "7px" },
        warning: { colour: "warning", pulse: "none", iterations: "1", width: "7px" },
        danger: { colour: "danger", pulse: "none", iterations: "1", width: "7px" },
        success: { colour: "success", pulse: "none", iterations: "1", width: "7px" },
        muted: { colour: "secondary", pulse: "none", iterations: "1", width: "7px" },
    });
    await main.emulateMedia({ reducedMotion: "reduce" });
    expect((await looks("running")).pulse).toBe("none");
});

// -- The paused bar ------------------------------------------------------------------

test("a paused bar keeps its value, faded and still; one whose amount isn't known doesn't slide; set() again brings it back", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.evaluate(() => {
        window.bar = window.kit.ui.progress({ label: "site-backup.tar", thin: true });
        window.bar.element.id = "bar";
        document.getElementById("overview-view").prepend(window.bar.element);
        window.bar.set(35);
    });
    const bar = main.getByRole("progressbar", { name: "site-backup.tar" });
    const looks = () => bar.evaluate((el) => {
        const fill = el.querySelector(".progress-bar");
        return {
            opacity: getComputedStyle(el).opacity,
            animation: getComputedStyle(fill).animationName,
            transition: getComputedStyle(fill).transitionDuration,
            width: Math.round((fill.getBoundingClientRect().width / el.getBoundingClientRect().width) * 100),
        };
    });
    await main.evaluate(() => window.bar.set(35, { paused: true }));
    await expect(bar).toHaveAttribute("aria-valuenow", "35");
    expect(await looks()).toEqual({ opacity: "0.45", animation: "none", transition: "0s", width: 35 });
    await main.evaluate(() => window.bar.set(null, { paused: true }));
    await expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(await looks()).toEqual({ opacity: "0.45", animation: "none", transition: "0s", width: 100 });
    await main.evaluate(() => window.bar.set(null));
    expect((await looks()).animation).toBe("kit-progress-slide");
    await main.evaluate(() => window.bar.set(36));
    await expect(bar).toHaveAttribute("aria-valuenow", "36");
    expect((await looks()).opacity).toBe("1");

    // On a card: percent and paused.
    await buildCard(main);
    await draw(main, PAUSED);
    await expect(main.locator("#made .kit-card-progress")).toHaveClass(/kit-progress-paused/);
    await draw(main, { ...PAUSED, paused: false });
    await expect(main.locator("#made .kit-card-progress")).not.toHaveClass(/kit-progress-paused/);
    await expect(main.locator("#made .kit-card-progress")).toHaveAttribute("aria-valuenow", "35");

    expect(await refusals(main, ['window.bar.set(1, { paused: "yes" })', "window.bar.set(1, { paused: 1 })"])).toEqual([
        "kit.ui.progress(): paused must be true or false.",
        "kit.ui.progress(): paused must be true or false.",
    ]);
});

// -- Busy ---------------------------------------------------------------------------

test("busy(): disabled, a hidden spinner before its label; restore() puts the label and the enabled state back, once", async ({ demo }) => {
    const main = await demo.mainWindow();
    await main.evaluate(() => {
        const b = document.createElement("button");
        b.type = "button";
        b.id = "pause";
        b.className = "btn btn-outline-secondary";
        b.innerHTML = '<span class="material-icons-round" style="font-size: 16px" aria-hidden="true">pause</span>Pause';
        document.getElementById("overview-view").prepend(b);
        window.heights = [b.getBoundingClientRect().height];
        window.restore = window.kit.ui.busy(b, "Pausing…");
        window.heights.push(b.getBoundingClientRect().height);
    });
    const button = main.locator("#pause");
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleName("Pausing…");
    await expect(button).toHaveClass(/kit-busy/);
    expect(await button.evaluate((b) => [...b.childNodes].map((n) => (n.nodeType === 1 ? `${n.className}|${n.getAttribute("aria-hidden")}` : n.textContent)))).toEqual([
        "spinner-border spinner-border-sm|true", "Pausing…",
    ]);
    // The spinner is sized to the text: the button is no taller than it was.
    const [before, during] = await main.evaluate(() => window.heights);
    expect(during).toBe(before);
    await main.evaluate(() => window.restore());
    await expect(button).toBeEnabled();
    await expect(button).not.toHaveClass(/kit-busy/);
    expect(await button.evaluate((b) => b.innerHTML)).toBe('<span class="material-icons-round" style="font-size: 16px" aria-hidden="true">pause</span>Pause');
    // Twice: nothing more. A button disabled before stays disabled after.
    await button.evaluate((b) => {
        b.disabled = false;
    });
    await main.evaluate(() => window.restore());
    await expect(button).toBeEnabled();
    await main.evaluate(() => {
        const b = document.getElementById("pause");
        b.disabled = true;
        window.kit.ui.busy(b, "Pausing…")();
    });
    await expect(button).toBeDisabled();

    expect(await refusals(main, [
        'kit.ui.busy(document.createElement("div"), "Pausing…")',
        'kit.ui.busy(document.createElement("button"), "")',
        'const b = document.createElement("button"); kit.ui.busy(b, "Pausing…"); kit.ui.busy(b, "Pausing…")',
    ])).toEqual([
        "kit.ui.busy(): the button must be a <button>.",
        'kit.ui.busy(): label must be text, such as "Pausing…".',
        "kit.ui.busy(): the button is already busy.",
    ]);
});

test("every button on a card is one size: the same height, padding, font size and border across variants, in the rows, and while busy", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildCard(main);
    const variants = ["primary", "secondary", "success", "warning", "danger", "outline-secondary", "outline-danger"];
    await main.evaluate((variants) => {
        const row = document.createElement("div");
        row.innerHTML = '<button type="button" class="btn btn-secondary">In a Row</button><button type="button" class="btn btn-lg btn-primary">Large</button>';
        window.made.update({ rows: [row], actions: variants.map((variant) => ({ label: variant === "primary" ? "Upload" : "Pause", variant, onClick() {} })) });
        window.kit.ui.busy(document.querySelector("#made .kit-card-actions .btn-outline-secondary"), "Pausing…");
        window.kit.ui.busy(document.querySelector("#made .kit-card-actions .btn-primary"), "Uploading…");
    }, variants);
    const sizes = await main.locator("#made .btn").evaluateAll((buttons) => buttons.map((b) => {
        const style = getComputedStyle(b);
        return {
            height: b.getBoundingClientRect().height,
            padding: style.padding,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            border: `${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth}`,
            busy: b.classList.contains("kit-busy"),
        };
    }));
    expect(sizes).toHaveLength(9);
    expect(sizes.filter((s) => s.busy)).toHaveLength(2);
    // 0.1rem 0.45rem of padding, 0.72rem text at a line height of 1.5, a 1px border: 1.6 + 17.28 + 1.6 + 2.
    for (const size of sizes) {
        expect({ ...size, busy: undefined }).toEqual({ height: sizes[0].height, padding: "1.6px 7.2px", fontSize: "11.52px", lineHeight: "17.28px", border: "1px 1px 1px 1px", busy: undefined });
    }
    expect(sizes[0].height).toBeCloseTo(22.48, 1);
});

// -- Refusals and axe ----------------------------------------------------------------

test("a card's options and its state are checked, and a mistake in the state leaves the card as it was", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildCard(main);
    await draw(main, PAUSED);
    expect(await refusals(main, [
        "kit.ui.card()",
        'kit.ui.card({ name: "a.txt" })',
        'kit.ui.card({ icon: "upload_file" })',
        'kit.ui.card({ icon: "upload_file", name: "a.txt", onRemove: "yes" })',
        'kit.ui.card({ icon: "upload_file", name: "a.txt", onPick: 1 })',
        'kit.ui.card({ icon: "upload_file", name: "a.txt", route: { label: "To" } })',
        'kit.ui.card({ icon: "upload_file", name: "a.txt", route: { label: "To", from: "MP4", control: select } })',
        'kit.ui.card({ icon: "upload_file", name: "a.txt", route: { from: "", control: select } })',
        'kit.ui.card({ icon: "upload_file", name: "a.txt", route: { label: "To", control: select, note: 1 } })',
        'kit.ui.card({ icon: "upload_file", name: "a.txt", title: "A" })',
        'made.update({ stauts: { text: "Ready", tone: "ready" } })',
        'made.update({ status: { text: "Ready", tone: "info" } })',
        'made.update({ status: "Ready" })',
        "made.update({ name: \"\" })",
        "made.update({ meta: 3 })",
        'made.update({ settings: { text: "A", tone: "danger" } })',
        'made.update({ percent: "50" })',
        "made.update({ percent: 5, paused: 1 })",
        'made.update({ actions: [{ label: "Go", onClick() {} , variant: "link" }] })',
        'made.update({ actions: [{ label: "", onClick() {} }] })',
        'made.update({ actions: [{ label: "Go" }] })',
        "made.update({ actions: {} })",
        'made.update({ rows: ["text"] })',
        'made.update({ locked: "yes" })',
        'made.update({ canRemove: "yes" })',
        'made.update({ route: "no" })',
        "made.update(null)",
    ])).toEqual([
        "kit.ui.card(): icon must be a Material Icons Round glyph.",
        "kit.ui.card(): icon must be a Material Icons Round glyph.",
        "kit.ui.card(): name must be text.",
        "kit.ui.card(): onRemove must be a function, or left out.",
        "kit.ui.card(): onPick must be a function, or left out.",
        "kit.ui.card(): route.control must be the app's element.",
        'kit.ui.card(): route takes a label ("To") or a from ("MP4"), not both.',
        "kit.ui.card(): route.from must be text.",
        'kit.ui.card(): route has no option "note".',
        'kit.ui.card(): it has no option "title".',
        'kit.ui.card(): update() has no option "stauts".',
        "kit.ui.card(): update(): status must be { text, tone }, the tone one of ready, running, warning, danger, success, muted.",
        "kit.ui.card(): update(): status must be { text, tone }, the tone one of ready, running, warning, danger, success, muted.",
        "kit.ui.card(): update(): name must be text.",
        "kit.ui.card(): update(): meta must be text.",
        'kit.ui.card(): update(): settings must be text, or { text, tone: "warning" }.',
        "kit.ui.card(): update(): percent must be a number, or null when it isn't known.",
        "kit.ui.card(): update(): paused must be true or false.",
        "kit.ui.card(): update(): an action's variant must be one of primary, secondary, success, warning, danger, outline-secondary, outline-danger.",
        "kit.ui.card(): update(): each action's label must be text.",
        "kit.ui.card(): update(): each action's onClick must be a function.",
        "kit.ui.card(): update(): actions must be a list of { label, variant, onClick }.",
        "kit.ui.card(): update(): rows must be a list of the app's elements.",
        "kit.ui.card(): update(): locked must be true or false.",
        "kit.ui.card(): update(): canRemove must be true or false.",
        "kit.ui.card(): update(): route must be true or false: whether the route shows.",
        "kit.ui.card(): update() takes the card's state, { status, … }.",
    ]);
    // Every one of those left the paused card as it was drawn.
    await expect(main.locator("#made .kit-status-text")).toHaveText("Paused. Kept until 14:32.");
    await expect(main.locator("#made .kit-card-actions button")).toHaveText(["Resume", "Cancel"]);
    await expect(main.locator("#made .kit-card-progress")).toHaveAttribute("aria-valuenow", "35");
});

test("axe finds nothing in a card in each tone, with a busy button, in both themes", async ({ demo }) => {
    const main = await demo.mainWindow();
    await buildCard(main);
    const found = [];
    for (const theme of ["light", "dark"]) {
        await demo.useTheme(main, theme);
        for (const tone of ["ready", "running", "warning", "danger", "success", "muted"]) {
            await draw(main, { ...PAUSED, status: { text: `Words in ${tone}`, tone }, locked: tone === "running" });
            // The same buttons each time, so the first stays busy once it is.
            await main.evaluate(() => {
                const first = document.querySelector("#made .kit-card-actions button");
                if (!first.classList.contains("kit-busy")) window.kit.ui.busy(first, "Resuming…");
            });
            await main.mouse.move(0, 0);
            found.push(...(await violations(main)).map((line) => `${theme}, ${tone}: ${line}`));
        }
    }
    expect(found).toEqual([]);
});
