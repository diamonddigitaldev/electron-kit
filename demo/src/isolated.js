"use strict";

// The isolated window's page: it shows which bridges it has, then marks the
// page ready (body[data-ready]), which the tests wait for.

(async () => {
    const $ = (id) => document.getElementById(id);
    $("kit-api").textContent = window.kitAPI ? "Present (it shouldn't be)" : "Absent";
    try {
        $("electron-api").textContent = window.electronAPI ? `Electron ${await window.electronAPI.getElectronVersion()}` : "Missing";
    } catch (err) {
        $("electron-api").textContent = `Failed: ${err.message}`;
    }
    document.body.dataset.ready = "true";
})();
