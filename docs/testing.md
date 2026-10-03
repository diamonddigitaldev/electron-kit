# Testing an App

The helpers in `@diamonddigitaldev/electron-kit/testing` for an app's own tests: nothing reached beyond the machine, the preload, the menu, the accent and the build config.

[All the docs](README.md)

## Nothing Reached Beyond the Machine

An app on the kit makes no network request the person didn't ask for, and its tests can prove it. Chromium
writes down everything its network stack does in a net log; launch the app with `netLogSwitches()`, and once
it has quit, `assertNoOutsideLookups()` reads the log and fails on any name looked up beyond this machine, or
any search for a proxy:

```js
const { _electron: electron, test } = require("@playwright/test");
const { netLogSwitches, assertNoOutsideLookups } = require("@diamonddigitaldev/electron-kit/testing");

test("the app starts without reaching beyond the machine", async ({}, testInfo) => {
    const netLog = testInfo.outputPath("netlog.json");
    const app = await electron.launch({ args: [...netLogSwitches(netLog), `--user-data-dir=${testInfo.outputPath("profile")}`, "."] });
    // … the test …
    await app.close();                  // the log is complete once the app has quit
    assertNoOutsideLookups(netLog);
});
```

- `netLogSwitches(file)` is `--no-proxy-server`, so the app never searches the network for a proxy (on a
  network with WPAD, that search goes out to it), and `--log-net-log=<file>`.
- `assertNoOutsideLookups(file, { allow })` fails, naming each, on a DNS lookup of any name that isn't this
  machine's own (loopback or `localhost`; a `.local` name counts, since its lookup goes out by multicast), and on
  proxy settings that auto-detect or name a proxy script, a proxy script search, or a lookup of `wpad`. `allow`
  lists the names a test looks up on purpose, as text or a regular expression.
- `outsideLookups(file, { allow })` and `proxyLookups(file)` give the same as lists of lines, for a soft check
  or a test's report: a fixture can check every launch's log as the test ends.

A log is read a line at a time, so one cut short (an app that was killed) still reads; an empty one (a second
launch that handed its files over and quit before its network stack started) has nothing in it; a missing
one is reported, since there's then nothing to tell from. Only names and settings are read, never a request or
an answer.

The kit's own tests check every launch of its demo this way, on Windows and Linux. That's how they found
Linux's spell checker downloading dictionaries from Google, which the kit now stops
([The Main Process](main-process.md#the-main-window)).

## The Other Helpers

| Helper | What it checks | Where it's explained |
|---|---|---|
| `loadPreload(file)` | runs the app's preload as a sandboxed renderer would, with only `electron`, `events`, `timers` and `url` to require, and returns what it required, exposed and sent | below |
| `assertNoBareAccelerators(template)` | no menu item takes a letter from every text field | [The Main Process](main-process.md#the-menu) |
| `assertAccentContrast(file)` | the app's accent meets WCAG 2.2 AA in both themes | [Theme, Accent and Tokens](theming.md) |
| `assertBuildExtendsKit(config)` | the app's electron-builder config (`require("../electron-builder.cjs")`) extends the kit's, and keeps the update files on | [Building](building.md) |

`loadPreload()` catches a preload that isn't self-contained (a sandboxed preload that requires anything else
leaves its bridge undefined, with no error in main), and lets a test check each bridge call's channel:

```js
const { loadPreload } = require("@diamonddigitaldev/electron-kit/testing");

const { exposed, calls } = loadPreload("src/preload.js");
await exposed.electronAPI.runJob({ id: 1 });
assert.deepEqual(calls.at(-1), { method: "invoke", channel: "job:run", args: [{ id: 1 }] });
```
