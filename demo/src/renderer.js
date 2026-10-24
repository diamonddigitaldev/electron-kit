"use strict";

// The demo's page: kit.ui.mountShell() builds the frame around its three
// sections and its own Settings tab, then the page shows what each bridge and
// each of the kit's page files gave it, and marks itself ready
// (body[data-ready]), which the tests wait for.

const $ = (id) => document.getElementById(id);

/** Show a check's result in its row, or what went wrong. */
async function show(id, check) {
    try {
        $(id).textContent = await check();
    } catch (err) {
        $(id).textContent = `Failed: ${err.message}`;
    }
}

/** Show the theme theme.js stamped on <html>, and each change to it. */
function showTheme() {
    const names = { dark: "Dark", light: "Light" };
    const update = () => {
        $("theme").textContent = names[document.documentElement.getAttribute("data-bs-theme")] ?? "Missing";
    };
    update();
    new MutationObserver(update).observe(document.documentElement, { attributeFilter: ["data-bs-theme"] });
}

/** The General tab's switch. */
let accentSwitch = null;

/**
 * The demo's own Settings tab: one setting of its own, a switch kept through
 * the kit's settings:set as it's changed, with no save button.
 */
function renderGeneral(pane) {
    accentSwitch = window.kit.ui.switchField({
        id: "show-accent-sample",
        label: "Show the accent sample",
        help: {
            on: "The Overview shows the accent's text, a link and a bar.",
            off: "The Overview leaves the accent sample out.",
        },
        onChange: async (checked) => applySettings(await window.kitAPI.setSettings({ showAccentSample: checked })),
    });
    pane.replaceChildren(accentSwitch.element);
}

/** Put the demo's settings in place. */
function applySettings(settings) {
    accentSwitch.set(settings.showAccentSample);
    $("accent-sample").classList.toggle("d-none", !settings.showAccentSample);
}

// -- The Queue -------------------------------------------------------------------
//
// kit.ui.card() as the two apps use it: files to convert, with File Converter's
// format row and output line, and transfers, with Dropgate's "To" row and the
// link a finished upload gives. Each is drawn from its state, and its buttons
// move it on as the app would, a pause or a resume taking a moment. They sit
// in kit.ui.cardGrid(), which selects them, under kit.ui.bulkBar(): uploads
// waiting to start can all be sent somewhere else at once, and what's
// selected can be removed (or with Delete, the app's own key).

/** The Queue's grid, and what each card is: its item, by the card. */
let queue = null;
const items = new Map();

/** A select for a card's route, named for what it chooses. */
function routeSelect(name, options, value) {
    const select = document.createElement("select");
    select.className = "form-select form-select-sm";
    select.setAttribute("aria-label", name);
    for (const [optionValue, label] of options) select.append(new Option(label, optionValue));
    select.value = value;
    return select;
}

const FORMATS = [["", "Choose format…"], ["mp4", "MP4"], ["webm", "WebM"], ["gif", "GIF"], ["png", "PNG Frames"], ["mp3", "MP3"], ["webp", "WebP"]];
const SERVERS = [["drop", "Example Drop (default)"], ["family", "Family Files"], ["nas", "NAS"]];
const FOLDERS = [["downloads", "Downloads"], ["videos", "Videos"]];

/** What the demo's buttons say they'd do, in a toast. */
const says = (message) => () => window.kit.ui.toast(message, { type: "info" });

/** Draw an item again in the state it's moved to; a pause or a resume takes a moment, with its button busy. */
function moveTo(item, state, { button, busyLabel } = {}) {
    if (button) window.kit.ui.busy(button, busyLabel);
    const move = () => {
        item.state = state;
        item.draw();
    };
    if (button) setTimeout(move, 700);
    else move();
}

/** A file to convert, as File Converter draws one. */
function conversion(spec) {
    const item = { ...spec, upload: false };
    const select = routeSelect(`Convert ${spec.name} to`, FORMATS, spec.target);
    const output = document.createElement("button");
    output.type = "button";
    output.className = "demo-output";
    output.textContent = spec.output ?? "";
    output.addEventListener("click", says("Advanced Options open here."));
    const card = window.kit.ui.card({
        icon: spec.icon,
        name: spec.name,
        onConfigure: says("Advanced Options open here."),
        onRemove: () => queue.remove(card),
        route: { from: spec.from, control: select },
    });
    item.draw = () => {
        const states = {
            ready: { status: { text: "Ready", tone: "ready" } },
            running: { status: { text: "Converting", tone: "running" }, percent: item.percent, locked: true, actions: [{ label: "Cancel", variant: "outline-danger", onClick: () => moveTo(item, "cancelled") }] },
            done: { status: { text: "Done", tone: "success" }, actions: [{ label: "Show in Folder", onClick: says("The file shows in its folder here.") }] },
            failed: { status: { text: "Failed: The file ended early.", tone: "danger" }, actions: [{ label: "Retry", onClick: () => moveTo(item, "ready") }] },
            cancelled: { status: { text: "Cancelled", tone: "muted" }, actions: [{ label: "Retry", onClick: () => moveTo(item, "ready") }] },
        };
        output.disabled = item.state === "running";
        item.removable = !states[item.state].locked;
        card.update({ meta: item.meta, settings: item.settings, rows: item.output ? [output] : [], ...states[item.state] });
    };
    item.draw();
    items.set(card, item);
    return card;
}

/** A transfer, as Dropgate draws one: an upload to a server, or a download from a link. */
function transfer(spec) {
    const upload = spec.icon !== "download";
    const item = { ...spec, upload };
    const select = upload ? routeSelect("Upload to", SERVERS, spec.server) : routeSelect("Save to", FOLDERS, "downloads");
    const link = document.createElement("input");
    link.className = "form-control form-control-sm demo-link";
    link.readOnly = true;
    link.value = spec.link ?? "";
    link.setAttribute("aria-label", "Link");
    const card = window.kit.ui.card({
        icon: spec.icon,
        name: spec.name,
        onConfigure: says("Advanced Options open here."),
        onRemove: () => queue.remove(card),
        route: { label: upload ? "To" : "Save to", control: select },
    });
    item.send = (server) => {
        item.server = server;
        select.value = server;
    };
    item.draw = () => {
        const cancel = { label: "Cancel", variant: "outline-danger", onClick: () => moveTo(item, "cancelled") };
        const files = item.files > 1 ? ` · File ${item.fileAt} of ${item.files}` : "";
        const states = {
            reading: { name: "Reading the link…", status: { text: "Reading the file list…", tone: "running" }, route: false, locked: true },
            ready: { status: { text: "Ready", tone: "ready" }, actions: [{ label: "Upload", variant: "primary", onClick: () => moveTo(item, "running") }] },
            // Locked, but it hasn't started, so it can still be taken off the queue.
            queued: { status: { text: "Queued: Starts when one of the 3 running finishes.", tone: "muted" }, locked: true, canRemove: true, actions: [cancel] },
            running: {
                status: { text: `Uploading ${item.percent}%${files}`, tone: "running" }, percent: item.percent, locked: true,
                actions: [{ label: "Pause", onClick: (button) => moveTo(item, "paused", { button, busyLabel: "Pausing…" }) }, cancel],
            },
            paused: {
                status: { text: "Paused. Kept until 14:32.", tone: "warning" }, percent: item.percent, paused: true, locked: true,
                actions: [{ label: "Resume", onClick: (button) => moveTo(item, "running", { button, busyLabel: "Resuming…" }) }, cancel],
            },
            done: {
                status: { text: "Uploaded · End-to-End Encrypted", tone: "success" }, rows: [link], locked: true,
                actions: [
                    { label: "Copy Link", onClick: () => navigator.clipboard.writeText(link.value).then(says("Copied the link.")) },
                    { label: "Delete", variant: "outline-danger", onClick: (button) => moveTo(item, "deleted", { button, busyLabel: "Deleting…" }) },
                ],
            },
            deleted: { status: { text: "Deleted from the server. Its link no longer works.", tone: "muted" }, locked: true },
            cancelled: { status: { text: "Cancelled", tone: "muted" }, actions: [{ label: "Retry", onClick: () => moveTo(item, "ready") }] },
        };
        const state = states[item.state];
        item.removable = state.canRemove ?? !state.locked;
        card.update({ name: item.name, meta: item.meta, settings: item.settings, ...state });
    };
    item.draw();
    items.set(card, item);
    return card;
}

/** Remove the cards that can go (not one at work), as Remove in the bar and the Delete key do. */
function removeAll(cards) {
    for (const card of cards.filter((c) => items.get(c).removable)) queue.remove(card);
}

/** The Queue: the two shapes side by side, in every tone between them, and the bar over them. */
function fillQueue() {
    queue = window.kit.ui.cardGrid($("queue"), { view: "queue" });
    const waiting = (cards) => cards.filter((card) => items.get(card).upload && items.get(card).state === "ready");
    const target = routeSelect("Upload to", SERVERS, "drop");
    // The bar labels it.
    target.removeAttribute("aria-label");
    target.addEventListener("change", () => {
        const scope = queue.selection.length > 0 ? queue.selection : queue.cards;
        for (const card of waiting(scope)) items.get(card).send(target.value);
    });
    const bar = window.kit.ui.bulkBar(queue, {
        noun: "item",
        target: {
            verb: "Upload",
            control: target,
            note: (scope, { all }) => (waiting(scope).length === 0 ? `No ${all ? "" : "selected "}upload is waiting to start` : ""),
        },
        actions: [
            { label: "Bulk Edit", variant: "primary", selection: true, onClick: says("Advanced Options open here.") },
            { label: "Remove", variant: "outline-danger", selection: true, enabled: (scope) => scope.some((card) => items.get(card).removable), onClick: removeAll },
        ],
    });
    bar.element.classList.add("mb-2");
    $("queue").before(bar.element);
    // Delete is the app's key: it knows which cards can go.
    window.kit.keys.onKey((event) => {
        if (event.key === "Delete" && queue.selection.length > 0) {
            event.preventDefault();
            removeAll(queue.selection);
        }
    }, { view: "queue" });
    for (const card of [
        conversion({ icon: "movie", name: "clip.mp4", from: "MP4", target: "png", meta: "1920×1080 · 2:14 · 48 MB", settings: "Every 2nd Frame", output: "Writes about 2,010 images", state: "ready" }),
        transfer({ icon: "upload_file", name: "site-backup.tar", server: "family", meta: "3.1 GB", state: "paused", percent: 35 }),
        conversion({ icon: "movie", name: "talk.mov", from: "MOV", target: "mp4", meta: "3840×2160 · 41:07 · 6.2 GB", settings: "H.265 · CRF 26", state: "running", percent: 62 }),
        transfer({ icon: "upload_file", name: "quarterly-report.pdf", server: "drop", meta: "2.4 MB", state: "done", link: "https://drop.example.com/f5aa7a2f-c0de" }),
        conversion({ icon: "audio_file", name: "interview.wav", from: "WAV", target: "mp3", meta: "48 kHz · 12:30 · 126 MB", state: "failed" }),
        transfer({ icon: "upload_file", name: "receipts.csv", server: "drop", meta: "22 KB", state: "queued" }),
        transfer({ icon: "upload_file", name: "printer-manual.pdf", server: "nas", meta: "5.2 MB", settings: { text: "Not encrypted: This server is plain HTTP.", tone: "warning" }, state: "ready" }),
        conversion({ icon: "image", name: "poster.png", from: "PNG", target: "webp", meta: "2400×3600 · 8.1 MB", state: "done" }),
        transfer({ icon: "file_copy", name: "38 files", server: "drop", meta: "1.2 GB · IMG_2041.jpg and 37 More", state: "running", percent: 62, files: 38, fileAt: 24 }),
        conversion({ icon: "audio_file", name: "notes.m4a", from: "M4A", target: "mp3", meta: "44.1 kHz · 3:12 · 4.4 MB", state: "cancelled" }),
        transfer({ icon: "download", name: "Link from drop.example.com", meta: "drop.example.com", state: "reading" }),
    ]) queue.add(card);
}

/** The Controls' stepped slider: how many files are worked on at once. */
function fillControls() {
    const { countOf } = window.kit.format;
    const slider = window.kit.ui.stepSlider({
        id: "files-at-once",
        label: "Files at once",
        min: 1,
        max: 6,
        value: 3,
        valueText: (n) => countOf(n, "file"),
        help: (n) => (n === 1 ? "One file at a time. The rest wait their turn." : `Up to ${n} files at once. The rest wait their turn.`),
    });
    $("sample-steps").replaceWith(slider.element);
}

// -- The bottom bar ---------------------------------------------------------------
//
// One item, hidden until a test shows the bar (shell.statusBar.show(true)): how
// the Overview's checks went, with a panel listing each and Check Again.

/** The Overview's checks: each row's name, and the cell its result is in (the theme isn't one). */
const CHECKS = [
    ["Shared Bridge", "kit-api"],
    ["App Bridge", "electron-api"],
    ["Sandboxed", "sandboxed"],
    ["Page Library", "kit-js"],
    ["Kit Styles", "kit-css"],
];

/** A check that failed says so: "Missing", "No", or "Failed: …". */
const FAILED = /^(Missing|No|Failed)\b/;

/** Run the Overview's checks, each into its row. */
function runChecks() {
    return Promise.all([
        show("kit-api", async () => (window.kitAPI ? `App version ${await window.kitAPI.getVersion()}` : "Missing")),
        show("electron-api", async () => (window.electronAPI ? `Electron ${await window.electronAPI.getElectronVersion()}` : "Missing")),
        show("sandboxed", () => (window.electronAPI?.sandboxed ? "Yes" : "No")),
        show("kit-js", () => (window.kit ? "Loaded" : "Missing")),
        // A token only kit.css sets.
        show("kit-css", () => (getComputedStyle(document.documentElement).getPropertyValue("--radius-card").trim() === "8px" ? "Loaded" : "Missing")),
    ]);
}

/** The bar's item and its panel, filled with the demo's own elements. */
function fillStatusBar(shell) {
    const item = shell.statusBar.item("checks");
    const barLine = window.kit.ui.statusLine({ text: "Checking…", tone: "running" });
    const headLine = window.kit.ui.statusLine({ text: "Checking…", tone: "running" });
    headLine.element.classList.add("demo-panel-head");
    item.button.append(barLine.element);

    const facts = document.createElement("dl");
    facts.className = "demo-facts";
    const again = document.createElement("button");
    again.type = "button";
    again.className = "btn btn-sm btn-outline-secondary";
    again.textContent = "Check Again";
    const overview = document.createElement("button");
    overview.type = "button";
    overview.className = "btn btn-sm btn-outline-secondary";
    overview.textContent = "Show Overview";
    const actions = document.createElement("div");
    actions.className = "demo-panel-actions";
    actions.append(again, overview);
    item.panel.append(headLine.element, facts, actions);

    /** Draw the item and its panel from the Overview's rows. */
    function draw() {
        const failed = CHECKS.filter(([, id]) => FAILED.test($(id).textContent)).length;
        const state = failed === 0
            ? { text: "All Checks Passed", tone: "success", title: "Every check on the Overview passed." }
            : { text: failed === 1 ? "1 Check Failed" : `${failed} Checks Failed`, tone: "danger", title: "The Overview says which." };
        barLine.set(state);
        headLine.set(state);
        facts.replaceChildren(...CHECKS.flatMap(([name, id]) => {
            const term = document.createElement("dt");
            term.textContent = name;
            const value = document.createElement("dd");
            // A bridge that's there is "Present": its version changes with each update of the demo's Electron.
            const result = $(id).textContent;
            value.textContent = !FAILED.test(result) && id.endsWith("-api") ? "Present" : result;
            return [term, value];
        }));
    }

    again.addEventListener("click", () => {
        const restore = window.kit.ui.busy(again, "Checking…");
        barLine.set({ text: "Checking…", tone: "running" });
        headLine.set({ text: "Checking…", tone: "running" });
        // A moment, as a real check would take.
        setTimeout(() => runChecks().then(() => {
            restore();
            draw();
        }), 700);
    });
    overview.addEventListener("click", () => {
        item.close();
        shell.showView("overview");
    });
    return draw;
}

// The files the demo is opened with, kept for the tests (it shows none).
window.filesOpened = [];
window.kitAPI?.onFilesOpened((paths) => window.filesOpened.push(paths));

async function init() {
    showTheme();
    fillControls();
    fillQueue();
    const shell = window.kit.ui.mountShell({
        title: "electron-kit Demo",
        sections: [
            { view: "overview", label: "Overview", icon: "dashboard", element: $("overview-view") },
            { view: "controls", label: "Controls", icon: "tune", element: $("controls-view") },
            { view: "queue", label: "Queue", icon: "view_module", element: $("queue-view") },
        ],
        toolbar: $("toolbar"),
        settingsTabs: [{ id: "general", label: "General", render: renderGeneral }],
        credits: { logo: "assets/logo.svg" },
        // What the demo is busy with, asked before Restart Now: never anything, unless a test says so.
        busy: () => window.demoBusy ?? null,
        statusBar: { items: [{ id: "checks", label: "Checks", live: true, panel: { label: "Check Details", width: 360 } }] },
    });
    // For the tests, which show the bar.
    window.demoShell = shell;
    const drawChecks = fillStatusBar(shell);

    await Promise.all([
        shell.ready,
        window.kitAPI.getSettings().then(applySettings),
        runChecks(),
    ]);
    drawChecks();

    $("open-isolated").addEventListener("click", () => window.electronAPI.openIsolatedWindow());
    document.body.dataset.ready = "true";
}

init();
