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
//         toolbar:  $("toolbar"),            // the header's controls, shared by every section
//         settingsTabs: [{ id: "general", label: "General", render: (pane) => { … } }],
//         credits:  { logo: "assets/logo.png" },
//         onViewChange: (view) => { … },
//     });
//     await shell.ready;                    // the settings and the Credits tab are loaded
//
// It builds the nav rail (the app's sections, then Settings above Collapse),
// the header, and the Settings view (the app's tabs, then Update, then Credits
// last), moves the app's elements into them, and routes between the views.
// The Update tab and the update dot follow the kit's updater (update:status).
//
// kit.ui.toast(message, { type, timeout }) shows a toast under the header.
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

    function checkOptions({ title, sections = [], toolbar, settingsTabs = [], onViewChange }) {
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
    }

    // -- The Settings view -----------------------------------------------------

    /**
     * The Settings view: a heading, the tabs (role="tablist", arrow keys, Home
     * and End), and a pane per tab, each keeping its state while hidden. The
     * tabs sit on a thin line, and a thicker accent bar under the selected
     * one slides to the next tab chosen, taking its text's width.
     * @param {{ id: string, label: string, render: (pane: HTMLElement) => void }[]} tabs
     */
    function buildSettings(tabs) {
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
        function select(id, { focus = false } = {}) {
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

        select(tabs[0].id);
        return { view, select, pane: (id) => paneOf.get(id), tab: (id) => buttons[tabs.findIndex((tab) => tab.id === id)], selected: () => tabs[buttons.findIndex((b) => b.getAttribute("aria-selected") === "true")].id };
    }

    // -- The Update tab ----------------------------------------------------------

    /** The update channels, as the Update tab offers them, with the help line for each. */
    const UPDATE_CHANNELS = [
        { value: "stable", label: "Stable", help: "Finished releases only." },
        { value: "beta", label: "Beta", help: "Betas and finished releases." },
        { value: "alpha", label: "Alpha", help: "Every build, alphas included." },
    ];

    /**
     * What the Update tab's status line says for the updater's state
     * (main/updater.js), and whether it's an error.
     * @param {{ state: string, reason: string | null, error: string | null, version: string | null, percent: number | null }} status
     * @param {string} appName
     * @returns {{ text: string, percent?: string, danger?: boolean }}
     */
    function updateMessage({ state, reason, error, version, percent }, appName) {
        switch (state) {
            case "unavailable":
                return { text: reason === "not-packaged" ? "Updates are checked in the installed app." : `${appName} doesn't update itself.` };
            case "checking":
                return { text: "Checking for updates…" };
            case "none":
                return { text: "You're up to date." };
            case "available":
                return { text: `Version ${version} is available.` };
            case "downloading":
                return { text: `Downloading version ${version}…`, percent: ` ${percent ?? 0}%` };
            case "downloaded":
                return { text: `Version ${version} has downloaded and will be installed when you close ${appName}.` };
            case "error":
                return error === "download"
                    ? { text: `Version ${version} couldn't be downloaded.`, danger: true }
                    : { text: "Couldn't check for updates. Try again later.", danger: true };
            default:
                return { text: "" };
        }
    }

    /**
     * The Update tab, top to bottom: the app and the version running, Check
     * for Updates with its status line (a live region, its height kept, so
     * nothing jumps) and Download Update when there's one to download, the
     * automatic downloads switch, and the update channel. Each change is kept
     * as it's made, and the kit's main process acts on it (a new channel
     * checks again).
     * @param {HTMLElement} pane
     * @returns {{ showInfo(info: object): void, showSettings(settings: object): void, showStatus(status: object, appName: string): boolean }}
     */
    function buildUpdate(pane) {
        const version = el("p", { className: "update-version" });
        const check = el("button", { className: "btn btn-secondary", text: "Check for Updates", attrs: { type: "button", id: "update-check" } });
        const statusText = el("span");
        // The percent is seen, not read out: a screen reader would announce every step of it.
        const statusPercent = el("span", { attrs: { "aria-hidden": "true" } });
        const status = el("p", { className: "update-status", attrs: { id: "update-status", role: "status" } }, [statusText, statusPercent]);
        const download = el("button", { className: "btn btn-sm btn-primary update-download", text: "Download Update", attrs: { type: "button", id: "update-download", hidden: "" } });

        const auto = el("input", { className: "form-check-input", attrs: { type: "checkbox", role: "switch", id: "update-auto", "aria-describedby": "update-auto-help" } });
        const autoHelp = el("div", { className: "form-text", attrs: { id: "update-auto-help" } });
        const channel = el("select", { className: "form-select form-select-sm update-channel", attrs: { id: "update-channel", "aria-describedby": "update-channel-help" } },
            UPDATE_CHANNELS.map(({ value, label }) => el("option", { text: label, attrs: { value } })));
        const channelHelp = el("div", { className: "form-text", attrs: { id: "update-channel-help" } });
        const showChannelHelp = () => {
            channelHelp.textContent = UPDATE_CHANNELS.find((c) => c.value === channel.value)?.help ?? "";
        };
        showChannelHelp();

        pane.replaceChildren(el("div", { className: "update-tab" }, [
            version,
            el("div", { className: "update-check" }, [check, status, download]),
            el("div", { className: "update-row" }, [
                el("div", { className: "form-check form-switch mb-0" }, [auto, el("label", { className: "form-check-label", text: "Download updates automatically", attrs: { for: "update-auto" } })]),
                autoHelp,
            ]),
            el("div", { className: "update-row" }, [
                el("label", { className: "form-label", text: "Update channel", attrs: { for: "update-channel" } }),
                channel,
                channelHelp,
            ]),
        ]));

        const api = bridge();
        check.addEventListener("click", () => api?.checkForUpdates().catch(() => {}));
        download.addEventListener("click", () => api?.downloadUpdate().catch(() => {}));
        auto.addEventListener("change", () => api?.setSettings({ autoDownloadUpdates: auto.checked }).catch(() => {}));
        channel.addEventListener("change", () => {
            showChannelHelp();
            api?.setSettings({ updateChannel: channel.value }).catch(() => {});
        });

        return {
            showInfo(info) {
                version.textContent = `${info.name} ${info.version}`;
                autoHelp.textContent = `Updates are installed when you close ${info.name}.`;
            },
            showSettings(settings) {
                auto.checked = settings.autoDownloadUpdates === true;
                if (UPDATE_CHANNELS.some((c) => c.value === settings.updateChannel)) channel.value = settings.updateChannel;
                showChannelHelp();
            },
            /** Show the updater's state; returns whether the update dot shows. */
            showStatus(next, appName) {
                const message = updateMessage(next, appName);
                statusText.textContent = message.text;
                statusPercent.textContent = message.percent ?? "";
                // Bootstrap's emphasis shade, which holds AA on the page in both themes (its plain danger doesn't on dark).
                status.classList.toggle("text-danger-emphasis", Boolean(message.danger));
                // A check can run unless there's no updater, one is running, or an update is downloading or waiting.
                check.disabled = ["unavailable", "checking", "downloading", "downloaded"].includes(next.state);
                download.hidden = !(next.state === "available" || (next.state === "error" && next.error === "download"));
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

    /**
     * Show a toast: something the person should know, but not answer. It
     * closes itself after --timing-toast (4.5 s), or when its close button is
     * pressed. A danger toast is announced at once (role="alert"); the rest
     * politely, through the host's live region. The message is text, never
     * markup.
     * @param {string} message
     * @param {{ type?: "info" | "success" | "warning" | "danger", timeout?: number }} [options]
     *   timeout: how long it stays, in ms; 0 keeps it until it's closed.
     * @returns {{ element: HTMLElement, close(): void }}
     */
    function toast(message, { type = "info", timeout } = {}) {
        if (typeof message !== "string" || message === "") throw new Error("kit.ui.toast(): the message must be text.");
        if (!Object.hasOwn(TOAST_ICONS, type)) throw new Error(`kit.ui.toast(): type must be one of ${Object.keys(TOAST_ICONS).join(", ")}.`);
        if (timeout !== undefined && !(Number.isFinite(timeout) && timeout >= 0)) throw new Error("kit.ui.toast(): timeout must be a number of ms, or 0.");
        const stay = timeout ?? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--timing-toast")) || 4500);

        const close = el("button", { className: "toast-close", attrs: { type: "button", title: "Dismiss", "aria-label": "Dismiss" } }, [icon("close")]);
        const note = el("div", { className: `toast-note toast-${type}`, attrs: type === "danger" ? { role: "alert" } : {} }, [
            icon(TOAST_ICONS[type], "toast-icon"),
            el("div", { className: "toast-body", text: message }),
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
        const { title, sections = [], toolbar, settingsTabs = [], credits = {}, onViewChange } = options;
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
        ]);
        const views = new Map([...sections.map(({ view, element }) => [view, element]), ["settings", settings.view]]);
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
        const update = buildUpdate(settings.pane("update"));
        const dots = [updateDot(settingsItem), updateDot(settings.tab("update"))];
        let toasted = null;
        function showUpdate(status, { pushed = false } = {}) {
            const dot = update.showStatus(status, appName);
            for (const show of dots) show(dot);
            // One toast, when an update downloads by itself while the app is open.
            if (pushed && status.state === "downloaded" && status.auto && toasted !== status.version) {
                toasted = status.version;
                toast(`Version ${status.version} has downloaded and will be installed when you close ${appName}.`);
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
        ui: { mountShell, toast },
        format: {},
        keys: {},
    };
})();
