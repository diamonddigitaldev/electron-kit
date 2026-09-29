"use strict";

// electron-kit's page library, loaded as a classic script from node_modules:
//
//     <script src="../node_modules/@diamonddigitaldev/electron-kit/page/kit.js"></script>
//
// It sets one global, window.kit, and has no import or export, so it works in a
// classic-script page and beside a module page alike (load it first). The
// shared components (kit.ui), the format helpers (kit.format) and the key
// guard (kit.keys) fill these namespaces piece by piece.

(() => {
    if (window.kit) return;

    window.kit = {
        ui: {},
        format: {},
        keys: {},
    };
})();
