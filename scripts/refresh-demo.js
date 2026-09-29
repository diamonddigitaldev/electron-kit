"use strict";

// Put the kit's current files in demo/node_modules, and install the demo's
// other dependencies if they aren't there yet.
//
// The demo installs the kit as a packed copy (demo/.npmrc), the way an app gets
// it from npm. npm doesn't refresh that copy while the kit's version stays the
// same, so without this the demo, and the tests that drive it, would run
// whatever copy was installed last. Removing the copy and installing again
// takes a couple of seconds.
//
// Run before `npm run demo` and before every unpackaged run of the Electron
// tests (playwright.config.js).

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEMO_DIR = path.join(__dirname, "..", "demo");
const KIT_COPY = path.join(DEMO_DIR, "node_modules", "@diamonddigitaldev", "electron-kit");

function refreshDemo() {
    fs.rmSync(KIT_COPY, { recursive: true, force: true });
    execSync("npm install --no-audit --no-fund", { cwd: DEMO_DIR, stdio: "inherit" });
}

module.exports = { refreshDemo };

if (require.main === module) refreshDemo();
