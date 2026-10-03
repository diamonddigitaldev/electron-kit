"use strict";

// The demo's electron-builder config, from the kit's config(): the kit's base
// config, the asking installer and its Linux .desktop file. The demo opens
// text files and has a right-click entry, so its installer asks about both,
// which CI installs and reads back out of the registry, and its .desktop file
// lists their MIME types, which CI reads back out of its .deb.

const { config } = require("@diamonddigitaldev/electron-kit/builder");

module.exports = config(require("./package.json"), {
    build: {
        appId: "com.diamonddigitaldev.electronkitdemo",
        productName: "electron-kit Demo",
        artifactName: "electron-kit-Demo-${version}.${ext}",
        files: ["src/**/*"],
        // Its packaged tests run this update server.
        publish: { provider: "generic", url: "http://127.0.0.1:47613/" },
        linux: { category: "Development" },
    },
    fileTypes: [{ name: "Text File", ext: ["txt", "md"] }],
    contextMenu: { label: "Open with electron-kit Demo", folders: true },
});
