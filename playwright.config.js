"use strict";

const { defineConfig } = require("@playwright/test");

// electron-kit's real-Electron tests: Playwright's _electron driving demo/
// (e2e/helpers/demo.js). No browsers are used, so none are installed. Each
// test launches its own run of the demo with its own throwaway profile, so
// tests can run side by side.
module.exports = defineConfig({
    testDir: "e2e",
    testMatch: "**/*.spec.js",
    // The demo's copy of the kit is refreshed first, so the tests drive the kit as it is now.
    globalSetup: require.resolve("./e2e/global-setup"),
    forbidOnly: Boolean(process.env.CI),
    // A flaky test gets fixed, not retried.
    retries: 0,
    // One line per test, with its name, in the terminal and the CI log.
    reporter: "list",
    timeout: 60_000,
});
