"use strict";

// The demo's page: it shows what each bridge and each of the kit's page files
// gave it, then marks the page ready (body[data-ready]), which the tests wait for.

const $ = (id) => document.getElementById(id);

/** Show a check's result in its row, or what went wrong. */
async function show(id, check) {
    try {
        $(id).textContent = await check();
    } catch (err) {
        $(id).textContent = `Failed: ${err.message}`;
    }
}

async function init() {
    await Promise.all([
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
