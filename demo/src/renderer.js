"use strict";

// The demo's page: kit.ui.mountShell() builds the frame around its two
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

/**
 * The demo's own Settings tab: one setting of its own, kept through the kit's
 * settings:set as it's changed, with no save button.
 */
function renderGeneral(pane) {
    pane.innerHTML = `
        <div class="form-check form-switch">
            <input id="show-accent-sample" class="form-check-input" type="checkbox" role="switch">
            <label class="form-check-label" for="show-accent-sample">Show the accent sample</label>
        </div>
        <div class="form-text">On the Overview section.</div>`;
    const toggle = $("show-accent-sample");
    toggle.addEventListener("change", async () => {
        applySettings(await window.kitAPI.setSettings({ showAccentSample: toggle.checked }));
    });
}

/** Put the demo's settings in place. */
function applySettings(settings) {
    $("show-accent-sample").checked = settings.showAccentSample;
    $("accent-sample").classList.toggle("d-none", !settings.showAccentSample);
}

// The files the demo is opened with, kept for the tests (it shows none).
window.filesOpened = [];
window.kitAPI?.onFilesOpened((paths) => window.filesOpened.push(paths));

async function init() {
    showTheme();
    const shell = window.kit.ui.mountShell({
        title: "electron-kit Demo",
        sections: [
            { view: "overview", label: "Overview", icon: "dashboard", element: $("overview-view") },
            { view: "controls", label: "Controls", icon: "tune", element: $("controls-view") },
        ],
        toolbar: $("toolbar"),
        settingsTabs: [{ id: "general", label: "General", render: renderGeneral }],
        credits: { logo: "assets/logo.svg" },
    });

    await Promise.all([
        shell.ready,
        window.kitAPI.getSettings().then(applySettings),
        show("kit-api", async () => (window.kitAPI ? `App version ${await window.kitAPI.getVersion()}` : "Missing")),
        show("electron-api", async () => (window.electronAPI ? `Electron ${await window.electronAPI.getElectronVersion()}` : "Missing")),
        show("sandboxed", () => (window.electronAPI?.sandboxed ? "Yes" : "No")),
        show("kit-js", () => (window.kit ? "Loaded" : "Missing")),
        // A token only kit.css sets.
        show("kit-css", () => (getComputedStyle(document.documentElement).getPropertyValue("--radius-card").trim() === "8px" ? "Loaded" : "Missing")),
    ]);

    $("open-isolated").addEventListener("click", () => window.electronAPI.openIsolatedWindow());
    document.body.dataset.ready = "true";
}

init();
