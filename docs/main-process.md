# The Main Process

What `start()` does in the main process: the main window, isolated sessions, one instance and the files an app is opened with, the settings, the log and the menu.

[All the docs](README.md)

## The Main Window

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
  the sandbox or `webSecurity` off, throws. Spell checking is off unless asked for (and see below).
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

**No spell-check dictionaries are downloaded.** On Linux, Electron's spell checker downloads its dictionaries
from Google as each session starts, even when every window has spell checking off, which tells Google the
person's address and language. `start()` gives every session, the default one and every partition, no
spell-check languages as it's made, so there's nothing to download. An app that wants spell checking sets its
languages itself, from a dictionary source of its own.

## Isolated Sessions

`kit.sessions.isolated(name)` gives a session without the kit's bridge, for a window that mustn't have
`window.kitAPI`: a hidden window that handles what comes in from the network (Dropgate's transfer renderer),
or a page that isn't the app's. Call it once the app is ready, and make the window in it:

```js
kit.ready.then(() => {
    const transfer = kit.sessions.isolated("transfer");
    const win = new BrowserWindow({
        show: false,
        webPreferences: { session: transfer, preload: path.join(__dirname, "transfer-preload.js"), sandbox: true, contextIsolation: true },
    });
    kit.ipc.handle("transfer:progress", (_event, update) => progress(update), { session: transfer });
});
```

- **Its own partition, in memory:** nothing it caches or stores is kept on disk, unless it's made with
  `{ persist: true }`. Asked for again by the same name, it's the same session.
- **No kit bridge:** the kit's preload is never registered there, so its windows get only the preload the app
  gives them; `isolated()` throws if the kit's preload has been registered on it.
- **No permissions:** every permission request (notifications, the camera, …) is refused and every check
  answers no, so a window there can never prompt.
- **No dictionaries,** as every session on the kit.

Its windows' own channels are answered with `kit.ipc.handle(channel, handler, { session })`, for the app's own
page in that session only ([IPC](ipc.md#the-apps-own-channels)).

## One Instance and Files

`start()` takes the single-instance lock before any window, and sets the app's user model ID on Windows:
`start({ appId })`, the app's `build.appId`. The installer gives the Start menu shortcut that ID, and Windows
groups the app's windows under its pinned taskbar icon, and shows its notifications, only when the two match.
Without `appId`, it's the app's name, which matches nothing the installer made. A second launch hands its argv to the first and quits: `kit.primary` is
`false` there. The first restores and focuses its main window. `start({ singleInstance: false })` lets more
than one run.

With `start({ files: true })`, the files the app is opened with reach its page as `files:opened`
(`kitAPI.onFilesOpened(callback)`, a list of paths). That covers its own argv ("Open with"), a second launch's
(Windows starts one process per file opened from Explorer), and macOS's `open-file`. Arrivals are gathered for
500 ms and pushed as one, once the main window's page has loaded, so none is lost to a page still loading.
From argv, a path is kept only if it isn't a switch, isn't the app's own folder, and is something on disk.
The app's own Open Files hands its picks over with `kit.files.open(paths)`: at once, after any still being
gathered. The log says how many files were opened, never which.

A launch the app handles itself, such as Dropgate's "Share with Dropgate" (the file, then `--upload`), names
its switch in `start({ files: { except: ["--upload"] } })`. A launch, first or second, with one of those
switches has none of its files taken: the app reads them from argv, or from its own `second-instance`
handler. A second one still brings the main window back.

## The Settings

`start({ settings: { defaults } })` gives the app's own settings and their defaults. They're kept by
`electron-store`, under one `settings` key in its default file (`config.json` in the app's `userData`
folder), beside the kit's own: `navCollapsed`, off; `autoDownloadUpdates`, on; and `updateChannel`,
`"stable"`, `"beta"` or `"alpha"`, `null` until the updater saves the running build's own; and, with the
memory log only, `keepLogOnDisk`, off ([The Log](#the-log)). What's stored is read over the defaults, so a setting
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

## The Log

`start({ log: "file" })` keeps the app's log in `debug.log` in its `userData` folder. The file is emptied at
each launch and starts with a banner (`=== Diamond File Converter 2.0.0 started at … ===`), so it's one run's.
`kit.log.error()`, `warn()`, `info()` and `debug()` write a timed, levelled line and mirror it to the console.
The `LOG_LEVEL` environment variable sets the least that's kept (`INFO` if it's not set). Without the option,
the log goes to the console only.

`start({ log: "memory" })` keeps the log in memory instead: the banner and the run's last 1000 lines
(`{ mode: "memory", lines: 5000 }` for more, from 100 to 100000), and nothing on disk. It adds a setting,
`keepLogOnDisk`, off by default, for a switch the app shows where it likes (Dropgate's "Keep Log on Disk for
Troubleshooting"), changed through `kitAPI.setSettings()` like any other:

- **Turned on,** the run so far is written to `debug.log` in `userData`, and each line after it is added. At
  the next launch, still on, the file starts again with that run's banner. It holds at most twice the lines
  kept in memory after the banner: past that, it's written again from the banner and the run's last lines.
- **Turned off,** `debug.log` is deleted. At a launch with it off, a `debug.log` an earlier run kept is
  deleted too.

In every mode, `kit.log.lines()` gives the banner and the run's last lines, as written, so an app can copy
them or save them where the person chooses. A write that fails never throws into the app: it's said once on the
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

## The Menu

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
