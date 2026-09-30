<div align="center">

   # electron-kit

   <p style="margin-bottom:1rem;">The shared design system for Diamond Digital Development's Electron apps.</p>

</div>

<div align="center">

  ![license](https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square)
  ![version](https://img.shields.io/badge/version-0.0.0-lightgrey?style=flat-square)
  ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey?style=flat-square)

  [![discord](https://img.shields.io/discord/667479986214666272?logo=discord&logoColor=white&style=flat-square)](https://diamonddigital.dev/discord)
  [![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee&logoColor=000000&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>

`@diamonddigitaldev/electron-kit` is one npm package that every Diamond Digital Development Electron app
installs. It holds what the apps share: main-process behaviour, a shared preload, page components and
CSS on Bootstrap 5.3, and test helpers. A fix to shared UI or behaviour is made once, here, and each app
takes it with a version bump.

It's in early development and not published to npm yet.

## What It Holds

| Export | What it is |
|---|---|
| `@diamonddigitaldev/electron-kit/main` | `start(config)`, called once at the top of an app's `main.js` |
| `@diamonddigitaldev/electron-kit/preload.js` | the shared bridge, `window.kitAPI`, registered on the app's session by `start()` |
| `@diamonddigitaldev/electron-kit/page/theme.js` | the theme script, loaded in `<head>`: draws the page in the OS theme and follows it |
| `@diamonddigitaldev/electron-kit/page/kit.js` | the page library, `window.kit`, loaded as a classic script: `kit.ui.mountShell()` builds the nav rail, the header and the Settings view |
| `@diamonddigitaldev/electron-kit/css/kit.css` | the shared styles, linked after Bootstrap and before the app's `accent.css` |
| `@diamonddigitaldev/electron-kit/testing` | helpers for an app's tests |

Electron 44 or newer, `electron-updater`, `electron-store`, Bootstrap 5.3 and Material Icons are peer
dependencies: each app installs its own.

### The Shared Preload

An app keeps its own sandboxed preload for its own channels (`window.electronAPI`). `start()` registers
the kit's preload on the app's default session with `session.registerPreloadScript`, so every window in
that session also gets `window.kitAPI`. A window in another session or partition doesn't.

```js
const kit = require("@diamonddigitaldev/electron-kit/main").start({
    settings: { defaults: { overwrite: false } },        // the app's own settings (The Settings)
    credits: {                                           // the Credits tab (Settings and Credits)
        lines: [
            ["Created and maintained by ", { text: "Diamond Digital Development", href: "https://diamonddigital.dev" }, "."],
            "This software is licensed under the Apache 2.0 license.",
        ],
        donate: "https://buymeacoff.ee/willtda",
    },
    menu: { items: [{ label: "Open Files", accelerator: "CmdOrCtrl+O", click: openFiles }] }, // (The Menu)
});

kit.ready.then(() => {
    const win = new BrowserWindow({
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    win.loadFile(path.join(__dirname, "index.html"));
});
```

```html
<link rel="stylesheet" href="../node_modules/bootstrap/dist/css/bootstrap.min.css">
<link rel="stylesheet" href="../node_modules/material-icons/iconfont/round.css">
<link rel="stylesheet" href="../node_modules/@diamonddigitaldev/electron-kit/css/kit.css">
<link rel="stylesheet" href="styles/accent.css">
<link rel="stylesheet" href="styles.css">
<script src="../node_modules/@diamonddigitaldev/electron-kit/page/theme.js"></script>
...
<script src="../node_modules/@diamonddigitaldev/electron-kit/page/kit.js"></script>
```

`window.kitAPI`, `window.electronAPI` and `window.kit` are globals, so a classic script mustn't declare a
top-level `const`, `let`, `function` or `class` of the same name: `const kitAPI = window.kitAPI;` throws
"Identifier 'kitAPI' has already been declared", and the whole script never runs. Give the local another
name (`const kitApi = window.kitAPI;`), or use `window.kitAPI` where it's needed.

### The Shared Channels

| Channel | Kind | `window.kitAPI` |
|---|---|---|
| `app:get-version` | the page asks | `getVersion()`: the app's version |
| `app:get-info` | the page asks | `getInfo()`: `{ name, version, repository, credits: { lines, donate } }`, for the Credits tab |
| `settings:get` | the page asks | `getSettings()`: every setting, the app's and the kit's, over their defaults |
| `settings:set` | the page asks | `setSettings(changes)`: changes some settings (`{ navCollapsed: true }`) and resolves with them all |
| `shell:open-external` | the page asks | `openExternal(url)`: opens an `http(s)` link in the person's browser; anything else is refused |
| `update:get-status` | the page asks | `getUpdateStatus()`: the updater's state (below), without checking |
| `update:check` | the page asks | `checkForUpdates()`: checks now, and resolves with the state once the check is done |
| `update:download` | the page asks | `downloadUpdate()`: downloads the update found, and resolves with the state once it's downloaded or has failed |
| `update:status` | the kit pushes | `onUpdateStatus(callback)`: the updater's state, on each change; to the app's own windows only |
| `theme:changed` | the kit pushes | `onThemeChanged(callback)`: `"dark"` or `"light"` on each change of the OS theme; returns a function that stops listening |
| `view:show` | the kit pushes | `onShowView(callback)`: `{ view, tab }` when the menu asks for a view; `mountShell()` listens for it |

A pushed value reaches the callback on its own, never with the IPC event behind it.

The kit's preload runs in every page of the app's session, so `window.kitAPI` is in any page a window of
it shows: the app's own, but also a page a window is navigated to, or one it opens. So the kit answers the
app's own page only: a `file://` page inside the app's code (`app.getAppPath()`, `app.asar` when packaged),
in the app's default session. Every shared handler makes that check before it runs, and any other sender's
call rejects:

```
Error invoking remote method 'app:get-version': Error: electron-kit answers "app:get-version" for the app's own page only.
```

### The App's Own Channels

The app's own preload is no safer: a window of the app that's navigated away still has
`window.electronAPI`. So the app answers its own channels through `kit.ipc.handle()`, which makes the same
check as the shared handlers, instead of `ipcMain.handle()`:

```js
const kit = require("@diamonddigitaldev/electron-kit/main").start({ /* … */ });

kit.ipc.handle("job:run", (_event, spec) => runJob(spec));      // an async answer
kit.ipc.handle("job:cancel", (_event, jobId) => cancel(jobId)); // an answer at once
kit.ipc.handle("queue:cancel-all", () => { cancelAll(); });     // no answer
```

It works as `ipcMain.handle()` does: the handler gets the event and the page's arguments as they came,
what it returns (or resolves with) is the answer, and what it throws (or rejects with) is the page's
error. Any other sender's call is refused before the handler runs:

```
Error invoking remote method 'job:run': Error: "job:run" is answered for the app's own page only.
```

It throws as the app registers a channel that isn't `domain:action` (lower case, words joined by `-`), one
of the kit's shared channels above, or one that already has a handler. For now it answers the UI session
only: a window in a session or partition of its own is refused, so a channel only such a window asks is
still the app's to answer itself.

### The Shell

`kit.ui.mountShell()` builds the app's frame around its own sections: the nav rail (the app's sections,
then **Settings** above **Collapse**), the header (the title and the app's toolbar), and the Settings view.
Each section is one element in the app's `index.html`, which the kit moves into place:

```js
const shell = kit.ui.mountShell({
    title:    "Diamond File Converter",
    sections: [{ view: "convert", label: "Convert", icon: "swap_horiz", element: document.getElementById("convert-view") }],
    toolbar:  document.getElementById("toolbar"),     // the header's controls, shared by every section
    settingsTabs: [{ id: "general", label: "General", render: (pane) => { /* the app's own settings */ } }],
    credits:  { logo: "assets/logo.png" },             // beside the app's name on the Credits tab
    onViewChange: (view) => {},
});
await shell.ready;                                     // the saved settings and the Credits tab are in
shell.showView("convert");                             // or shell.showSettings("update", { focus: true })
```

```
.app-frame                    the whole window
├── nav#nav-rail.nav-rail     the app's sections, then Settings, then Collapse
└── .app-shell[data-view]     the header, then main.app-content, holding each view
```

- One view shows at a time. The active rail item has `.active` and `aria-current="page"`, and is drawn in
  the accent's text shade, which meets 4.5:1 on the rail in both themes (the fill doesn't, for any app). A
  hidden view keeps its state; the kit hides it with a class of its own, so it never competes with the
  app's `d-none`.
- **Collapse** has `aria-expanded` and is remembered (`navCollapsed`, in the settings). Collapsed, the
  labels are hidden visually but stay each item's accessible name, and become its tooltip. Every Material
  Icons glyph is `aria-hidden`.
- The shared markup is built with `createElement` and `textContent`, never HTML strings.

### Settings and Credits

The Settings view has tabs across the top (`role="tablist"`; the arrow keys, Home and End move between
them, and only the selected tab is in the Tab order): the app's own tabs, then **Update**, then
**Credits**, always last. They're plain text on a thin line, the selected one darker, with a thicker bar in
the accent's fill under it that slides to the next tab chosen and takes its text's width. There's no save button anywhere: a tab keeps each change through
`setSettings()` as it's made. It's reached from the rail, and from the menu's `Settings` (`CmdOrCtrl+,`),
which puts focus on the selected tab.

**Update**, top to bottom: the app's name and version; `Check for Updates` (disabled while a check or
download runs, or with no updater), with a status line under it (`role="status"`, its height kept) and
`Download Update` when there's an update to download; the `Download updates automatically` switch, on by
default; and the `Update channel`, `Stable`, `Beta` or `Alpha`, each with its help line. Each change is kept
as it's made, and a new channel checks again. The menu's `Check for Updates` opens this tab and runs a check.
While an update waits (`dot` in the updater's state), a **yellow dot** shows on the rail's Settings item (at
its end, or on the corner of its glyph when the rail is collapsed) and on the Update tab. Its ring holds 3:1
on the light rail, where the yellow alone is 1.55:1, and "Update available" becomes part of the item's and the
tab's names. When an update downloads by itself, one toast says so. The updater itself is under
[Updates](#updates). **Credits** replaces the old Credits
window: the logo, the app's name and version, the `•` credit lines, then the donate line and `Donate on Buy
Me a Coffee` and `View Source Code on GitHub`, all from `app:get-info`. The version is Electron's (the app's `package.json`),
and so is the name unless `start({ name })` gives one: an app whose `package.json` `name` is its npm name
(`diamond-file-converter`) passes its own, since a top-level `productName` would move its `userData` folder
and every saved setting with it; the repository is `start({ repository })`, or else the `package.json`'s. Each
credit line is a sentence, or a list of parts with links as `{ text, href }`. Every link and button opens
through `shell:open-external`, which opens `http(s)` links only; the page never follows a link itself.
`start()` checks the credits and throws on a link that isn't `http(s)`, so a mistake shows at launch.

### Toasts

`kit.ui.toast(message, { type, timeout })` shows something the person should know but not answer, under the
header: `type` is `"info"` (the default), `"success"`, `"warning"` or `"danger"`, each filled with its colour
and text that holds AA on it, with its glyph and a `Dismiss` button. It closes itself after `--timing-toast`
(4.5 s), or `timeout` ms (`0` keeps it until it's dismissed), and returns `{ element, close() }`. The message
is text, never markup. The host is a polite live region; a danger toast is `role="alert"`. It slides in and
out over `--dur-state`, at once under reduced motion.

### The Settings

`start({ settings: { defaults } })` gives the app's own settings and their defaults. They're kept by
`electron-store`, under one `settings` key in its default file (`config.json` in the app's `userData`
folder), beside the kit's own: `navCollapsed`, off; `autoDownloadUpdates`, on; and `updateChannel`,
`"stable"`, `"beta"` or `"alpha"`, `null` until the updater saves the running build's own. What's stored is read over the defaults, so a setting
added later appears with its default, and a stored value of the wrong kind is never handed out. A change
must name a known setting and keep its kind (a boolean stays a boolean, a list a list), with JSON values
only, or it's refused and nothing is stored. A setting whose default is `null` means "not chosen yet", and
takes any JSON value (File Converter's `concurrency: null`, the CPU count until someone picks one). The main process has the same settings as
`kit.settings.get()` and `kit.settings.set(changes)`. Migration between versions comes later.

### Updates

`start({ updates: {} })` gives the app an updater: electron-updater, from the update server
electron-builder wrote into the app (its `publish` config). Without `updates` there's none, and nothing is
checked. With it, it runs **only in a packaged app** (`app.isPackaged`; electron-updater isn't even loaded
otherwise), and checks **only when the app says so**: 5 seconds after launch (`updates: { checkOnLaunch:
false }` turns that off), and whenever the page asks (`checkForUpdates()`). It makes no other request.

- **Channels:** `stable` offers finished releases only (electron-updater's `latest`), `beta` betas too, and
  `alpha` anything. With no channel saved, the updater saves the running build's own when it starts (an
  `-alpha` build `alpha`, a `-beta` build `beta`, anything else `stable`); from then on the saved choice
  wins, whatever version an update brings. Changing it checks again.
- **Every update found must pass the kit's own check** (`isOfferableUpdate(candidate, current, channel)`):
  strictly newer, and in the channel. So a release mis-tagged on the server never reaches `stable`, and
  nothing older is ever offered: someone who moves from `alpha` to `stable` keeps their alpha until a newer
  finished release. electron-updater never downloads by itself (`autoDownload` is off), and its `channel` is
  set before `allowDowngrade = false`, because its channel setter turns downgrades back on.
- **Automatic downloads** (`autoDownloadUpdates`, on by default): an update found downloads at once, and
  is installed when the app quits (`autoInstallOnAppQuit`). Off, the update dot shows, and the page offers
  `downloadUpdate()`. The dot stays until the app runs the new version, and shows too when a download fails.
  Turning it on downloads an update waiting. Moving to a channel that wouldn't offer an update already
  downloaded keeps it from being installed.
- **No ID of the install is sent.** electron-updater sends a random ID with every request
  (`x-user-staging-id`), for staged rollouts; the kit sends `00000000-0000-0000-0000-000000000000` instead.
  electron-updater still keeps its own in `userData` (`.updaterId`), but it never leaves the machine.

The state, from `getUpdateStatus()` and `onUpdateStatus()`:

| Field | What it is |
|---|---|
| `state` | `"unavailable"`, `"idle"`, `"checking"`, `"none"` (up to date), `"available"`, `"downloading"`, `"downloaded"` or `"error"` |
| `reason` | for `"unavailable"`: `"off"` (no `updates` option) or `"not-packaged"` (run from source) |
| `error` | for `"error"`: `"check"` or `"download"` |
| `version` | the update found, or `null` |
| `percent` | the download's, 0–100, or `null` |
| `dot` | whether the update dot shows |
| `auto` | whether it downloaded by itself (the page shows a toast then) |
| `current`, `channel` | the version running, and the channel in use |

The version rules are `require("@diamonddigitaldev/electron-kit/main").version` (`parse`, `compare`,
`channelOf`, `isOfferableUpdate` and the rest), for an app's own use.

### Building

An app's electron-builder config extends the kit's, in its `package.json`:

```json
"build": {
    "extends": "@diamonddigitaldev/electron-kit/builder/base.json",
    "appId": "com.diamonddigitaldev.<app>",
    "productName": "<App>",
    "publish": { "provider": "github", "owner": "diamonddigitaldev", "repo": "<App>" }
}
```

`builder/base.json` gives every app the same builds: NSIS on Windows, in the Start menu's `Diamond
Digital Development` folder; AppImage, `.deb` and `.rpm` on Linux, built on Linux; and
`generateUpdatesFilesForAllChannels`, so each release carries the update file of every channel it belongs
to (a finished release `latest.yml`, `beta.yml` and `alpha.yml`; a beta `beta.yml` and `alpha.yml`; an
alpha `alpha.yml`; each with `-linux` for Linux). **Never attach `latest.yml` to a pre-release**, or it's
offered to everyone on Stable. The app gives its own identity, files, icons, file associations and
`publish` (where the updater looks).

electron-builder merges `extends` deeply (checked in its source, 26.15): objects key by key, with the
app's values winning, and **lists joined, never replaced**. So an app can add a target to the base's lists,
but can't take one away; the base holds only what every app ships. A `.deb` or `.rpm` names its maintainer
from `package.json`'s `author` email, unless `build.linux.maintainer` gives one. An app's tests check
the config with `assertBuildExtendsKit(require("../package.json"))` from `electron-kit/testing`.

### The Menu

`start()` sets the house menu: one top-level `Menu`, with the app's own items (`start({ menu: { items }
})`) first:

```
Menu
  <the app's items>
  ──────────
  Settings                 CmdOrCtrl+,
  Check for Updates        (opens Settings > Update)
  ──────────
  Toggle Developer Tools   F12        (pre-releases only: a version with a "-")
  ──────────
  Exit                     Alt+F4
```

There's no Credits item: Credits is the last tab of Settings. The menu is the main window's: a secondary
window, if an app has one, calls `win.removeMenu()`, or on Windows and Linux it shows the same `Menu` bar. On macOS the app's own menu comes first,
with Quit in it. **Every accelerator needs a modifier other than Shift, or is a function key**: Electron
registers a menu's accelerators for the whole window, text fields included, so a bare `C` (or `Shift+C`)
would take that letter from everything typed. `start()` throws on a menu that breaks the rule, and an
app's tests can check its template:

```js
const { assertNoBareAccelerators } = require("@diamonddigitaldev/electron-kit/testing");

assertNoBareAccelerators(template);   // fails, naming each item with a bare accelerator
```

To press an accelerator in a Playwright test, send the key through `webContents.sendInputEvent()` from
main: Playwright's own keyboard goes through DevTools, which never hands a key on to the menu.

### The Theme

`theme.js` goes in `<head>`, after the stylesheets, as a plain script (not `async`, `defer` or a module).
It stamps `data-bs-theme`, `"dark"` or `"light"`, on `<html>` from `prefers-color-scheme` before the body
parses, so the first paint is already in the OS theme. Then it follows the OS theme two ways, and applies
whichever change arrives first: the media query's change, and `start()`'s `theme:changed` push, which the
main process sends every window from `nativeTheme`. The push is there because the media query's change
doesn't always reach the page: on real Windows, an app once stayed dark after Windows switched to Light.
The page needs no code of its own for either, and a window without `window.kitAPI` follows the media
query alone.

To test it, switch the theme as the OS does, with `nativeTheme.themeSource` set from the main process, or
emulate the media query with `page.emulateMedia({ colorScheme })`. Playwright's `_electron.launch()` holds
every page's `prefers-color-scheme` at light unless it's given `colorScheme: null`.

### The Accent

The accent is the only thing that differs between the apps. Each app's `src/styles/accent.css` sets its
eight values in one `:root` block, and `kit.css` reads nothing else of the app's:

```css
:root {
    --accent:            #0d6efd;      /* the fill: primary buttons, progress, checked boxes */
    --accent-hover:      #0b5ed7;      /* the fill, hovered or pressed */
    --accent-rgb:        13, 110, 253; /* --accent as r, g, b, for the washes */
    --accent-contrast:   #fff;         /* text and icons on the fill */
    --accent-text-light: #0a58ca;      /* accent text, and links on hover, in each theme */
    --accent-text-dark:  #8bb9fe;
    --accent-link-light: #0d6efd;      /* links, in each theme */
    --accent-link-dark:  #6ea8fe;
}
```

`kit.css` gives the theme's pair as `var(--accent-text)` and `var(--accent-link)`, so an app never writes
theme selectors. Every pairing meets WCAG 2.2 AA in both themes (4.5:1 for text, 3:1 for the parts of a
control) on Bootstrap's page and nav rail surfaces, including the rail's active item under its accent
wash. An app's tests check its own file:

```js
const { assertAccentContrast } = require("@diamonddigitaldev/electron-kit/testing");

test("the accent meets WCAG 2.2 AA in both themes", () => {
    assertAccentContrast("src/styles/accent.css");
});
```

A failure names each pairing under AA and its ratio. For a new accent, the shades that pass follow
Bootstrap's own link rules: the brand colour as the light link if it passes on white, or else the least
shade of it that does; the light text shade 20% darker; the dark link the brand tinted 40%; the dark text
shade 20% lighter again. White on the fill needs 4.5:1, so the hover goes darker, not lighter.

### Tokens

`kit.css` holds the house tokens: motion (`--dur-micro`, `--dur-state`, `--dur-default`, `--dur-enter`,
`--dur-ambient` and the `--ease-*` curves, `--ease-spring` among them), the wash ladder (`--wash-*`, alphas for
`rgba(var(--accent-rgb), …)`), radii (`--radius-*`), opacity (`--opacity-disabled`, `--opacity-muted`), the
timings the JS side shares (`--timing-*`), the focus ring (`--focus-ring-width`, `--focus-ring-offset`) and
the scrollbar. It binds the accent into Bootstrap's primary (`--bs-primary`, `.btn-primary`, links and
`.progress`) and its form controls: a checked box or switch is the fill.

### Focus Rings and Controls

Bootstrap draws focus as a soft glow, a quarter-opaque ring, which is well under the 3:1 a focus indicator
needs. `kit.css` draws every focus ring as a solid 2px ring in the accent's text shade instead (keyboard
focus only, except in a text field or a select), over 4.5:1 on the page and the rail in both themes.

Checkboxes and switches are drawn by the kit rather than by Bootstrap's still images. A box someone ticks
fills with the accent and its tick is drawn, short stroke then long (`kit.js` asks for the drawing on the
change a person makes, so a box checked by the page, or shown again, has its tick there already), and
unticked, the tick springs away; a switch's knob slides across with a little overshoot and
stretches while it's pressed; both give a little when pressed, and their border takes the accent's text
shade on hover. Unchecked, they're drawn in the secondary text colour, not Bootstrap's 1.3:1 border colour,
so their outline meets 3:1 too. All of it is timed by the `--dur-*` tokens and the `--ease-spring` curve,
so reduced motion stills it. The rail's icons sit on whole pixels, centred in each item when collapsed.

Under `prefers-reduced-motion: reduce`, the `--dur-*` tokens go to 0.01ms, so anything timed by them
finishes at once, and `--dur-ambient` goes to 0s, which stops a pulse rather than making it flicker.

## Development

Node.js 24 or newer.

```bash
npm install
npm test            # unit and contract tests (node --test)
npm run test:e2e    # real-Electron tests and axe: Playwright drives demo/
npm run demo        # launch the demo app
```

`demo/` is a small Electron app on the kit. It installs the kit as a packed copy, the way an app gets it
from npm; `npm run demo` and `npm run test:e2e` refresh that copy first.

### Visual Tests

`e2e/visual.spec.js` compares the demo's window with committed images, in
`e2e/visual.spec.js-snapshots/`, using Playwright's `toHaveScreenshot()`. It takes 26 images:

| State | Accents | Themes |
|---|---|---|
| Settings on its General, Update and Credits tabs | the demo's | light and dark |
| Controls at rest (the box ticked, the switch off) | the demo's | light and dark |
| Controls toggled by keyboard (the box unticked, the switch on and focused) | the demo's and each app's | light and dark |
| The rail expanded, Overview active and Controls focused by keyboard | the demo's and each app's | light and dark |
| The rail collapsed, the same | the demo's | light and dark |

The app accents are the ones in `test/fixtures/accents/`. The page is 760 × 600 at a scale factor of 1, drawn without the GPU, as on the runner, which has none.
Motion is reduced, so every transition ends at once. The caret is hidden and the mouse is parked. The
pulse dot and the Electron version are masked. A pixel counts as changed past a colour difference of
0.02, not Playwright's 0.2, which would let a shade of the accent pass for another.

The images are Windows' (Segoe UI, as most people see the apps), so the spec runs on Windows only and
skips on Linux. CI runs it on pull requests, unpackaged and against the packaged demo. The images are
made on a Windows CI runner, never on a developer's machine, and a run never writes one unless asked.
Without the GPU, a Windows machine draws exactly what the runner does, so the spec passes locally too.

When a visual test fails in CI, the run uploads `visual-differences-<attempt>`, a workflow artifact
kept 3 days. For each image that changed, it holds what was expected, what was drawn and the difference.

When the look changes on purpose, or a state is added, update the baselines:

1. Push the branch.
2. Run the CI workflow by hand on that branch, with the images updated:
   `gh workflow run ci.yml --ref <branch> -f update-visual-baselines=true`. The same form is under
   Actions > CI > Run workflow.
3. When it's done, download the images to a folder of their own, then copy them over the committed ones
   (`gh run download` won't overwrite a file that's there):
   `gh run download <run id> -n visual-baselines -D <new folder>`, then
   `cp <new folder>/*.png e2e/visual.spec.js-snapshots/`.
4. Look at every changed image (`git diff --stat`, then open them), and commit only the changes you meant.

The artifact is kept 3 days.

## License

electron-kit is licensed under the Apache 2.0 License. See the [LICENSE](LICENSE) file for details.

## Acknowledgements

- Built with [Electron](https://www.electronjs.org/) and [Bootstrap](https://getbootstrap.com/)
- Icons from [Material Icons](https://fonts.google.com/icons)

### AI Disclosure

This project uses AI tools to aid development. Read our [AI Transparency & Quality Commitment](https://diamonddigital.dev/ai-transparency) statement for more information.

## Contact Us

- Need help or want to chat? [Join our Discord Server](https://diamonddigital.dev/discord)!
- Found a bug? [Open an issue](https://github.com/diamonddigitaldev/electron-kit/issues) on our GitHub repository.
- Have a feature request? [Submit it here](https://github.com/diamonddigitaldev/electron-kit/issues/new?labels=enhancement)!

---

<div align="center">
  <a href="https://diamonddigital.dev/">
  <strong>Created and maintained by</strong>
  <img align="center" alt="Diamond Digital Development Logo" src="https://diamonddigital.dev/img/png/ddd_logo_text_transparent.png" style="width:25%;height:auto" /></a>
</div>
