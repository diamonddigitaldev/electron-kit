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
| `@diamonddigitaldev/electron-kit/page/kit.js` | the page library, `window.kit`, loaded as a classic script: `kit.ui.mountShell()` builds the nav rail, the header and the Settings view; `kit.ui.toast()`, `kit.ui.confirm()`, the parts of a section of files, `kit.keys` and `kit.format` |
| `@diamonddigitaldev/electron-kit/css/kit.css` | the shared styles, linked after Bootstrap and before the app's `accent.css` |
| `@diamonddigitaldev/electron-kit/format` | `kit.format` under Node, for a file loaded both in the page and under Node |
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

kit.ready.then(() => kit.windows.createMain({                 // (The Main Window)
    page: path.join(__dirname, "index.html"),
    size: { width: 1100, height: 780 },
    webPreferences: { preload: path.join(__dirname, "preload.js") },
}));
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
| `files:opened` | the kit pushes | `onFilesOpened(callback)`: the files the app was asked to open, as a list of paths (with `start({ files: true })`) |

A pushed value reaches the callback on its own, never with the IPC event behind it.
`kitAPI.getPathForFile(file)` asks no channel: it's Electron's `webUtils`, in the page, and gives a dropped
`File`'s path on disk (`""` for one that isn't on disk). `kit.ui.dropZone()` uses it.

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
    toolbar:  document.getElementById("toolbar"),     // the header's controls, shared by every section, hidden on Settings
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
- The toolbar is for the app's sections, so it's hidden on Settings (still taking its room, so the header
  doesn't move), and out of the Tab order there.
- The shared markup is built with `createElement` and `textContent`, never HTML strings.

### Settings and Credits

The Settings view has tabs across the top (`role="tablist"`; the arrow keys, Home and End move between
them, and only the selected tab is in the Tab order): the app's own tabs, then **Update**, then
**Credits**, always last. They're plain text on a thin line, the selected one darker, with a thicker bar in
the accent's fill under it that slides to the next tab chosen and takes its text's width. There's no save button anywhere: a tab keeps each change through
`setSettings()` as it's made. It's reached from the rail, and from the menu's `Settings` (`CmdOrCtrl+,`),
which puts focus on the selected tab.

**Update** is two cards in a readable column (36rem at most). The first is headed with the version running
(`Version 2.0.0`), then a status line (`role="status"`, its height kept), then `Check for Updates` (disabled
while a check or download runs, or with no updater) and, when there's an update to download, `Download
Update` beside it. In "Version x is available.", "Version x" is a link to that release's page on GitHub,
opened in the browser. "Checking for updates…" shows for a second at least, so a check that fails at once still
looks pressed. A failed check says why, in Bootstrap's warning shade (it passes): "You seem to be offline.",
"The newest release has no update files yet." or "Try again later."; a failed download is in the danger
shade. The second card, **Preferences**, holds the `Download updates automatically` switch, on by default,
whose help says what it does on and what it does off, and the `Update channel`, `Stable`, `Beta` or
`Alpha`, each with its help line. Each change is kept as it's made, and a new channel checks again. The menu's `Check for Updates` opens this tab and runs a check.
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

`kit.ui.toast(message, { type, timeout, action })` shows something the person should know but not answer, under
the header: `type` is `"info"` (the default), `"success"`, `"warning"` or `"danger"`, each filled with its colour
and text that holds AA on it, with its glyph and a `Dismiss` button. It closes itself after `--timing-toast`
(4.5 s), or `timeout` ms (`0` keeps it until it's dismissed), and returns `{ element, close() }`. The message
is text, never markup. The host is a polite live region; a danger toast is `role="alert"`. It slides in and
out over `--dur-state`, at once under reduced motion.

An `action` puts a button in the message that shows a list under it, and `Hide` hides it again, for a toast
with more to say than a sentence (the files a drop skipped, and why):

```js
kit.ui.toast("Added 12 files, skipped 2.", {
    type: "warning",
    action: { label: "Show Them", items: () => skipped.map((s) => ({ name: s.file, note: "not a supported format" })) },
});
```

`items()` is called once, when the button is first pressed, and returns the rows: text, or `{ name, note }`,
shown as the name in bold (the one part that can be selected and copied) and ` — note`. The list shows the
first 50 and then says how many more there are. It scrolls past 12rem and takes the keyboard's focus to
scroll. The button has `aria-expanded`, and the list isn't read out as it opens. A toast with an action stays
until it's dismissed, unless it's given a `timeout`.

### Prompts

`kit.ui.confirm(options)` asks a question only the person can answer, in a modal over the page, and resolves
with the answer. It's drawn as Dropgate's Upload Security Warning, a Bootstrap centred modal, is: the glyph
beside the title (in a warning's or a danger's colour for those), the body in the page's text, an optional
`detail` under it in small grey text, Cancel a filled grey button, and Bootstrap's spacing, sliding down into
place. It's a native modal `<dialog>` (`role="alertdialog"`), so it needs no Bootstrap script: the page behind can't be reached while it's open, Tab stays inside it,
and the focus goes back to what had it once it closes. Prompts are asked one at a time: one asked while
another shows waits until that one is answered. Everything in it is text, never markup.

```js
const ok = await kit.ui.confirm({
    title: "Large Frame Export",                // Title Case
    body: `This writes about ${n} images.`,
    detail: "Narrow the range if that's more than you meant.",   // optional
    confirmLabel: "Write Them",                 // "Confirm" if not given; cancelLabel is "Cancel"
    variant: "warning",                         // the confirm button's: "primary" if not given
    icon: "burst_mode",                         // "help_outline" if not given
});
```

It resolves `true` on the confirm button, and `false` every other way out: Cancel (first, on the left, `btn-secondary`),
Escape, the backdrop or the close button. The focus starts on the confirm button, or on Cancel when the
variant is `warning` or `danger`.

**The batch form** is for a question asked of each item in a batch, as when an output already exists:

```js
const { choice, all } = await kit.ui.confirm({
    title: "File Already Exists",
    body: `${name} already exists.`,
    choices: [
        { value: "cancelAll", label: "Cancel All" },
        { value: "skip", label: "Skip This File" },
        { value: "overwrite", label: "Overwrite" },
        { value: "unique", label: "Save as New" },
    ],
    cancel: "cancelAll",        // what Escape, the backdrop and the close button answer: the first choice if not given
    defaultChoice: "unique",    // takes the focus, as btn-primary: the last choice if not given
    applyToAll: true,           // an "Apply to All Remaining" checkbox, or its label as text
});
```

It resolves `{ choice, all }`: the value of the choice made, and whether the box was ticked (it starts
unticked each time). Each choice is `btn-secondary` unless it names its `variant` (`primary`,
`secondary`, `success`, `warning`, `danger`, `outline-secondary` or `outline-danger`). What the answers mean
for the batch, such as a Cancel All ending the prompts still to come, is the app's. A mistake in the options
throws before anything shows.

### A Section of Files

The parts of a section that works through a list of files, each built with `createElement` and optional:

```js
// Files dropped anywhere in the section, and the house drop zone for when it's empty.
const { zone } = kit.ui.dropZone($("convert-view"), {
    onPaths: (paths) => addFiles(paths),
    icon: "swap_horiz",
    label: "Drag & Drop Files or Folders Here",   // Title Case
    onBrowse: () => browseFiles(),                // the box and its Select Files button (browseLabel)
});
$("empty-state").append(zone);

const bar = kit.ui.progress({ label: file.name, thin: true });   // one item's, 4px; a batch's is 6px
bar.set(42);        // a percent
bar.set(null);      // not known: a bar slides across, never a frozen 0%

const actions = kit.ui.actionBar({
    run:   { label: "Convert", onClick: convert },
    abort: { onClick: cancelAll },               // "Cancel"
    clear: { onClick: clearAll },                // "Clear All"; leave it out for none
    progressLabel: "Converting",
});
actions.update({ summary: "3 files queued", detail: "Ready to convert", percent: 0, running: false, canRun: true, canClear: true });
```

- **`kit.ui.dropZone(area, options)`** takes files dropped anywhere in `area`. Each file's path comes from
  `kitAPI.getPathForFile()`, one `File` at a time (a `FileList` can't cross the bridge); a file that isn't on disk
  is left out, and `onPaths` is called only with paths. While files are over the area it has the class
  `drag-over`, counted in and out, since `dragleave` fires crossing onto each child. The app may light its own
  list under `.drag-over`. A drop anywhere else in the page opens nothing, where the window would otherwise
  navigate to the file. With `icon`, `label` and `onBrowse`, it also builds `zone`, the dashed box: the glyph,
  the label, "or" and a `Select Files` button. The whole box browses, bar its button, and it's lit while files are
  over the area. The app puts `zone` where it goes.
- **`kit.ui.progress({ label, thin })`** is Bootstrap's `.progress` in the accent, `role="progressbar"`, named by
  `label`. `set(null)` takes the value away and slides a 40% bar across; under reduced motion that bar is full,
  faded and still.
- **`kit.ui.actionBar(options)`** is the bar under a list: a status line (a live region; `summary` on the left,
  `detail` on the right), the batch's progress, then `Clear All` and the primary action. The primary action
  and its abort share one place, so only one is ever there: `update({ running: true })` swaps `Convert` for
  `Cancel`, and the keyboard's focus moves with it. `size: "sm"` makes its buttons small.

### Keys

`kit.keys.onKey(handler, { view })` listens for a section's own shortcuts (Delete, Escape, `Ctrl+A` on a list),
and returns a function that stops listening. The handler isn't called while someone is typing, while a modal
is open (a prompt, or one of Bootstrap's), or, given a `view`, while another view shows. `kit.keys.isTyping()`
says whether a key goes into something being typed in: a text field, a text area or anything editable. A
checkbox isn't, and neither is a select, which keeps the focus after a choice and would swallow the next
Escape.

### Format

`kit.format` is the house's wording for numbers. Every count on screen goes through `countOf()`, so "1 files"
can't happen:

| Helper | Gives |
|---|---|
| `plural(n, one, many?)` | the word that agrees: `plural(3, "file")` is `"files"`, `plural(1, "needs", "need")` is `"needs"` |
| `countOf(n, one, many?)` | the count and its word: `"1 file"`, `"18,000 frames"` |
| `groupDigits(n)` | `"18,000"` |
| `formatBytes(bytes)` | `"512 B"`, `"1.5 KB"`, `"12 MB"`: binary units, one decimal below 10; `null` if unknown |
| `formatEta(seconds)` | `"45s"`, `"2m 05s"`, `"1h 02m"`; `null` if unknown |
| `formatDuration(seconds)` | `"9:05"`, `"1:02:03"`; `null` if unknown |
| `summarise({ done, failed, cancelled }, { one, done })` | `"3 files converted, 1 failed, 2 cancelled"`, or `"Nothing converted"` |

A file loaded both in the page and under Node (a module of helpers its tests require) takes the same helpers
under Node from `require("@diamonddigitaldev/electron-kit/format")`, which runs `kit.js`'s own code, so the
house's wording has one implementation.

### The Main Window

`kit.windows.createMain(options)` makes the app's main window, after `kit.ready`, and loads its page:

```js
kit.windows.createMain({
    page: path.join(__dirname, "index.html"),
    size: { width: 1100, height: 780 },             // the first time
    min: { width: 880, height: 600 },
    title: "Diamond File Converter",
    icon: path.join(__dirname, "assets", "diamondfileconverter"),   // .ico, .icns or .png, by platform
    webPreferences: { preload: path.join(__dirname, "preload.js") },
});
```

- **Secure, always:** the house's web preferences, sandboxed and isolated with no Node in the page, are laid
  over the app's. Asking for `nodeIntegration` (or Node in frames or workers), or turning `contextIsolation`,
  the sandbox or `webSecurity` off, throws. Spell checking is off unless asked for.
- **Its size and position are kept:** saved 500 ms after it's resized or moved, and as it closes, under
  `windowBounds` beside the settings in `config.json` (File Converter's own key, so its saved bounds carry over).
  They're put back at the next launch. The size is never under `min`. A saved position no longer on any
  screen (a monitor unplugged) is dropped, and the window is centred. A maximised, minimised or full-screen
  window keeps its last normal bounds.
- **One main window:** asked for again while it's open, it's restored, shown and focused.
- `kit.windows.main()` is the main window, or `null`.
- The app quits when its last window closes, bar on macOS, where an app stays until it's quit and its main
  window is made again when it's activated with none.

A secondary window has no menu of its own (`win.removeMenu()`); the house menu belongs to the main window.

### One Instance and Files

`start()` takes the single-instance lock before any window, and sets the app's user model ID on Windows, so
its windows group in the taskbar. A second launch hands its argv to the first and quits: `kit.primary` is
`false` there. The first restores and focuses its main window. `start({ singleInstance: false })` lets more
than one run.

With `start({ files: true })`, the files the app is opened with reach its page as `files:opened`
(`kitAPI.onFilesOpened(callback)`, a list of paths). That covers its own argv ("Open with"), a second launch's
(Windows starts one process per file opened from Explorer), and macOS's `open-file`. Arrivals are gathered for
500 ms and pushed as one, once the main window's page has loaded, so none is lost to a page still loading.
From argv, a path is kept only if it isn't a switch, isn't the app's own folder, and is something on disk.
The app's own Open Files hands its picks over with `kit.files.open(paths)`: at once, after any still being
gathered.

### The Settings

`start({ settings: { defaults } })` gives the app's own settings and their defaults. They're kept by
`electron-store`, under one `settings` key in its default file (`config.json` in the app's `userData`
folder), beside the kit's own: `navCollapsed`, off; `autoDownloadUpdates`, on; and `updateChannel`,
`"stable"`, `"beta"` or `"alpha"`, `null` until the updater saves the running build's own. What's stored is read over the defaults, so a setting
added later appears with its default, and a stored value of the wrong kind is never handed out. A change
must name a known setting and keep its kind (a boolean stays a boolean, a list a list), with JSON values
only, or it's refused and nothing is stored. A setting whose default is `null` means "not chosen yet", and
takes any JSON value (File Converter's `concurrency: null`, the CPU count until someone picks one). The main process has the same settings as
`kit.settings.get()` and `kit.settings.set(changes)`.

**Migration.** An app whose settings change shape between versions numbers them:

```js
settings: {
    defaults: SETTINGS_DEFAULTS,
    version: 2,                                      // a whole number, from 1
    migrate: (settings, from) => {                   // what's stored; return what's kept
        for (const key of ["outputRouting", "outputDir"]) delete settings[key];
        return settings;
    },
    obsoleteKeys: ["presets", "pipelines"],          // the store's other keys, deleted
},
```

When the file was last written by an older version, or by none (`from` is then `0`), `migrate` is handed
what's stored, and every setting it drops is logged by name. Each obsolete key the file still holds is deleted
and logged too. Then the version is stored beside the settings as `settingsSchema`, so it runs once per
version: an unconditional prune would eat a value a later version wrote, on its next launch. It runs as the
store is first opened, so nothing reads a setting it's about to remove. A migration that throws isn't marked
done, and a file written by a newer version is left as it is.

### The Log

`start({ log: "file" })` keeps the app's log in `debug.log` in its `userData` folder. The file is emptied at
each launch and starts with a banner (`=== Diamond File Converter 2.0.0 started at … ===`), so it's one run's.
`kit.log.error()`, `warn()`, `info()` and `debug()` write a timed, levelled line and mirror it to the console.
The `LOG_LEVEL` environment variable sets the least that's kept (`INFO` if it's not set). Without the option,
the log goes to the console only. A write that fails never throws into the app: it's said once on the
console, and the next line tries again, since a file can be held for a moment (a virus scanner, on Windows).

**Everything is redacted before it's written anywhere:**
- A path keeps its file name only: `C:\Users\will\Videos\clip.mp4` is `…\clip.mp4`, and `/home/will/a.mp4`
  is `…/a.mp4`. That covers a drive's, a share's, one from `/` or `~/`, and one inside JSON. A path runs on,
  spaces and all, until a character no file name holds on Windows, the line's end, or another path, so a
  folder is never left behind.
- A URL keeps its scheme, host and path, and loses its query, its fragment and any user name, since a
  Dropgate link's key is in its fragment. A `file:` URL keeps its file name only.
- An `Error` is logged by its stack, redacted the same way.

So an app can log the file it failed on, or the argv it was opened with, without the log saying where a
person keeps their files.

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
- **A failed check or download is logged** as one warning (`start({ log })`, redacted like every line):
  the channel, the reason, and the error's code and first line.

The state, from `getUpdateStatus()` and `onUpdateStatus()`:

| Field | What it is |
|---|---|
| `state` | `"unavailable"`, `"idle"`, `"checking"`, `"none"` (up to date), `"available"`, `"downloading"`, `"downloaded"` or `"error"` |
| `reason` | for `"unavailable"`: `"off"` (no `updates` option) or `"not-packaged"` (run from source); for a failed check: `"offline"`, `"no-files"` (the release has no update files) or `"other"` |
| `error` | for `"error"`: `"check"` or `"download"` |
| `version` | the update found, or `null` |
| `tag` | its release's tag where the server has one (GitHub), or `null`: the Update tab links "Version x" in "Version x is available." to the release's page, `<repository>/releases/tag/<tag>` (the version when there's no tag), when the repository is on GitHub |
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
`generateUpdatesFilesForAllChannels`, which writes each channel's own update file for an update server
that has no releases of its own (a `generic` one). The app gives its own identity, files, icons, file
associations and `publish` (where the updater looks).

**Every release carries its update files, pre-releases too.** With GitHub (`publish.provider: "github"`),
electron-builder writes one update file whatever the version, `latest.yml` (`latest-linux.yml` on Linux),
and the updater finds each channel's release by its tag (checked in both their sources, 26.15 and 6.8):
Stable reads the latest finished release (GitHub's "latest", never a pre-release); Beta and Alpha read the
newest release in their channel or above it, and take its `latest.yml` when it has no `beta.yml` or
`alpha.yml`. So attach `latest.yml`, `latest-linux.yml` and each installer's `.blockmap` to every release,
beside the installers. A release without them can't be checked: the Update tab says "The newest release
has no update files yet." (and the log says `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`).

electron-builder merges `extends` deeply (checked in its source, 26.15): objects key by key, with the
app's values winning, and **lists joined, never replaced**. So an app can add a target to the base's lists,
but can't take one away; the base holds only what every app ships. A `.deb` or `.rpm` names its maintainer
from the base's `linux.maintainer`, not from `package.json`'s `author`, which in every app is a name and a
web address, and which npm would read as the email. An app's tests check
the config with `assertBuildExtendsKit(require("../package.json"))` from `electron-kit/testing`.

**Names.** Only the Windows installer is a `Setup`. An app names its files for itself and the version, with
hyphens, and gives the installer its own name:

```json
"artifactName": "Diamond-File-Converter-${version}.${ext}",
"nsis": { "artifactName": "Diamond-File-Converter-Setup-${version}.${ext}" }
```

So Linux gets `Diamond-File-Converter-2.0.0.AppImage`, `.deb` and `.rpm`. The base can't name them itself:
electron-builder's only name for the app is `${productName}`, which has spaces. Keep the installer's name
from one release to the next: its update files point at it.

**Binaries an app runs** (File Converter's ffmpeg) go in each platform's `extraResources`, from a package
that downloads the binary for the machine it's installed on, so Linux is built on Linux. Keep the package's
own copies out of `files`, or electron-builder unpacks every platform's into `app.asar.unpacked` beside them.

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
so their outline meets 3:1 too. Bootstrap's outline secondary button (a `Cancel`, a `Clear All`) keeps its light
grey text on dark, at 3.28:1; there it takes the theme's secondary text colour instead. Bootstrap's close
button takes the kit's ring. All of it is timed by the `--dur-*` tokens and the `--ease-spring` curve,
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
`e2e/visual.spec.js-snapshots/`, using Playwright's `toHaveScreenshot()`. It takes 40 images:

| State | Accents | Themes |
|---|---|---|
| Settings > Update with an update waiting (and the dot), downloading, ready to install, and after a failed check | the demo's | light and dark |
| Settings on its General, Update and Credits tabs | the demo's | light and dark |
| Controls at rest (the box ticked, the switch off) | the demo's | light and dark |
| Controls toggled by keyboard (the box unticked, the switch on and focused) | the demo's and each app's | light and dark |
| The rail expanded, Overview active and Controls focused by keyboard | the demo's and each app's | light and dark |
| The rail collapsed, the same | the demo's | light and dark |
| A warning toast with its list shown | the demo's | light and dark |
| The batch prompt, Save as New focused by keyboard | the demo's | light and dark |
| A section of files: the drop zone, a bar not known, the action bar with Convert focused | the demo's | light and dark |

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
