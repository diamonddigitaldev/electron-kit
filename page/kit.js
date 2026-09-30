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
     * The Settings view: a heading, Bootstrap's tabs (role="tablist", arrow
     * keys, Home and End), and a pane per tab, each keeping its state while
     * hidden.
     * @param {{ id: string, label: string, render: (pane: HTMLElement) => void }[]} tabs
     */
    function buildSettings(tabs) {
        const view = el("section", { className: "settings-view", attrs: { "aria-labelledby": "settings-title" } });
        const tablist = el("ul", { className: "nav nav-tabs", attrs: { role: "tablist", "aria-labelledby": "settings-title" } });
        const panes = el("div", { className: "tab-content settings-panes" });
        view.append(el("h2", { className: "settings-title", text: "Settings", attrs: { id: "settings-title" } }), tablist, panes);

        const buttons = tabs.map(({ id, label }) => {
            const button = el("button", {
                className: "nav-link",
                text: label,
                attrs: { type: "button", role: "tab", id: `settings-tab-${id}`, "aria-controls": `settings-pane-${id}`, "data-tab": id },
            });
            tablist.append(el("li", { className: "nav-item", attrs: { role: "presentation" } }, [button]));
            return button;
        });
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
                button.classList.toggle("active", selected);
                button.setAttribute("aria-selected", String(selected));
                button.tabIndex = selected ? 0 : -1;
                paneOf.get(tabs[i].id).classList.toggle("active", selected);
                paneOf.get(tabs[i].id).classList.toggle("show", selected);
            });
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
        return { view, select, pane: (id) => paneOf.get(id), selected: () => tabs[buttons.findIndex((b) => b.classList.contains("active"))].id };
    }

    /** The Update tab, until the updater arrives: the version running. */
    function fillUpdate(pane, version) {
        pane.replaceChildren(
            el("p", { className: "mb-1", text: `Version ${version}` }),
            el("p", { className: "text-body-secondary small", text: "Update settings arrive here in a later version." }),
        );
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
        const items = [
            ...sections.map(({ view, label, icon: glyph }) => railItem(view, label, glyph)),
            railItem("settings", "Settings", "settings", "nav-settings"),
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
        const ready = Promise.all([
            // The saved state is put in place at once, not animated.
            api?.getSettings().then((saved) => {
                rail.classList.add("nav-rail-instant");
                setCollapsed(saved.navCollapsed === true);
                requestAnimationFrame(() => requestAnimationFrame(() => rail.classList.remove("nav-rail-instant")));
            }),
            api?.getInfo().then((info) => {
                fillUpdate(settings.pane("update"), info.version);
                fillCredits(settings.pane("credits"), info, credits.logo);
            }),
        ]).then(() => {});

        return { showView, showSettings, ready };
    }

    window.kit = {
        ui: { mountShell },
        format: {},
        keys: {},
    };
})();
