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
    // One test at a time in CI. Each test launches the demo, and on Linux every
    // window shares one Xvfb display; two at once fail to launch, or mix up
    // which app looked what up. The private repository's runners had two CPUs,
    // so Playwright chose one worker by itself; a public repository's have four,
    // and it chose two, which failed on Ubuntu from the first run.
    workers: process.env.CI ? 1 : undefined,
    // The visual spec's baselines come from a Windows CI runner (docs/development.md), so a run never
    // writes one unless it's asked to with --update-snapshots.
    updateSnapshots: "none",
    // A flaky test gets fixed, not retried.
    retries: 0,
    // One line per test, with its name, in the terminal and the CI log.
    reporter: "list",
    timeout: 60_000,
});
