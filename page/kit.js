"use strict";

// electron-kit's page library, loaded as a classic script from node_modules:
//
//     <script src="../node_modules/@diamonddigitaldev/electron-kit/page/kit.js"></script>
//
// It sets one global, window.kit, and has no import or export, so it works in a
// classic-script page and beside a module page alike (load it first). The
// shared components (kit.ui), the format helpers (kit.format) and the key
// guard (kit.keys) fill these namespaces piece by piece.
//
// kit.ui.mountShell() builds the app's frame around its own sections:
//
//     const shell = kit.ui.mountShell({
//         title:    "Diamond File Converter",
//         sections: [{ view: "convert", label: "Convert", icon: "swap_horiz", element: $("convert-view") }],
//         toolbar:  $("toolbar"),            // the header's controls, shared by every section, hidden on Settings
//         settingsTabs: [{ id: "general", label: "General", render: (pane) => { … } }],
//         credits:  { logo: "assets/logo.png" },
//         onViewChange: (view) => { … },
//         busy:     () => converting ? "A conversion is running." : null,   // asked before Restart Now
//     });
//     await shell.ready;                    // the settings and the Credits tab are loaded
//
// It builds the nav rail (the app's sections, then Settings above Collapse),
// the header, and the Settings view (the app's tabs, then Update, then Credits
// last), moves the app's elements into them, and routes between the views.
// The Update tab and the update dot follow the kit's updater (update:status).
// Restart Now installs a downloaded update at once; when busy() gives a
// reason, the kit asks first, with that reason, in its own prompt.
//
// kit.ui.toast(message, { type, timeout, action }) shows a toast under the
// header; its action shows a list under the message (what was skipped).
// kit.ui.confirm({ title, body, … }) asks a question in a modal, one at a
// time, and resolves with the answer; its batch form takes the answers as
// choices, with Apply to All Remaining.
// kit.ui.progress(), kit.ui.actionBar() and kit.ui.dropZone() are the parts of
// a section that works through a list of files: a bar (null is "not known"),
// the bar under the list with its status line and its one primary action, and
// files dropped from the desktop. kit.ui.card() is one piece of work in a list
// (its name, lines, status dot, bar and buttons), kit.ui.cardGrid() lays a
// list's cards out and selects them, kit.ui.bulkBar() acts on what's selected,
// and kit.ui.busy() shows a button doing what it says. kit.keys.onKey()
// listens for a section's own shortcuts, never while someone types or a modal
// is open; kit.format is the house's wording for counts, sizes and times.
// The shared markup is built with createElement and textContent, never HTML
// strings, and every icon is aria-hidden: an item's name is its label, which a
// collapsed rail hides visually but keeps for screen readers.

(() => {
    if (window.kit) return;

    /** The kit's bridge, from its session preload. A window in another session has none. */
    const bridge = () => window.kitAPI;

    // -- Building --------------------------------------------------------------

    /**
     * An element, with its classes, attributes and text, and its children appended.
     * @param {string} tag
     * @param {{ className?: string, text?: string, attrs?: Record<string, string> }} [props]
     * @param {(Node | string | null | false)[]} [children]
     */
    function el(tag, { className, text, attrs = {} } = {}, children = []) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
        for (const child of children) if (child) node.append(child);
        return node;
    }

    /** A Material Icons Round glyph, hidden from screen readers: the control around it carries the name. */
    const icon = (name, className = "") => el("span", { className: `material-icons-round ${className}`.trim(), text: name, attrs: { "aria-hidden": "true" } });

    /** A link that opens in the person's browser, through the kit's shell:open-external. */
    function externalLink(text, href) {
        const link = el("a", { text, attrs: { href } });
        link.addEventListener("click", (event) => {
            event.preventDefault();
            openExternal(href);
        });
        // A middle click would open the link in a new window of the app.
        link.addEventListener("auxclick", (event) => event.preventDefault());
        return link;
    }

    /** Open a link in the person's browser. A refusal (a link that isn't http(s)) opens nothing. */
    function openExternal(href) {
        bridge()?.openExternal(href).catch(() => {});
    }

    // -- Checking the options --------------------------------------------------

    const VIEW_NAME = /^[a-z][a-z0-9-]*$/;
    const KIT_TABS = ["update", "credits"];

    function checkOptions({ title, sections = [], toolbar, settingsTabs = [], onViewChange, busy }) {
        const fail = (message) => {
            throw new Error(`kit.ui.mountShell(): ${message}`);
        };
        if (typeof title !== "string" || title === "") fail("title must be the app's name.");
        if (!Array.isArray(sections)) fail("sections must be a list.");
        const views = new Set(["settings"]);
        for (const [i, section] of sections.entries()) {
            const { view, label, icon: glyph, element } = section ?? {};
            if (typeof view !== "string" || !VIEW_NAME.test(view)) fail(`sections[${i}].view must be a lowercase name.`);
            if (views.has(view)) fail(`sections[${i}].view "${view}" is taken.`);
            views.add(view);
            if (typeof label !== "string" || label === "") fail(`sections[${i}].label must be its name.`);
            if (typeof glyph !== "string" || glyph === "") fail(`sections[${i}].icon must be a Material Icons Round glyph.`);
            if (!(element instanceof Element)) fail(`sections[${i}].element must be the section's element.`);
        }
        if (toolbar !== undefined && !(toolbar instanceof Element)) fail("toolbar must be an element.");
        if (!Array.isArray(settingsTabs)) fail("settingsTabs must be a list.");
        const tabs = new Set(KIT_TABS);
        for (const [i, tab] of settingsTabs.entries()) {
            const { id, label, render } = tab ?? {};
            if (typeof id !== "string" || !VIEW_NAME.test(id)) fail(`settingsTabs[${i}].id must be a lowercase name.`);
            if (tabs.has(id)) fail(`settingsTabs[${i}].id "${id}" is taken.`);
            tabs.add(id);
            if (typeof label !== "string" || label === "") fail(`settingsTabs[${i}].label must be its name.`);
            if (typeof render !== "function") fail(`settingsTabs[${i}].render must be a function.`);
        }
        if (onViewChange !== undefined && typeof onViewChange !== "function") fail("onViewChange must be a function.");
        if (busy !== undefined && typeof busy !== "function") fail("busy must be a function.");
    }

    // -- The Settings view -----------------------------------------------------

    /**
     * The Settings view: a heading, the tabs (role="tablist", arrow keys, Home
     * and End), and a pane per tab, each keeping its state while hidden. The
     * tabs sit on a thin line, and a thicker accent bar under the selected
     * one slides to the next tab chosen, taking its text's width.
     * @param {{ id: string, label: string, render: (pane: HTMLElement) => void }[]} tabs
     * @param {(id: string) => void} [onSelect] - told each tab selected
     */
    function buildSettings(tabs, onSelect) {
        const view = el("section", { className: "settings-view", attrs: { "aria-labelledby": "settings-title" } });
        const tablist = el("div", { className: "settings-tabs", attrs: { role: "tablist", "aria-labelledby": "settings-title" } });
        const indicator = el("span", { className: "settings-tab-indicator", attrs: { "aria-hidden": "true" } });
        const panes = el("div", { className: "tab-content settings-panes" });
        view.append(el("h2", { className: "settings-title", text: "Settings", attrs: { id: "settings-title" } }), tablist, panes);

        const buttons = tabs.map(({ id, label }) => {
            const button = el("button", {
                className: "settings-tab",
                text: label,
                attrs: { type: "button", role: "tab", id: `settings-tab-${id}`, "aria-controls": `settings-pane-${id}`, "data-tab": id },
            });
            tablist.append(button);
            return button;
        });
        tablist.append(indicator);

        /**
         * Put the bar under the selected tab, at its text's width. Animated
         * when the selection moves; at once when the tabs are first laid out,
         * or change size (the view shown, the fonts loaded).
         */
        function placeIndicator({ animate }) {
            const button = buttons.find((b) => b.getAttribute("aria-selected") === "true");
            if (!button || !button.offsetWidth) return;
            tablist.classList.toggle("settings-tabs-instant", !animate);
            indicator.style.setProperty("--indicator-x", `${button.offsetLeft}px`);
            indicator.style.setProperty("--indicator-width", `${button.offsetWidth}px`);
            if (!animate) {
                // Let the jump land, then allow the next move to animate.
                indicator.getBoundingClientRect();
                requestAnimationFrame(() => tablist.classList.remove("settings-tabs-instant"));
            }
        }
        new ResizeObserver(() => placeIndicator({ animate: false })).observe(tablist);
        const paneOf = new Map(tabs.map(({ id }) => {
            const pane = el("div", { className: "tab-pane", attrs: { role: "tabpanel", id: `settings-pane-${id}`, "aria-labelledby": `settings-tab-${id}`, tabindex: "0" } });
            panes.append(pane);
            return [id, pane];
        }));

        /** Show a tab and its pane. Only the selected tab is in the Tab order; the arrow keys move between them. */
        function select(id, { focus = false, quiet = false } = {}) {
            const index = tabs.findIndex((tab) => tab.id === id);
            if (index === -1) return;
            buttons.forEach((button, i) => {
                const selected = i === index;
                button.setAttribute("aria-selected", String(selected));
                button.tabIndex = selected ? 0 : -1;
                paneOf.get(tabs[i].id).classList.toggle("active", selected);
                paneOf.get(tabs[i].id).classList.toggle("show", selected);
            });
            placeIndicator({ animate: true });
            if (focus) buttons[index].focus();
            if (!quiet) onSelect?.(id);
        }

        tablist.addEventListener("click", (event) => {
            const button = event.target.closest("[role=tab]");
            if (button) select(button.dataset.tab);
        });
        tablist.addEventListener("keydown", (event) => {
            const at = buttons.indexOf(document.activeElement);
            if (at === -1) return;
            const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: buttons.length - 1 }[event.key];
            if (next === undefined) return;
            event.preventDefault();
            select(tabs[(next + buttons.length) % buttons.length].id, { focus: true });
        });

        // Quiet: the view is still being built.
        select(tabs[0].id, { quiet: true });
        return { view, select, pane: (id) => paneOf.get(id), tab: (id) => buttons[tabs.findIndex((tab) => tab.id === id)], selected: () => tabs[buttons.findIndex((b) => b.getAttribute("aria-selected") === "true")].id };
    }

    // -- The Update tab ----------------------------------------------------------

    /** The update channels, as the Update tab offers them, with the help line for each. */
    const UPDATE_CHANNELS = [
        { value: "stable", label: "Stable", help: "Finished releases only." },
        { value: "beta", label: "Beta", help: "Beta and stable releases. Test new features early, issues are expected." },
        { value: "alpha", label: "Alpha", help: "Alpha, beta, and stable releases. Unfinished features and many bugs, not recommended for most users." },
    ];

    /** What a failed check says, for each of the updater's reasons (checkFailureOf() in main/updater.js). */
    const CHECK_FAILURES = {
        offline: "Couldn't check for updates. You seem to be offline.",
        "no-files": "Couldn't check for updates. The newest release has no update files yet.",
        other: "Couldn't check for updates. Try again later.",
    };

    /**
     * The page of the release an update comes from, on GitHub (where every
     * app on the kit is published): the app's repository, and the release's
     * tag (or its version, if the server gave no tag). Elsewhere, null.
     * @param {string | null} repository - app:get-info's, an https URL
     * @param {{ version: string | null, tag?: string | null }} status
     */
    function releasePage(repository, { version, tag }) {
        if (!repository || !version) return null;
        try {
            const url = new URL(repository);
            if (url.hostname !== "github.com") return null;
            return `${url.origin}${url.pathname.replace(/\/+$/, "")}/releases/tag/${encodeURIComponent(tag ?? version)}`;
        } catch {
            return null;
        }
    }

    /** The least time "Checking for updates…" shows, so a check that fails at once still looks pressed. */
    const CHECK_SHOWN_FOR = 1000;

    /**
     * What the Update tab's status line says for the updater's state
     * (main/updater.js), and its tone: a failed check is a warning (it's
     * passing, and says why), a failed download is a danger.
     * @param {{ state: string, reason: string | null, error: string | null, version: string | null, percent: number | null }} status
     * @param {string} appName
     * @returns {{ text: string, percent?: string, tone?: "warning" | "danger", release?: { text: string, rest: string } }}
     */
    function updateMessage({ state, reason, error, version, percent }, appName) {
        switch (state) {
            case "idle":
                return { text: "Updates haven't been checked yet." };
            case "unavailable":
                return { text: reason === "not-packaged" ? "Updates are checked in the installed app." : `${appName} doesn't update itself.` };
            case "checking":
                return { text: "Checking for updates…" };
            case "none":
                return { text: "You're up to date." };
            case "available":
                // "Version x" links to the release's page, where there is one (releasePage()).
                return { text: `Version ${version} is available.`, release: { text: `Version ${version}`, rest: " is available." } };
            case "downloading":
                return { text: `Downloading version ${version}…`, percent: ` ${percent ?? 0}%` };
            case "downloaded":
                return { text: `Version ${version} has downloaded and will be installed when you close ${appName}.` };
            case "error":
                return error === "download"
                    ? { text: `Version ${version} couldn't be downloaded.`, tone: "danger" }
                    : { text: CHECK_FAILURES[reason] ?? CHECK_FAILURES.other, tone: "warning" };
            default:
                return { text: "" };
        }
    }

    /**
     * The Update tab: two cards. The first, under the version running, says
     * where the updates stand (a live region, its height kept, so nothing
     * jumps), with the download's bar under it while one runs, then Check for
     * Updates and, when there's one to download, Download Update. Once an
     * update has downloaded, Restart Now takes Check for Updates' place: it
     * installs the update now, after asking when the app says it's busy
     * (mountShell's busy). The second holds the preferences: the automatic
     * downloads switch, whose help says what each way does, and the update
     * channel. Each change is kept as it's made, and the kit's main process
     * acts on it (a new channel checks again).
     * @param {HTMLElement} pane
     * @param {() => (string | null | Promise<string | null>)} [busy] - what the app is busy with, or null
     * @returns {{ showInfo(info: object): void, showSettings(settings: object): void, showStatus(status: object, appName: string): boolean }}
     */
    function buildUpdate(pane, busy) {
        const version = el("h3", { className: "update-version", attrs: { id: "update-version" } });
        const check = el("button", { className: "btn btn-secondary", text: "Check for Updates", attrs: { type: "button", id: "update-check" } });
        const statusText = el("span");
        // The percent is seen, not read out: a screen reader would announce every step of it.
        const statusPercent = el("span", { attrs: { "aria-hidden": "true" } });
        const status = el("p", { className: "update-status", attrs: { id: "update-status", role: "status" } }, [statusText, statusPercent]);
        const download = el("button", { className: "btn btn-primary update-download", text: "Download Update", attrs: { type: "button", id: "update-download", hidden: "" } });
        const restart = el("button", { className: "btn btn-primary update-restart", text: "Restart Now", attrs: { type: "button", id: "update-restart", hidden: "" } });
        // Only while a download runs, and gone the moment it ends: never a fade, never a bar left at 100%.
        const bar = progress({ label: "Download progress" });
        bar.element.classList.add("update-progress");
        bar.element.hidden = true;

        const auto = el("input", { className: "form-check-input", attrs: { type: "checkbox", role: "switch", id: "update-auto", "aria-describedby": "update-auto-help" } });
        const autoHelp = el("div", { className: "form-text", attrs: { id: "update-auto-help" } });
        let appName = "";
        let repository = null;
        const showAutoHelp = () => {
            autoHelp.textContent = auto.checked
                ? `Updates download by themselves and are installed when you close ${appName}.`
                : "Updates are checked but not downloaded automatically. You'll be notified when one is available.";
        };
        const channel = el("select", { className: "form-select update-channel", attrs: { id: "update-channel", "aria-describedby": "update-channel-help" } },
            UPDATE_CHANNELS.map(({ value, label }) => el("option", { text: label, attrs: { value } })));
        const channelHelp = el("div", { className: "form-text", attrs: { id: "update-channel-help" } });
        const showChannelHelp = () => {
            channelHelp.textContent = UPDATE_CHANNELS.find((c) => c.value === channel.value)?.help ?? "";
        };
        showChannelHelp();

        const card = (labelledBy, children) => el("section", { className: "card update-card", attrs: { "aria-labelledby": labelledBy } }, [el("div", { className: "card-body" }, children)]);
        pane.replaceChildren(el("div", { className: "update-tab" }, [
            card("update-version", [
                version,
                status,
                bar.element,
                el("div", { className: "update-actions" }, [check, restart, download]),
            ]),
            card("update-preferences", [
                el("h3", { className: "update-card-title", text: "Preferences", attrs: { id: "update-preferences" } }),
                el("div", { className: "update-row" }, [
                    el("div", { className: "form-check form-switch mb-0" }, [auto, el("label", { className: "form-check-label", text: "Download updates automatically", attrs: { for: "update-auto" } })]),
                    autoHelp,
                ]),
                el("div", { className: "update-row" }, [
                    el("label", { className: "form-label", text: "Update channel", attrs: { for: "update-channel" } }),
                    channel,
                    channelHelp,
                ]),
            ]),
        ]));

        const api = bridge();
        check.addEventListener("click", () => api?.checkForUpdates().catch(() => {}));
        download.addEventListener("click", () => api?.downloadUpdate().catch(() => {}));
        restart.addEventListener("click", async () => {
            restart.disabled = true;
            try {
                const reason = busy ? await busy() : null;
                const go = typeof reason !== "string" || reason === "" || await confirm({
                    title: "Restart Now?",
                    body: reason,
                    detail: `${appName} will close to install the update, and open again.`,
                    confirmLabel: "Restart Now",
                    variant: "warning",
                    icon: "restart_alt",
                });
                if (go) await api?.installUpdate();
            } catch {
                // The update still installs when the app closes.
            } finally {
                restart.disabled = false;
            }
        });
        auto.addEventListener("change", () => {
            showAutoHelp();
            api?.setSettings({ autoDownloadUpdates: auto.checked }).catch(() => {});
        });
        channel.addEventListener("change", () => {
            showChannelHelp();
            api?.setSettings({ updateChannel: channel.value }).catch(() => {});
        });

        return {
            showInfo(info) {
                appName = info.name;
                repository = info.repository ?? null;
                version.textContent = `Version ${info.version}`;
                showAutoHelp();
            },
            showSettings(settings) {
                auto.checked = settings.autoDownloadUpdates === true;
                showAutoHelp();
                if (UPDATE_CHANNELS.some((c) => c.value === settings.updateChannel)) channel.value = settings.updateChannel;
                showChannelHelp();
            },
            /** Show the updater's state; returns whether the update dot shows. */
            showStatus(next, appName) {
                const message = updateMessage(next, appName);
                const page = message.release && releasePage(repository, next);
                if (page) statusText.replaceChildren(externalLink(message.release.text, page), message.release.rest);
                else statusText.textContent = message.text;
                statusPercent.textContent = message.percent ?? "";
                // Bootstrap's emphasis shades, which hold AA on the page in both themes (its plain ones don't on dark).
                status.classList.toggle("text-warning-emphasis", message.tone === "warning");
                status.classList.toggle("text-danger-emphasis", message.tone === "danger");
                // A check can run unless there's no updater, one is running, or an update is downloading.
                check.disabled = ["unavailable", "checking", "downloading"].includes(next.state);
                // Once it has downloaded, Restart Now takes Check for Updates' place, and the focus with it.
                const downloaded = next.state === "downloaded";
                const moveFocus = downloaded && document.activeElement === check;
                check.hidden = downloaded;
                restart.hidden = !downloaded;
                if (moveFocus) restart.focus();
                download.hidden = !(next.state === "available" || (next.state === "error" && next.error === "download"));
                // Hidden at 0, so the next download's bar starts empty rather than shrinking from the last.
                const downloading = next.state === "downloading";
                bar.set(downloading ? next.percent ?? 0 : 0);
                bar.element.hidden = !downloading;
                // With no updater at all, its settings do nothing.
                const off = next.state === "unavailable" && next.reason === "off";
                auto.disabled = off;
                channel.disabled = off;
                return next.dot === true;
            },
        };
    }

    /**
     * The update dot, on an element: hidden unless an update is waiting, with
     * a text alternative, "Update available", that becomes part of the
     * element's name while it shows.
     * @param {HTMLElement} host
     * @returns {(shown: boolean) => void}
     */
    function updateDot(host) {
        const dot = el("span", { className: "update-dot", attrs: { "aria-hidden": "true", hidden: "" } });
        // Empty while there's no dot, so it's in no one's text: a tab's, or an item's tooltip.
        const said = el("span", { className: "visually-hidden" });
        host.append(dot, said);
        return (shown) => {
            dot.hidden = !shown;
            said.textContent = shown ? "Update available" : "";
        };
    }

    // -- Toasts ------------------------------------------------------------------

    /** Each toast type's glyph. */
    const TOAST_ICONS = { info: "info", success: "check_circle", warning: "warning", danger: "error" };

    /** The toast host: the page's own #toast-host if it has one, else made the first time a toast shows, a polite live region. */
    function toastHost() {
        return document.getElementById("toast-host")
            ?? document.body.appendChild(el("div", { className: "toast-host", attrs: { id: "toast-host", "aria-live": "polite" } }));
    }

    /** The most rows a toast's detail list shows; a last row says how many more there are. */
    const TOAST_DETAIL_LIMIT = 50;

    /** A number for each toast's detail list, so its button can name it. */
    let toastDetails = 0;

    /**
     * A toast's action: a button beside the message that shows a list under
     * it (the files skipped, and why), and hides it again. The list is built
     * only when the button is first pressed, from action.items(), and holds
     * the first TOAST_DETAIL_LIMIT rows. Each row is text, or a name (in bold,
     * and the one thing in it that can be selected and copied) and a note.
     * The list is left out of the host's live region: the button says it's
     * open, and a screen reader reads it when it's reached.
     * @param {HTMLElement} body - The toast's message, which the button and the list go in.
     * @param {{ label: string, items: () => (string | { name: string, note?: string })[] }} action
     */
    function toastAction(body, { label, items }) {
        const id = `toast-detail-${++toastDetails}`;
        const button = el("button", { className: "toast-action", text: label, attrs: { type: "button", "aria-expanded": "false", "aria-controls": id } });
        let list = null;
        button.addEventListener("click", () => {
            if (!list) {
                const rows = items();
                if (!Array.isArray(rows)) throw new Error("kit.ui.toast(): action.items() must return a list.");
                list = el("ul", { className: "toast-detail", attrs: { id, "aria-label": label, "aria-live": "off", tabindex: "0", hidden: "" } }, rows.slice(0, TOAST_DETAIL_LIMIT).map((row) => (
                    typeof row === "string"
                        ? el("li", { text: row })
                        : el("li", {}, [el("span", { className: "toast-detail-name", text: String(row.name) }), row.note ? ` — ${row.note}` : null])
                )));
                if (rows.length > TOAST_DETAIL_LIMIT) list.append(el("li", { className: "toast-detail-more", text: `and ${rows.length - TOAST_DETAIL_LIMIT} more` }));
                body.append(list);
            }
            const open = list.hidden;
            list.hidden = !open;
            button.setAttribute("aria-expanded", String(open));
            button.textContent = open ? "Hide" : label;
        });
        body.append(" ", button);
    }

    /**
     * Show a toast: something the person should know, but not answer. It
     * closes itself after --timing-toast (4.5 s), or when its close button is
     * pressed. A danger toast is announced at once (role="alert"); the rest
     * politely, through the host's live region. The message is text, never
     * markup. With an action (toastAction above), it stays until it's closed,
     * unless a timeout is given: an action no one can reach in time isn't one.
     * @param {string} message
     * @param {{ type?: "info" | "success" | "warning" | "danger", timeout?: number, action?: { label: string, items: () => (string | { name: string, note?: string })[] } }} [options]
     *   timeout: how long it stays, in ms; 0 keeps it until it's closed.
     * @returns {{ element: HTMLElement, close(): void }}
     */
    function toast(message, { type = "info", timeout, action } = {}) {
        if (typeof message !== "string" || message === "") throw new Error("kit.ui.toast(): the message must be text.");
        if (!Object.hasOwn(TOAST_ICONS, type)) throw new Error(`kit.ui.toast(): type must be one of ${Object.keys(TOAST_ICONS).join(", ")}.`);
        if (timeout !== undefined && !(Number.isFinite(timeout) && timeout >= 0)) throw new Error("kit.ui.toast(): timeout must be a number of ms, or 0.");
        if (action !== undefined && !(typeof action?.label === "string" && action.label !== "" && typeof action.items === "function")) {
            throw new Error("kit.ui.toast(): action must be { label, items }, items a function returning the list.");
        }
        const stay = timeout ?? (action ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--timing-toast")) || 4500);

        const close = el("button", { className: "toast-close", attrs: { type: "button", title: "Dismiss", "aria-label": "Dismiss" } }, [icon("close")]);
        const body = el("div", { className: "toast-body", text: message });
        if (action) toastAction(body, action);
        const note = el("div", { className: `toast-note toast-${type}`, attrs: type === "danger" ? { role: "alert" } : {} }, [
            icon(TOAST_ICONS[type], "toast-icon"),
            body,
            close,
        ]);
        toastHost().append(note);

        let timer = null;
        let closed = false;
        function dismiss() {
            if (closed) return;
            closed = true;
            clearTimeout(timer);
            note.classList.add("leaving");
            const gone = () => note.remove();
            note.addEventListener("transitionend", gone, { once: true });
            // In case nothing transitions (reduced motion, a hidden page).
            setTimeout(gone, 1000);
        }
        close.addEventListener("click", dismiss);
        if (stay > 0) timer = setTimeout(dismiss, stay);
        return { element: note, close: dismiss };
    }

    // -- Confirm -----------------------------------------------------------------

    /** The variants a prompt's button may take: Bootstrap's, as DESIGN §6 uses them. */
    const BUTTON_VARIANTS = ["primary", "secondary", "success", "warning", "danger", "outline-secondary", "outline-danger"];

    /** The prompt showing now, or last shown, so the next waits for it: one prompt at a time. */
    let prompts = Promise.resolve();

    /** The prompt's dialog, built the first time one is asked, and filled for each. */
    let dialogParts = null;

    function confirmDialog() {
        if (dialogParts) return dialogParts;
        const glyph = icon("help_outline", "kit-dialog-icon");
        const title = el("span", { attrs: { id: "kit-dialog-title" } });
        const closeButton = el("button", { className: "btn-close", attrs: { type: "button", "aria-label": "Close" } });
        const body = el("p", { className: "kit-dialog-text", attrs: { id: "kit-dialog-body" } });
        const detail = el("p", { className: "kit-dialog-detail", attrs: { id: "kit-dialog-detail" } });
        const all = el("input", { className: "form-check-input", attrs: { type: "checkbox", id: "kit-dialog-all" } });
        const allLabel = el("label", { className: "form-check-label", attrs: { for: "kit-dialog-all" } });
        const allRow = el("div", { className: "form-check kit-dialog-all" }, [all, allLabel]);
        const footer = el("div", { className: "kit-dialog-footer" });
        const dialog = el("dialog", { className: "kit-dialog", attrs: { role: "alertdialog", "aria-modal": "true", "aria-labelledby": "kit-dialog-title", "aria-describedby": "kit-dialog-body kit-dialog-detail" } }, [
            el("div", { className: "kit-dialog-header" }, [el("h2", { className: "kit-dialog-title" }, [glyph, title]), closeButton]),
            el("div", { className: "kit-dialog-body" }, [body, detail, allRow]),
            footer,
        ]);
        document.body.append(dialog);
        dialogParts = { dialog, glyph, title, closeButton, body, detail, all, allLabel, allRow, footer };
        return dialogParts;
    }

    /**
     * Check a prompt's options, and put them in one shape: its buttons, left to
     * right, the answer each gives, the button that takes the focus, and the
     * answer every other way out gives (Escape, the backdrop, the close button).
     */
    function promptOf(options) {
        const fail = (message) => {
            throw new Error(`kit.ui.confirm(): ${message}`);
        };
        const { title, body, detail = null, icon: glyph = "help_outline", choices, applyToAll } = options ?? {};
        if (typeof title !== "string" || title === "") fail("title must be the question, in Title Case.");
        if (typeof body !== "string" || body === "") fail("body must be text.");
        if (detail !== null && (typeof detail !== "string" || detail === "")) fail("detail must be text, or left out.");
        if (typeof glyph !== "string" || glyph === "") fail("icon must be a Material Icons Round glyph.");
        const variant = (value, where) => {
            if (!BUTTON_VARIANTS.includes(value)) fail(`${where} must be one of ${BUTTON_VARIANTS.join(", ")}.`);
            return value;
        };

        if (choices === undefined) {
            if (applyToAll !== undefined || options.cancel !== undefined || options.defaultChoice !== undefined) fail("applyToAll, cancel and defaultChoice go with choices.");
            const { confirmLabel = "Confirm", cancelLabel = "Cancel", variant: confirmVariant = "primary" } = options;
            if (typeof confirmLabel !== "string" || confirmLabel === "") fail("confirmLabel must be text.");
            if (typeof cancelLabel !== "string" || cancelLabel === "") fail("cancelLabel must be text.");
            variant(confirmVariant, "variant");
            // Something risky or destructive is confirmed on purpose: the focus starts on Cancel.
            const risky = ["warning", "danger"].includes(confirmVariant);
            return {
                title, body, detail, glyph, batch: false, applyToAll: null,
                // The glyph takes a warning's or a danger's colour, as Dropgate's Upload Security Warning does.
                tone: risky ? confirmVariant : null,
                buttons: [{ value: false, label: cancelLabel, variant: "secondary" }, { value: true, label: confirmLabel, variant: confirmVariant }],
                cancel: false,
                focus: risky ? false : true,
            };
        }

        if (!Array.isArray(choices) || choices.length < 2) fail("choices must be a list of two or more.");
        const values = new Set();
        const buttons = choices.map((choice, i) => {
            const { value, label } = choice ?? {};
            if (typeof value !== "string" || value === "") fail(`choices[${i}].value must be a name for the answer.`);
            if (values.has(value)) fail(`choices[${i}].value "${value}" is taken.`);
            values.add(value);
            if (typeof label !== "string" || label === "") fail(`choices[${i}].label must be text.`);
            return { value, label, variant: variant(choice.variant ?? (value === options.defaultChoice ? "primary" : "secondary"), `choices[${i}].variant`) };
        });
        const { cancel = buttons[0].value, defaultChoice = buttons[buttons.length - 1].value } = options;
        if (!values.has(cancel)) fail(`cancel "${cancel}" isn't one of the choices.`);
        if (!values.has(defaultChoice)) fail(`defaultChoice "${defaultChoice}" isn't one of the choices.`);
        if (applyToAll !== undefined && applyToAll !== false && !(applyToAll === true || (typeof applyToAll === "string" && applyToAll !== ""))) {
            fail("applyToAll must be true, or the checkbox's label.");
        }
        return {
            title, body, detail, glyph, tone: null, batch: true, buttons, cancel, focus: defaultChoice,
            applyToAll: applyToAll === true ? "Apply to All Remaining" : applyToAll || null,
        };
    }

    /**
     * Show one prompt, and resolve with its answer once it's closed.
     * @param {ReturnType<typeof promptOf>} prompt
     */
    function ask(prompt) {
        const parts = confirmDialog();
        const { dialog, glyph, title, closeButton, body, detail, all, allLabel, allRow, footer } = parts;
        glyph.textContent = prompt.glyph;
        glyph.className = `material-icons-round kit-dialog-icon${prompt.tone ? ` text-${prompt.tone}` : ""}`;
        title.textContent = prompt.title;
        body.textContent = prompt.body;
        detail.textContent = prompt.detail ?? "";
        detail.hidden = !prompt.detail;
        allRow.hidden = !prompt.applyToAll;
        allLabel.textContent = prompt.applyToAll ?? "";
        all.checked = false;
        delete all.dataset.kitTick;
        const buttons = prompt.buttons.map(({ value, label, variant }) => {
            const button = el("button", { className: `btn btn-${variant}`, text: label, attrs: { type: "button" } });
            button.addEventListener("click", () => answer(value));
            return [value, button];
        });
        footer.replaceChildren(...buttons.map(([, button]) => button));

        let answered = null;
        let fallback = null;
        let done;
        const closed = new Promise((resolve) => {
            done = resolve;
        });

        /** Answer, and close: faded out, then closed (closing is what resolves the prompt). */
        function answer(value) {
            if (answered !== null || !dialog.open) return;
            answered = { value };
            dialog.classList.add("leaving");
            const shut = () => {
                dialog.removeEventListener("transitionend", faded);
                if (dialog.open) dialog.close();
            };
            // The dialog's own fade, not a button's hover colour ending inside it.
            const faded = (event) => {
                if (event.target === dialog && event.propertyName === "opacity") shut();
            };
            dialog.addEventListener("transitionend", faded);
            // In case nothing transitions (reduced motion, a hidden page).
            fallback = setTimeout(shut, 1000);
        }
        const onCancel = (event) => {
            // Escape: faded out like any other answer. Pressed again before it's gone, Chromium
            // may close the dialog itself, which onClose answers the same way.
            event.preventDefault();
            answer(prompt.cancel);
        };
        const onBackdrop = (event) => {
            if (event.target !== dialog) return;
            const box = dialog.getBoundingClientRect();
            const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
            if (!inside) answer(prompt.cancel);
        };
        const onCloseButton = () => answer(prompt.cancel);
        function onClose() {
            // Not left to close the next prompt, which may open in this one's place at once.
            clearTimeout(fallback);
            dialog.removeEventListener("cancel", onCancel);
            dialog.removeEventListener("click", onBackdrop);
            dialog.removeEventListener("close", onClose);
            closeButton.removeEventListener("click", onCloseButton);
            dialog.classList.remove("leaving");
            const value = answered ? answered.value : prompt.cancel;
            done(prompt.batch ? { choice: value, all: all.checked } : value);
        }
        dialog.addEventListener("cancel", onCancel);
        dialog.addEventListener("click", onBackdrop);
        dialog.addEventListener("close", onClose);
        closeButton.addEventListener("click", onCloseButton);

        // A modal <dialog> gives the focus back to what had it once it closes, by itself.
        dialog.showModal();
        buttons.find(([value]) => value === prompt.focus)[1].focus();
        return closed;
    }

    /**
     * Ask a question only the person can answer, in a modal over the page,
     * and resolve with the answer. Prompts are asked one at a time: one asked
     * while another shows waits until that's answered.
     *
     *     if (!await kit.ui.confirm({ title: "Large Frame Export", body: "This writes about 4,000 images.",
     *                                 detail: "Narrow the range if that's more than you meant.",
     *                                 confirmLabel: "Write Them", variant: "warning", icon: "burst_mode" })) return;
     *
     * resolves true on the confirm button, and false every other way out:
     * Cancel, Escape, the backdrop, the close button. The focus starts on the
     * confirm button, or on Cancel when the variant is warning or danger, when
     * the glyph takes the variant's colour too. It's drawn as Dropgate's Upload
     * Security Warning is: the body in the page's text, a detail under it in
     * small grey text, Cancel a filled grey button.
     *
     * The batch form, for a question asked of each item in a batch, takes the
     * answers as choices, left to right, and an Apply to All Remaining checkbox:
     *
     *     const { choice, all } = await kit.ui.confirm({
     *         title: "File Already Exists", body: "clip.mp4 already exists.",
     *         choices: [{ value: "cancelAll", label: "Cancel All" }, { value: "skip", label: "Skip This File" },
     *                   { value: "overwrite", label: "Overwrite" }, { value: "unique", label: "Save as New" }],
     *         cancel: "cancelAll", defaultChoice: "unique", applyToAll: true,
     *     });
     *
     * It resolves { choice, all }: the choice's value, and whether the box was
     * ticked. cancel is the answer every other way out gives (the first choice
     * if not given); defaultChoice takes the focus, in btn-primary (the last
     * choice if not given). Each choice is btn-secondary unless it names its
     * variant. Everything is text, never markup.
     * @returns {Promise<boolean | { choice: string, all: boolean }>}
     */
    function confirm(options) {
        const prompt = promptOf(options);
        const answer = prompts.then(() => ask(prompt));
        prompts = answer.then(() => {}, () => {});
        return answer;
    }

    /** The Credits tab, from app:get-info: the logo, name and version, the credit lines, then donating and the source. */
    function fillCredits(pane, { name, version, repository, credits }, logo) {
        const heading = el("div", { className: "credits-heading" }, [
            logo ? el("img", { className: "credits-logo", attrs: { src: logo, alt: "" } }) : null,
            el("h3", { className: "credits-name", text: `${name} v${version}` }),
        ]);
        const line = (parts) => el("p", {}, ["• ", ...parts.map((part) => (typeof part === "string" ? part : externalLink(part.text, part.href)))]);
        const button = (text, href) => {
            const b = el("button", { className: "btn credits-btn", text, attrs: { type: "button" } });
            b.addEventListener("click", () => openExternal(href));
            return b;
        };
        const host = (href) => new URL(href).hostname.replace(/^www\./, "");

        pane.replaceChildren(el("div", { className: "credits" }, [
            heading,
            ...credits.lines.map(line),
            (credits.donate || repository) && el("hr"),
            credits.donate && line(["If you enjoy this software, consider donating to support development!"]),
            credits.donate && button(["buymeacoff.ee", "buymeacoffee.com"].includes(host(credits.donate)) ? "Donate on Buy Me a Coffee" : "Donate", credits.donate),
            repository && button(host(repository) === "github.com" ? "View Source Code on GitHub" : "View Source Code", repository),
        ]));
    }

    // -- The shell -------------------------------------------------------------

    /**
     * Build the app's frame around its sections: the nav rail, the header and
     * the Settings view. See the top of this file.
     * @returns {{ showView(view: string): void, showSettings(tab?: string, options?: { focus?: boolean }): void, ready: Promise<void> }}
     */
    function mountShell(options) {
        checkOptions(options);
        const { title, sections = [], toolbar, settingsTabs = [], credits = {}, onViewChange, busy } = options;
        if (document.querySelector(".app-frame")) throw new Error("kit.ui.mountShell() was called twice.");

        // The rail: the app's sections, then Settings, then Collapse.
        const rail = el("nav", { className: "nav-rail", attrs: { id: "nav-rail", "aria-label": "Sections" } });
        const railItem = (view, label, glyph, extra = "") => el("button", {
            className: `nav-item ${extra}`.trim(),
            attrs: { type: "button", "data-view": view },
        }, [icon(glyph, "nav-icon"), el("span", { className: "nav-label", text: label })]);
        const settingsItem = railItem("settings", "Settings", "settings", "nav-settings");
        const items = [
            ...sections.map(({ view, label, icon: glyph }) => railItem(view, label, glyph)),
            settingsItem,
        ];
        const collapseLabel = el("span", { className: "nav-label", text: "Collapse" });
        const collapse = el("button", {
            className: "nav-collapse",
            attrs: { type: "button", "aria-expanded": "true", "aria-controls": "nav-rail" },
        }, [icon("chevron_left", "nav-icon"), collapseLabel]);
        rail.append(...items, collapse);

        // The column: the header, then each view.
        const settings = buildSettings([
            ...settingsTabs.map(({ id, label }) => ({ id, label })),
            { id: "update", label: "Update" },
            { id: "credits", label: "Credits" },
        ], () => checkIfSeen());
        const views = new Map([...sections.map(({ view, element }) => [view, element]), ["settings", settings.view]]);
        // The toolbar is for the app's sections: hidden on Settings (kit.css).
        toolbar?.classList.add("app-toolbar");
        const shell = el("div", { className: "app-shell" }, [
            el("header", { className: "app-header" }, [el("h1", { className: "app-title", text: title }), toolbar]),
            el("main", { className: "app-content" }, [...views.values()]),
        ]);
        for (const [view, element] of views) {
            element.classList.add("kit-view");
            element.dataset.view = view;
        }
        document.body.prepend(el("div", { className: "app-frame" }, [rail, shell]));

        for (const { id, render } of settingsTabs) render(settings.pane(id));

        // Settings > Update, and the update dot on the rail's Settings and on the Update tab.
        let appName = title;
        const update = buildUpdate(settings.pane("update"), busy);
        const dots = [updateDot(settingsItem), updateDot(settings.tab("update"))];
        let toasted = null;
        // "Checking for updates…" shows for CHECK_SHOWN_FOR at least: what comes sooner waits for it (the latest only).
        let checkingSince = 0;
        let held = null;
        let latest = null;
        function showUpdate(status, { pushed = false } = {}) {
            clearTimeout(held);
            latest = status;
            checkIfSeen();
            if (status.state === "checking") {
                checkingSince = Date.now();
            } else if (checkingSince) {
                const wait = checkingSince + CHECK_SHOWN_FOR - Date.now();
                if (wait > 0) {
                    held = setTimeout(() => showUpdate(status, { pushed }), wait);
                    return;
                }
                checkingSince = 0;
            }
            const dot = update.showStatus(status, appName);
            for (const show of dots) show(dot);
            // One toast, when an update downloads by itself while the app is open.
            if (pushed && status.state === "downloaded" && status.auto && toasted !== status.version) {
                toasted = status.version;
                toast(`Version ${status.version} has downloaded and will be installed when you close ${appName}.`);
            }
        }

        /**
         * Settings > Update on screen while the launch check waits: it runs
         * now, so the tab says where the updates stand rather than that
         * they haven't been checked. The window is up to show what it finds.
         */
        function checkIfSeen() {
            if (latest?.state === "idle" && latest.pending && current === "settings" && settings.selected() === "update") {
                latest = { ...latest, pending: false };
                bridge()?.checkForUpdates().catch(() => {});
            }
        }

        // Routing: one route between views, from the rail, the menu, or the app.
        let current = null;
        function showView(view) {
            if (!views.has(view) || view === current) return;
            current = view;
            shell.dataset.view = view;
            for (const item of items) {
                const active = item.dataset.view === view;
                item.classList.toggle("active", active);
                if (active) item.setAttribute("aria-current", "page");
                else item.removeAttribute("aria-current");
            }
            for (const [name, element] of views) element.classList.toggle("kit-view-hidden", name !== view);
            checkIfSeen();
            onViewChange?.(view);
        }

        /** Show Settings, at a tab if given; with focus, the selected tab takes it, for someone arriving by keyboard. */
        function showSettings(tab, { focus = false } = {}) {
            showView("settings");
            if (tab) settings.select(tab);
            if (focus) settings.select(settings.selected(), { focus: true });
        }

        for (const item of items) item.addEventListener("click", () => showView(item.dataset.view));
        showView(sections[0]?.view ?? "settings");
        bridge()?.onShowView(({ view, tab } = {}) => {
            if (view === "settings") showSettings(tab, { focus: true });
            else showView(view);
        });

        // Collapse: the labels hide visually, but stay each item's name; each item gets its label as a tooltip.
        function setCollapsed(collapsed) {
            rail.classList.toggle("collapsed", collapsed);
            collapse.setAttribute("aria-expanded", String(!collapsed));
            collapseLabel.textContent = collapsed ? "Expand" : "Collapse";
            for (const button of [...items, collapse]) {
                if (collapsed) button.title = button.querySelector(".nav-label").textContent;
                else button.removeAttribute("title");
            }
        }
        collapse.addEventListener("click", () => {
            const collapsed = !rail.classList.contains("collapsed");
            setCollapsed(collapsed);
            bridge()?.setSettings({ navCollapsed: collapsed }).catch(() => {});
        });

        const api = bridge();
        api?.onUpdateStatus((status) => showUpdate(status, { pushed: true }));
        const ready = Promise.all([
            // The saved state is put in place at once, not animated.
            api?.getSettings().then((saved) => {
                rail.classList.add("nav-rail-instant");
                setCollapsed(saved.navCollapsed === true);
                requestAnimationFrame(() => requestAnimationFrame(() => rail.classList.remove("nav-rail-instant")));
                update.showSettings(saved);
            }),
            api?.getInfo().then((info) => {
                appName = info.name;
                update.showInfo(info);
                fillCredits(settings.pane("credits"), info, credits.logo);
            }),
        ]).then(() => api?.getUpdateStatus()).then((status) => {
            if (status) showUpdate(status);
        });

        return { showView, showSettings, ready };
    }

    // -- Progress ------------------------------------------------------------------

    /**
     * A progress bar: Bootstrap's .progress, in the accent. set(percent) moves
     * it (0 to 100); set(null) says the amount isn't known, and a 40% bar
     * slides across instead of sitting at 0%, which reads as a hang. Under
     * reduced motion, the unknown state is the whole bar, faded, and still.
     * set(percent, { paused: true }) is a paused piece of work: the bar keeps
     * its value and is still and faded, and an unknown one doesn't slide.
     * @param {{ label: string, thin?: boolean }} options
     *   label: its accessible name. thin: 4px, one item's, rather than the
     *   6px of a batch's.
     * @returns {{ element: HTMLElement, set(percent: number | null, options?: { paused?: boolean }): void }}
     */
    function progress({ label, thin = false } = {}) {
        if (typeof label !== "string" || label === "") throw new Error("kit.ui.progress(): label must name what it measures.");
        if (typeof thin !== "boolean") throw new Error("kit.ui.progress(): thin must be true or false.");
        const bar = el("div", { className: "progress-bar" });
        const element = el("div", {
            className: thin ? "progress kit-progress kit-progress-thin" : "progress kit-progress",
            attrs: { role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100" },
        }, [bar]);
        function set(percent, { paused = false } = {}) {
            if (typeof paused !== "boolean") throw new Error("kit.ui.progress(): paused must be true or false.");
            if (percent !== null && !Number.isFinite(percent)) throw new Error("kit.ui.progress(): set() takes a percent, or null when it isn't known.");
            element.classList.toggle("kit-progress-paused", paused);
            if (percent === null) {
                element.classList.add("kit-progress-unknown");
                element.removeAttribute("aria-valuenow");
                bar.style.removeProperty("width");
                return;
            }
            const value = Math.round(Math.min(100, Math.max(0, percent)));
            element.classList.remove("kit-progress-unknown");
            element.setAttribute("aria-valuenow", String(value));
            bar.style.width = `${value}%`;
        }
        set(0);
        return { element, set };
    }

    // -- The action bar ------------------------------------------------------------

    /**
     * The bar under a section's list of work: a status line (what's happening,
     * and a detail on the right), the batch's progress, then Clear, and the
     * primary action and its abort sharing one place, so only one of them is
     * ever there (Convert while idle, Cancel while it runs).
     * @param {{
     *   run: { label: string, onClick: () => void },
     *   abort: { label?: string, onClick: () => void },
     *   clear?: { label?: string, onClick: () => void },
     *   progressLabel?: string,
     *   size?: "sm",
     * }} options
     * @returns {{ element: HTMLElement, progress: ReturnType<typeof progress>, update(state: { summary?: string, detail?: string, percent?: number | null, running?: boolean, canRun?: boolean, canClear?: boolean }): void }}
     */
    function actionBar({ run, abort, clear, progressLabel = "Progress", size } = {}) {
        const fail = (message) => {
            throw new Error(`kit.ui.actionBar(): ${message}`);
        };
        const action = (value, name, fallback) => {
            if (value === undefined && fallback === undefined) return null;
            const { label = fallback, onClick } = value ?? {};
            if (typeof label !== "string" || label === "") fail(`${name}.label must be text.`);
            if (typeof onClick !== "function") fail(`${name}.onClick must be a function.`);
            return { label, onClick };
        };
        const runAction = action(run, "run");
        if (!runAction) fail("run is the primary action: { label, onClick }.");
        const abortAction = action(abort ?? {}, "abort", "Cancel");
        const clearAction = clear === undefined ? null : action(clear, "clear", "Clear All");
        if (size !== undefined && size !== "sm") fail('size must be "sm", or left out.');
        const sm = size === "sm" ? " btn-sm" : "";

        const summary = el("span", { className: "kit-action-summary" });
        const detail = el("span", { className: "kit-action-detail" });
        const bar = progress({ label: progressLabel });
        const button = (label, className, onClick) => {
            const b = el("button", { className: `btn${sm} ${className}`, text: label, attrs: { type: "button" } });
            b.addEventListener("click", onClick);
            return b;
        };
        const clearButton = clearAction && button(clearAction.label, "btn-outline-secondary", clearAction.onClick);
        const abortButton = button(abortAction.label, "btn-danger", abortAction.onClick);
        const runButton = button(runAction.label, "btn-primary", runAction.onClick);
        abortButton.hidden = true;
        runButton.disabled = true;
        const element = el("div", { className: "kit-action-bar" }, [
            el("div", { className: "kit-action-status" }, [
                // The line is a live region: it says what changed as it changes.
                el("div", { className: "kit-action-line", attrs: { role: "status" } }, [summary, detail]),
                bar.element,
            ]),
            el("div", { className: "kit-action-buttons" }, [clearButton, abortButton, runButton]),
        ]);

        function update({ summary: s, detail: d, percent, running, canRun, canClear } = {}) {
            if (s !== undefined) summary.textContent = s;
            if (d !== undefined) detail.textContent = d;
            if (percent !== undefined) bar.set(percent);
            if (running !== undefined) {
                // The focus moves with the action, so a keyboard press of Convert can press Cancel next.
                const moveFocus = document.activeElement === (running ? runButton : abortButton);
                runButton.hidden = running;
                abortButton.hidden = !running;
                if (moveFocus) (running ? abortButton : runButton).focus();
            }
            if (canRun !== undefined) runButton.disabled = !canRun;
            if (canClear !== undefined && clearButton) clearButton.disabled = !canClear;
        }
        return { element, progress: bar, update };
    }

    // -- Dropping files ------------------------------------------------------------

    /** Whether the page's guard against a stray drop is in place. */
    let dropGuarded = false;

    /**
     * Take files dropped onto an element: a section, usually, so anywhere in it
     * takes them. While files are dragged over it, it has the class drag-over,
     * counted in and out, since dragleave fires as the pointer crosses onto
     * each child (v1's highlight flickered). Each file's path comes from the
     * kit's bridge, one File at a time: a FileList can't cross the bridge, but
     * a File can. A drop anywhere else in the page opens nothing: without the
     * guard, the window would navigate to the file.
     *
     * With an icon and a label, it also builds the house drop zone for when
     * there's nothing there yet: a dashed box with the glyph, the label, "or"
     * and a button that browses instead (the whole box does, bar its button),
     * lit while files are over the area. The app puts it where it goes.
     * @param {HTMLElement} area
     * @param {{ onPaths: (paths: string[]) => void, icon?: string, label?: string, browseLabel?: string, onBrowse?: () => void }} options
     * @returns {{ zone: HTMLElement | null }}
     */
    function dropZone(area, { onPaths, icon: glyph, label, browseLabel = "Select Files", onBrowse } = {}) {
        const fail = (message) => {
            throw new Error(`kit.ui.dropZone(): ${message}`);
        };
        if (!(area instanceof Element)) fail("the area must be an element.");
        if (typeof onPaths !== "function") fail("onPaths must be a function.");
        const wantsZone = glyph !== undefined || label !== undefined || onBrowse !== undefined;
        if (wantsZone) {
            if (typeof glyph !== "string" || glyph === "") fail("icon must be a Material Icons Round glyph.");
            if (typeof label !== "string" || label === "") fail("label must be text, in Title Case.");
            if (typeof onBrowse !== "function") fail("onBrowse must be a function.");
            if (typeof browseLabel !== "string" || browseLabel === "") fail("browseLabel must be text.");
        }
        if (area.classList.contains("kit-drop-area")) fail("the area already takes drops.");

        if (!dropGuarded) {
            dropGuarded = true;
            document.addEventListener("dragover", (event) => event.preventDefault());
            document.addEventListener("drop", (event) => event.preventDefault());
        }

        area.classList.add("kit-drop-area");
        let depth = 0;
        const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
        area.addEventListener("dragenter", (event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            depth++;
            area.classList.add("drag-over");
        });
        area.addEventListener("dragleave", (event) => {
            if (!hasFiles(event)) return;
            depth = Math.max(0, depth - 1);
            if (depth === 0) area.classList.remove("drag-over");
        });
        area.addEventListener("drop", (event) => {
            event.preventDefault();
            depth = 0;
            area.classList.remove("drag-over");
            // Read before anything is awaited: dataTransfer doesn't survive it.
            const paths = Array.from(event.dataTransfer?.files ?? [])
                .map((file) => bridge()?.getPathForFile(file))
                .filter((p) => typeof p === "string" && p !== "");
            if (paths.length > 0) onPaths(paths);
        });

        if (!wantsZone) return { zone: null };
        const browse = el("button", { className: "btn btn-sm btn-secondary", text: browseLabel, attrs: { type: "button" } });
        browse.addEventListener("click", () => onBrowse());
        const zone = el("div", { className: "kit-drop-zone" }, [
            icon(glyph, "kit-drop-icon"),
            el("p", { className: "kit-drop-label", text: label }),
            el("p", { className: "kit-drop-or", text: "or" }),
            browse,
        ]);
        // The whole box browses, bar its own button, which would open the picker twice.
        zone.addEventListener("click", (event) => {
            if (!event.target.closest("button")) onBrowse();
        });
        return { zone };
    }

    // -- Busy buttons --------------------------------------------------------------

    /**
     * A button doing what it says: disabled, with Bootstrap's small spinner
     * before a "[Doing it]…" label (Pause becomes "Pausing…"). The spinner is
     * sized to the button's text, so the button doesn't grow. restore() puts its
     * own label back, and the enabled state it had; it's safe to call twice.
     * @param {HTMLButtonElement} button
     * @param {string} label
     * @returns {() => void} restore
     */
    function busy(button, label) {
        const fail = (message) => {
            throw new Error(`kit.ui.busy(): ${message}`);
        };
        if (!(button instanceof HTMLButtonElement)) fail("the button must be a <button>.");
        if (typeof label !== "string" || label === "") fail('label must be text, such as "Pausing…".');
        if (button.classList.contains("kit-busy")) fail("the button is already busy.");
        const was = [...button.childNodes];
        const wasDisabled = button.disabled;
        button.replaceChildren(el("span", { className: "spinner-border spinner-border-sm", attrs: { "aria-hidden": "true" } }), label);
        button.disabled = true;
        button.classList.add("kit-busy");
        let restored = false;
        return () => {
            if (restored) return;
            restored = true;
            button.replaceChildren(...was);
            button.disabled = wasDisabled;
            button.classList.remove("kit-busy");
        };
    }

    // -- Cards ---------------------------------------------------------------------

    /** A status line's tones: what each colours its dot and its text. running pulses. */
    const CARD_TONES = ["ready", "running", "warning", "danger", "success", "muted"];

    /** What a card's update() takes. */
    const CARD_STATE = ["name", "meta", "settings", "status", "percent", "paused", "actions", "rows", "locked", "canRemove", "route"];

    /** The elements a click on a card belongs to rather than the card: a click on one of them doesn't pick it. */
    const CARD_CONTROLS = "button, input, select, textarea, a[href], label, summary, [contenteditable], [tabindex]";

    /**
     * Each card's parts a grid works with, kept out of the card's own API: a
     * grid sets who hears its picks, and draws it selected or not.
     * @type {WeakMap<object, { element: HTMLElement, ownPick: boolean, inGrid: boolean, setPick(fn: Function | null): void, setSelected(selected: boolean): void }>}
     */
    const cardParts = new WeakMap();

    /**
     * One piece of work in a list: a file to convert, a transfer. The app keeps
     * its state and draws it with update(), which takes the whole of it each
     * time: anything left out is drawn empty (or hidden), bar the name.
     *
     * The head: a selection box, the kind's glyph, the name, then Advanced
     * Options (with onConfigure) and Remove (with onRemove). Under it, in order:
     * the meta line, the settings line, the route (an uppercase label such as
     * "To", or "MP4 →", then the app's own control), the status line with its
     * dot, the thin bar, the app's own rows, and the card's buttons. The
     * buttons are rebuilt only when their labels or variants change, so one
     * isn't swapped out from under the pointer as the card ticks; each calls
     * the onClick it was last given. locked disables Advanced Options, the
     * route's control and Remove, while its work is under way; canRemove,
     * which follows locked unless given, sets Remove apart (a queued upload
     * is locked, yet can be taken off the list). A click on the card, or its
     * box, calls onPick (not one on its controls); in a grid (cardGrid()),
     * the grid hears it instead.
     * @param {{
     *   icon: string,
     *   name: string,
     *   onConfigure?: () => void,
     *   onRemove?: () => void,
     *   route?: { label?: string, from?: string, control: HTMLElement },
     *   onPick?: (event: MouseEvent, how: { box: boolean }) => void,
     * }} options
     * @returns {{ element: HTMLElement, update(state: {
     *   name?: string,
     *   meta?: string,
     *   settings?: string | { text: string, tone?: "warning" },
     *   status?: { text: string, tone: string },
     *   percent?: number | null,
     *   paused?: boolean,
     *   actions?: { label: string, variant?: string, onClick: (button: HTMLButtonElement) => void }[],
     *   rows?: HTMLElement[],
     *   locked?: boolean,
     *   canRemove?: boolean,
     *   route?: boolean,
     * }): void }}
     */
    function card(options = {}) {
        const fail = (message) => {
            throw new Error(`kit.ui.card(): ${message}`);
        };
        const unknown = (given, known, where) => {
            const extra = Object.keys(given).find((key) => !known.includes(key));
            if (extra !== undefined) fail(`${where} has no option "${extra}".`);
        };
        const text = (value) => typeof value === "string" && value !== "";
        if (options === null || typeof options !== "object") fail("options must be { icon, name, … }.");
        unknown(options, ["icon", "name", "onConfigure", "onRemove", "route", "onPick"], "it");
        const { icon: glyph, name, onConfigure, onRemove, route, onPick } = options;
        if (!text(glyph)) fail("icon must be a Material Icons Round glyph.");
        if (!text(name)) fail("name must be text.");
        for (const [key, value] of Object.entries({ onConfigure, onRemove, onPick })) {
            if (value !== undefined && typeof value !== "function") fail(`${key} must be a function, or left out.`);
        }
        if (route !== undefined) {
            if (route === null || typeof route !== "object") fail("route must be { label, control } or { from, control }.");
            unknown(route, ["label", "from", "control"], "route");
            if ((route.label === undefined) === (route.from === undefined)) fail("route takes a label (\"To\") or a from (\"MP4\"), not both.");
            if (!text(route.label ?? route.from)) fail(`route.${route.label !== undefined ? "label" : "from"} must be text.`);
            if (!(route.control instanceof HTMLElement)) fail("route.control must be the app's element.");
        }

        const box = el("input", { className: "form-check-input kit-card-select", attrs: { type: "checkbox" } });
        const nameText = el("span", { className: "kit-card-name" });
        const configure = onConfigure && el("button", {
            className: "kit-card-configure",
            attrs: { type: "button", title: "Advanced Options", "aria-label": "Advanced Options" },
        }, [icon("tune")]);
        const remove = onRemove && el("button", { className: "kit-card-remove", attrs: { type: "button", title: "Remove" } }, [icon("close")]);
        configure?.addEventListener("click", () => onConfigure());
        remove?.addEventListener("click", () => onRemove());

        const meta = el("div", { className: "kit-card-meta" });
        const settings = el("div", { className: "kit-card-settings" });
        const routeLine = route && el("div", { className: "kit-card-route" }, [
            ...(route.label !== undefined
                ? [el("span", { className: "kit-card-route-label", text: route.label })]
                : [el("span", { className: "kit-card-from", text: route.from }), icon("arrow_forward", "kit-card-arrow")]),
            route.control,
        ]);
        const statusText = el("span", { className: "kit-status-text" });
        const status = el("div", { className: "kit-card-status" }, [el("span", { className: "kit-status-dot" }), statusText]);
        const bar = progress({ label: name, thin: true });
        bar.element.classList.add("kit-card-progress");
        const rowSlot = el("div", { className: "kit-card-rows" });
        const actionSlot = el("div", { className: "kit-card-actions" });

        const element = el("div", { className: "kit-card", attrs: { role: "group" } }, [
            el("div", { className: "kit-card-head" }, [box, icon(glyph, "kit-card-icon"), nameText, configure, remove]),
            meta,
            settings,
            routeLine,
            status,
            bar.element,
            rowSlot,
            actionSlot,
        ]);

        // Who hears a pick: the app's onPick, or the grid the card is in.
        let picker = null;
        function setPick(fn) {
            picker = fn;
            element.classList.toggle("kit-card-pickable", picker !== null);
        }
        const onControl = (event) => {
            const control = event.target.closest(CARD_CONTROLS);
            return control !== null && element.contains(control) && control !== element;
        };
        box.addEventListener("click", (event) => picker?.(event, { box: true }));
        element.addEventListener("click", (event) => {
            if (picker && !onControl(event)) picker(event, { box: false });
        });
        // Shift picks a range: it doesn't also select the text between.
        element.addEventListener("mousedown", (event) => {
            if (picker && event.shiftKey && !onControl(event)) event.preventDefault();
        });
        setPick(onPick ?? null);

        let current = name;
        function rename(value) {
            current = value;
            nameText.textContent = value;
            nameText.title = value;
            element.setAttribute("aria-label", value);
            box.setAttribute("aria-label", `Select ${value}`);
            remove?.setAttribute("aria-label", `Remove ${value}`);
            bar.element.setAttribute("aria-label", value);
        }

        /** The buttons drawn now, with what each was last asked to do. */
        let drawn = { key: null, handlers: [] };
        function drawActions(actions) {
            const key = actions.map(({ label, variant }) => `${variant}\u0000${label}`).join("\u0001");
            if (key !== drawn.key) {
                const handlers = [];
                actionSlot.replaceChildren(...actions.map(({ label, variant }, i) => {
                    const b = el("button", { className: `btn btn-sm btn-${variant}`, text: label, attrs: { type: "button" } });
                    b.addEventListener("click", () => handlers[i](b));
                    return b;
                }));
                drawn = { key, handlers };
            }
            actions.forEach(({ onClick }, i) => {
                drawn.handlers[i] = onClick;
            });
            actionSlot.hidden = actions.length === 0;
        }

        function update(state = {}) {
            if (state === null || typeof state !== "object") fail("update() takes the card's state, { status, … }.");
            unknown(state, CARD_STATE, "update()");
            const {
                name: renamed, meta: metaText, settings: settingsLine, status: statusLine, percent, paused = false,
                actions = [], rows = [], locked = false, canRemove = !locked, route: showRoute = true,
            } = state;
            // Everything is checked before anything is drawn, so a mistake leaves the card as it was.
            if (renamed !== undefined && !text(renamed)) fail("update(): name must be text.");
            if (metaText !== undefined && typeof metaText !== "string") fail("update(): meta must be text.");
            const settingsOf = typeof settingsLine === "string" ? { text: settingsLine } : settingsLine;
            if (settingsOf !== undefined && (settingsOf === null || typeof settingsOf !== "object" || typeof settingsOf.text !== "string"
                || (settingsOf.tone !== undefined && settingsOf.tone !== "warning"))) {
                fail('update(): settings must be text, or { text, tone: "warning" }.');
            }
            if (statusLine !== undefined && (statusLine === null || typeof statusLine !== "object" || typeof statusLine.text !== "string" || !CARD_TONES.includes(statusLine.tone))) {
                fail(`update(): status must be { text, tone }, the tone one of ${CARD_TONES.join(", ")}.`);
            }
            if (percent !== undefined && percent !== null && !Number.isFinite(percent)) fail("update(): percent must be a number, or null when it isn't known.");
            if (typeof paused !== "boolean") fail("update(): paused must be true or false.");
            if (!Array.isArray(actions)) fail("update(): actions must be a list of { label, variant, onClick }.");
            const buttons = actions.map((action) => {
                const { label, variant = "outline-secondary", onClick } = action ?? {};
                if (!text(label)) fail("update(): each action's label must be text.");
                if (!BUTTON_VARIANTS.includes(variant)) fail(`update(): an action's variant must be one of ${BUTTON_VARIANTS.join(", ")}.`);
                if (typeof onClick !== "function") fail("update(): each action's onClick must be a function.");
                return { label, variant, onClick };
            });
            if (!Array.isArray(rows) || !rows.every((row) => row instanceof HTMLElement)) fail("update(): rows must be a list of the app's elements.");
            if (typeof locked !== "boolean") fail("update(): locked must be true or false.");
            if (typeof canRemove !== "boolean") fail("update(): canRemove must be true or false.");
            if (typeof showRoute !== "boolean") fail("update(): route must be true or false: whether the route shows.");

            if (renamed !== undefined && renamed !== current) rename(renamed);
            meta.hidden = metaText === undefined;
            meta.textContent = metaText ?? "";
            meta.title = metaText ?? "";
            settings.hidden = !settingsOf?.text;
            settings.textContent = settingsOf?.text ?? "";
            settings.title = settingsOf?.text ?? "";
            settings.classList.toggle("kit-card-settings-warning", settingsOf?.tone === "warning");
            if (routeLine) routeLine.hidden = !showRoute;
            status.hidden = statusLine === undefined;
            status.className = `kit-card-status kit-tone-${statusLine?.tone ?? "muted"}`;
            statusText.textContent = statusLine?.text ?? "";
            statusText.title = statusLine?.text ?? "";
            bar.element.hidden = percent === undefined;
            if (percent !== undefined) bar.set(percent, { paused });
            // The app's rows, put back only when they're other elements, so one being typed in or selected keeps it.
            const same = rows.length === rowSlot.children.length && rows.every((row, i) => rowSlot.children[i] === row);
            if (!same) rowSlot.replaceChildren(...rows);
            rowSlot.hidden = rows.length === 0;
            drawActions(buttons);
            if (configure) configure.disabled = locked;
            if (remove) remove.disabled = !canRemove;
            if (route && "disabled" in route.control) route.control.disabled = locked;
        }

        rename(name);
        update();
        const made = { element, update };
        cardParts.set(made, {
            element,
            ownPick: onPick !== undefined,
            inGrid: false,
            setPick,
            setSelected(selected) {
                element.classList.toggle("selected", selected);
                box.checked = selected;
            },
        });
        return made;
    }

    // -- The card grid -------------------------------------------------------------

    /**
     * The selection a click leaves, by File Converter's rules: a plain click
     * selects the one clicked, or keeps a multi-selection it's inside (so a
     * group can be acted on without collapsing to one first); Ctrl (Cmd on a
     * Mac) toggles it; Shift selects the range from the anchor, the last item
     * clicked without Shift, and Ctrl+Shift adds that range to what's
     * selected. A Shift click with no anchor in the list is a plain click.
     * The items are anything (a grid's are its cards), in their order on screen.
     * @template T
     * @param {T[]} items
     * @param {Set<T>} current
     * @param {T} clicked
     * @param {{ ctrl?: boolean, shift?: boolean }} [modifiers]
     * @param {T | null} [anchor]
     * @returns {{ selection: Set<T>, anchor: T | null }}
     */
    function resolveSelection(items, current, clicked, { ctrl = false, shift = false } = {}, anchor = null) {
        if (shift && anchor !== null && items.includes(anchor) && items.includes(clicked)) {
            const from = items.indexOf(anchor);
            const to = items.indexOf(clicked);
            const next = ctrl ? new Set(current) : new Set();
            for (const item of items.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(item);
            return { selection: next, anchor };
        }
        if (ctrl) {
            const next = new Set(current);
            if (next.has(clicked)) next.delete(clicked);
            else next.add(clicked);
            return { selection: next, anchor: clicked };
        }
        if (current.size > 1 && current.has(clicked)) return { selection: new Set(current), anchor: clicked };
        return { selection: new Set([clicked]), anchor: clicked };
    }

    /** The selection without the items no longer in the list, so a removal can't strand one. */
    function pruneSelection(selection, items) {
        const kept = new Set(items);
        return new Set([...selection].filter((item) => kept.has(item)));
    }

    /**
     * Each grid's hooks for its bulk bar, kept out of the grid's own API.
     * @type {WeakMap<object, { listen(fn: () => void): void, barred: boolean }>}
     */
    const gridParts = new WeakMap();

    /**
     * The cards of a list, side by side (as many columns of at least 272px as
     * fit), in the order they're added, and which of them are selected. The
     * grid hears each card's picks and selects by resolveSelection()'s rules;
     * a card's box toggles just its card, and a click on the grid's empty
     * space clears it. Ctrl+A selects every card and Escape clears, through
     * kit.keys.onKey() (never while typing, under a modal, or in another
     * view). Delete is the app's: only it knows when a card can go.
     * onSelect is told each time the selection changes, however it changed.
     * @param {HTMLElement} container - the app's element the cards go in
     * @param {{ view?: string, onSelect?: (selection: object[]) => void }} [options]
     * @returns {{ add(card: object): void, remove(card: object): void, readonly cards: object[], readonly selection: object[],
     *             select(cards: object | object[]): void, selectAll(): void, clear(): void }}
     */
    function cardGrid(container, options = {}) {
        const fail = (message) => {
            throw new Error(`kit.ui.cardGrid(): ${message}`);
        };
        if (!(container instanceof HTMLElement)) fail("the container must be the app's element.");
        if (container.classList.contains("kit-card-grid")) fail("the container is a grid already.");
        if (options === null || typeof options !== "object") fail("options must be { view, onSelect }.");
        const extra = Object.keys(options).find((key) => !["view", "onSelect"].includes(key));
        if (extra !== undefined) fail(`it has no option "${extra}".`);
        const { view, onSelect } = options;
        if (view !== undefined && (typeof view !== "string" || !VIEW_NAME.test(view))) fail("view must be the shell's name for the view, or left out.");
        if (onSelect !== undefined && typeof onSelect !== "function") fail("onSelect must be a function, or left out.");
        container.classList.add("kit-card-grid");

        let cards = [];
        let selected = new Set();
        let anchor = null;
        const listeners = [];

        const selection = () => cards.filter((card) => selected.has(card));

        /** Draw the selection on the cards, tell the bar, and tell the app if it changed. */
        function settle(next, nextAnchor) {
            const changed = next.size !== selected.size || [...next].some((card) => !selected.has(card));
            selected = next;
            anchor = nextAnchor;
            for (const card of cards) cardParts.get(card).setSelected(selected.has(card));
            for (const listen of listeners) listen();
            if (changed) onSelect?.(selection());
        }

        const pick = (card) => (event, { box }) => {
            // The box toggles just its card, whatever is held down.
            const modifiers = box ? { ctrl: true } : { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey };
            const next = resolveSelection(cards, selected, card, modifiers, anchor);
            settle(next.selection, next.anchor);
        };

        const ours = (card, where) => {
            if (!cards.includes(card)) fail(`${where} takes a card in this grid.`);
        };

        function add(card) {
            const parts = cardParts.get(card);
            if (!parts) fail("add() takes a card from kit.ui.card().");
            if (parts.inGrid) fail("add(): the card is in a grid already.");
            if (parts.ownPick) fail("add(): the card has its own onPick; in a grid, the grid picks it.");
            parts.inGrid = true;
            cards.push(card);
            container.append(parts.element);
            parts.setPick(pick(card));
            settle(selected, anchor);
        }

        function remove(card) {
            ours(card, "remove()");
            const parts = cardParts.get(card);
            parts.inGrid = false;
            cards = cards.filter((c) => c !== card);
            parts.element.remove();
            parts.setPick(null);
            parts.setSelected(false);
            settle(pruneSelection(selected, cards), anchor === card ? null : anchor);
        }

        function select(given) {
            const list = Array.isArray(given) ? given : [given];
            for (const card of list) ours(card, "select()");
            settle(new Set(list), cards.find((card) => list.includes(card)) ?? null);
        }
        const selectAll = () => settle(new Set(cards), cards[0] ?? null);
        const clear = () => settle(new Set(), null);

        // The grid's empty space, between and after the cards.
        container.addEventListener("click", (event) => {
            if (event.target === container) clear();
        });
        onKey((event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
                event.preventDefault();
                selectAll();
            } else if (event.key === "Escape") {
                clear();
            }
        }, { view });

        const grid = {
            add,
            remove,
            get cards() {
                return [...cards];
            },
            get selection() {
                return selection();
            },
            select,
            selectAll,
            clear,
        };
        gridParts.set(grid, { listen: (fn) => listeners.push(fn), barred: false });
        return grid;
    }

    // The rules themselves, for a list that isn't cards.
    cardGrid.resolveSelection = resolveSelection;
    cardGrid.pruneSelection = pruneSelection;

    // -- The bulk bar --------------------------------------------------------------

    /** A number for each bar, for its note's id. */
    let bulkBars = 0;

    /**
     * The bar over a grid that acts on its selection, or on every card when
     * none is selected (the scope): the select-all box (ticked when all are,
     * a bar across it when some are), "Select all" or "3 selected", then the
     * target (the app's select, labelled "Convert all to" or "Convert
     * selected to", with the note from note(scope) beside it), then the app's
     * actions, each shown always or only with a selection, and Deselect. It
     * shows while the grid has cards. refresh() draws it again, for a note or
     * an enabled() that has changed with the app's own state.
     * @param {object} grid - from kit.ui.cardGrid()
     * @param {{
     *   noun: string | { one: string, many?: string },
     *   target?: { verb: string, control: HTMLSelectElement, note?: (scope: object[], how: { all: boolean }) => string },
     *   actions?: { label: string, variant?: string, selection?: boolean, enabled?: (scope: object[]) => boolean, onClick: (scope: object[]) => void }[],
     * }} options
     * @returns {{ element: HTMLElement, refresh(): void }}
     */
    function bulkBar(grid, options = {}) {
        const fail = (message) => {
            throw new Error(`kit.ui.bulkBar(): ${message}`);
        };
        const text = (value) => typeof value === "string" && value !== "";
        const unknown = (given, known, where) => {
            const extra = Object.keys(given).find((key) => !known.includes(key));
            if (extra !== undefined) fail(`${where} has no option "${extra}".`);
        };
        const hooks = gridParts.get(grid);
        if (!hooks) fail("the grid must be one from kit.ui.cardGrid().");
        if (hooks.barred) fail("the grid has a bulk bar already.");
        if (options === null || typeof options !== "object") fail("options must be { noun, target, actions }.");
        unknown(options, ["noun", "target", "actions"], "it");
        const { noun, target, actions = [] } = options;
        const words = typeof noun === "string" ? { one: noun } : noun;
        if (!words || typeof words !== "object" || !text(words.one) || (words.many !== undefined && !text(words.many))) {
            fail('noun must be what a card is, such as "file", or { one, many }.');
        }
        if (target !== undefined) {
            if (target === null || typeof target !== "object") fail("target must be { verb, control, note }.");
            unknown(target, ["verb", "control", "note"], "target");
            if (!text(target.verb)) fail('target.verb must be text, such as "Convert".');
            if (!(target.control instanceof HTMLSelectElement)) fail("target.control must be the app's <select>.");
            if (target.note !== undefined && typeof target.note !== "function") fail("target.note must be a function, or left out.");
        }
        if (!Array.isArray(actions)) fail("actions must be a list of { label, variant, selection, onClick }.");
        const buttons = actions.map((action, i) => {
            if (action === null || typeof action !== "object") fail(`actions[${i}] must be { label, variant, selection, onClick }.`);
            unknown(action, ["label", "variant", "selection", "enabled", "onClick"], `actions[${i}]`);
            const { label, variant = "outline-secondary", selection = false, enabled, onClick } = action;
            if (!text(label)) fail(`actions[${i}].label must be text.`);
            if (!BUTTON_VARIANTS.includes(variant)) fail(`actions[${i}].variant must be one of ${BUTTON_VARIANTS.join(", ")}.`);
            if (typeof selection !== "boolean") fail(`actions[${i}].selection must be true or false: whether it shows only with a selection.`);
            if (enabled !== undefined && typeof enabled !== "function") fail(`actions[${i}].enabled must be a function, or left out.`);
            if (typeof onClick !== "function") fail(`actions[${i}].onClick must be a function.`);
            return { label, variant, selection, enabled, onClick };
        });
        hooks.barred = true;

        const scope = () => (grid.selection.length > 0 ? grid.selection : grid.cards);
        const all = el("input", {
            className: "form-check-input kit-bulk-select",
            attrs: { type: "checkbox", title: "Select all", "aria-label": `Select all ${plural(2, words.one, words.many)}` },
        });
        // What's selected, said as it changes: Ctrl+A and Escape show nothing else.
        const count = el("span", { className: "kit-bulk-count", attrs: { role: "status" } });
        const shown = [
            ...buttons.map(({ label, variant, selection, enabled, onClick }) => {
                const button = el("button", { className: `btn btn-sm btn-${variant}`, text: label, attrs: { type: "button" } });
                button.addEventListener("click", () => onClick(scope()));
                return { button, selection, enabled };
            }),
            { button: el("button", { className: "btn btn-sm btn-outline-secondary", text: "Deselect", attrs: { type: "button" } }), selection: true },
        ];
        shown[shown.length - 1].button.addEventListener("click", () => grid.clear());
        const label = target && el("label", { className: "kit-bulk-label" });
        const note = target && el("span", { className: "kit-bulk-note", attrs: { id: `kit-bulk-note-${++bulkBars}` } });
        if (target) {
            const { control } = target;
            if (!control.id) control.id = `kit-bulk-target-${bulkBars}`;
            label.htmlFor = control.id;
            control.classList.add("kit-bulk-target");
            control.setAttribute("aria-describedby", note.id);
        }
        const element = el("div", { className: "kit-bulk-bar" }, [
            all,
            count,
            target && el("span", { className: "kit-bulk-sep", attrs: { "aria-hidden": "true" } }),
            label,
            target?.control,
            note,
            el("div", { className: "kit-bulk-actions" }, shown.map(({ button }) => button)),
        ]);

        function refresh() {
            const total = grid.cards.length;
            const n = grid.selection.length;
            const everything = n === 0;
            element.hidden = total === 0;
            count.textContent = everything ? "Select all" : `${groupDigits(n)} selected`;
            all.checked = n > 0 && n === total;
            all.indeterminate = n > 0 && n < total;
            if (target) {
                label.textContent = `${target.verb} ${everything ? "all" : "selected"} to`;
                const said = target.note?.(scope(), { all: everything }) ?? "";
                if (typeof said !== "string") fail("target.note() must return text.");
                note.textContent = said;
                note.hidden = said === "";
            }
            // A button that goes while it has the focus hands it to the box, not to the page.
            let lost = false;
            for (const { button, selection, enabled } of shown) {
                const hide = selection && everything;
                if (hide && document.activeElement === button) lost = true;
                button.hidden = hide;
                button.disabled = enabled ? !enabled(scope()) : false;
            }
            if (lost) all.focus();
        }

        all.addEventListener("change", () => {
            if (all.checked) grid.selectAll();
            else grid.clear();
        });
        hooks.listen(refresh);
        refresh();
        return { element, refresh };
    }

    // -- Keys ----------------------------------------------------------------------

    /** The input types a person doesn't type into: a key pressed there is still the page's. */
    const NOT_TYPED = /^(checkbox|radio|button|submit|reset|range|file|color|image)$/;

    /**
     * Whether a key pressed now goes into something being typed in: a text
     * field, a text area, or anything editable. A select isn't: it keeps the
     * focus after a choice, and would swallow the next Escape or Delete.
     * @param {Element | null} [target] - What has the focus; the active element if not given.
     */
    function isTyping(target = document.activeElement) {
        if (!(target instanceof Element)) return false;
        if (target instanceof HTMLTextAreaElement) return true;
        if (target instanceof HTMLInputElement) return !NOT_TYPED.test(target.type);
        return target.isContentEditable === true;
    }

    /** Whether a modal is open: a prompt (a modal dialog), or one of Bootstrap's. */
    const modalOpen = () => document.querySelector("dialog[open]:modal, .modal.show") !== null;

    /**
     * Listen for the page's own shortcuts (Delete, Escape, Ctrl+A on a list),
     * the house's way: the handler isn't called while someone is typing, while
     * a modal owns the keyboard, or, given a view, while another view shows.
     * @param {(event: KeyboardEvent) => void} handler
     * @param {{ view?: string }} [options] - view: the shell's view (mountShell) the keys belong to.
     * @returns {() => void} Stops listening.
     */
    function onKey(handler, { view } = {}) {
        if (typeof handler !== "function") throw new Error("kit.keys.onKey(): the handler must be a function.");
        if (view !== undefined && (typeof view !== "string" || view === "")) throw new Error("kit.keys.onKey(): view must be a view's name.");
        const listener = (event) => {
            if (event.defaultPrevented || isTyping(event.target) || modalOpen()) return;
            if (view !== undefined && document.querySelector(".app-shell")?.dataset.view !== view) return;
            handler(event);
        };
        document.addEventListener("keydown", listener);
        return () => document.removeEventListener("keydown", listener);
    }

    // -- Format ------------------------------------------------------------------
    //
    // The house's wording for numbers, from File Converter's core/display.js:
    // every count on screen goes through countOf(), so "1 files" can't happen.

    /**
     * The word that agrees with a count: one when n is 1, else many, or one
     * with an "s". plural(1, "file") is "file"; plural(3, "needs", "need") is "need".
     */
    function plural(n, one, many) {
        return n === 1 ? one : (many === undefined ? `${one}s` : many);
    }

    /** 18000 as "18,000": a count grouped by thousands. */
    function groupDigits(n) {
        const num = Number(n);
        if (!Number.isFinite(num)) return String(n);
        const sign = num < 0 ? "-" : "";
        return sign + String(Math.trunc(Math.abs(num))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    /** A count with its word: "1 file", "3 files", "18,000 frames". */
    function countOf(n, one, many) {
        return `${groupDigits(n)} ${plural(n, one, many)}`;
    }

    /** A size in bytes, short: "512 B", "1.5 KB", "12 MB" (binary units, one decimal below 10). Null if unknown. */
    function formatBytes(bytes) {
        if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
        if (bytes < 1024) return `${Math.round(bytes)} B`;
        const units = ["KB", "MB", "GB", "TB"];
        let value = bytes / 1024;
        let i = 0;
        while (value >= 1024 && i < units.length - 1) {
            value /= 1024;
            i++;
        }
        // Rounding up to 1024 of a unit reads as the next one.
        if (Math.round(value) >= 1024 && i < units.length - 1) {
            value /= 1024;
            i++;
        }
        return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
    }

    /** Seconds left, terse: "45s", "2m 05s", "1h 02m". Null if unknown. */
    function formatEta(seconds) {
        if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
        const total = Math.round(seconds);
        if (total < 60) return `${total}s`;
        const m = Math.floor(total / 60);
        const s = total % 60;
        if (m < 60) return `${m}m ${String(s).padStart(2, "0")}s`;
        return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
    }

    /** Seconds as a clock: "9:05", "1:02:03". Null if unknown. */
    function formatDuration(seconds) {
        if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
        const total = Math.round(seconds);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const pad = (n) => String(n).padStart(2, "0");
        return h > 0 ? `${h}:${pad(m)}:${pad(total % 60)}` : `${m}:${pad(total % 60)}`;
    }

    /**
     * The line after a batch has run: "3 files converted, 1 failed, 1 skipped,
     * 2 cancelled", or "Nothing converted". Skipped (the person chose to leave
     * it out) and cancelled (the run was stopped) are told apart. The first
     * count names the item.
     * @param {{ done?: number, failed?: number, skipped?: number, cancelled?: number }} counts
     * @param {{ one: string, many?: string, done: string }} words - the item ("file") and what done means ("converted").
     */
    function summarise({ done = 0, failed = 0, skipped = 0, cancelled = 0 } = {}, { one, many, done: doneWord } = {}) {
        if (typeof one !== "string" || typeof doneWord !== "string") throw new Error("kit.format.summarise(): words must name the item (one) and what done is (done).");
        const parts = [];
        const count = (n) => (parts.length === 0 ? countOf(n, one, many) : groupDigits(n));
        if (done > 0) parts.push(`${count(done)} ${doneWord}`);
        if (failed > 0) parts.push(`${count(failed)} failed`);
        if (skipped > 0) parts.push(`${count(skipped)} skipped`);
        if (cancelled > 0) parts.push(`${count(cancelled)} cancelled`);
        return parts.length > 0 ? parts.join(", ") : `Nothing ${doneWord}`;
    }

    // -- Checkboxes ------------------------------------------------------------
    //
    // A checkbox a person ticks has its tick drawn (kit.css, kit-tick-draw).
    // The mark that asks for it is set on the change a person makes, and
    // cleared once the tick is drawn: a box checked by the page, or shown again
    // after being hidden, has its tick there already rather than drawn again.

    /** Whether an element is one of Bootstrap's checkboxes, not a switch. */
    const isCheckbox = (el) => el instanceof HTMLInputElement && el.type === "checkbox"
        && el.classList.contains("form-check-input") && el.getAttribute("role") !== "switch";

    document.addEventListener("change", (event) => {
        if (!isCheckbox(event.target)) return;
        if (event.target.checked) event.target.dataset.kitTick = "draw";
        else delete event.target.dataset.kitTick;
    }, true);
    document.addEventListener("animationend", (event) => {
        if (event.animationName === "kit-tick-draw" && isCheckbox(event.target)) delete event.target.dataset.kitTick;
    }, true);

    window.kit = {
        ui: { mountShell, toast, confirm, progress, actionBar, dropZone, busy, card, cardGrid, bulkBar },
        format: { plural, countOf, groupDigits, formatBytes, formatEta, formatDuration, summarise },
        keys: { isTyping, onKey },
    };
})();
