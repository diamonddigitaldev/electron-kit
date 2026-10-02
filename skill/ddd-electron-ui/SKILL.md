---
name: ddd-electron-ui
description: How Diamond Digital Development builds its Electron desktop apps, on @diamonddigitaldev/electron-kit — use the kit's pieces (the shell and nav rail, the Settings view with its Update and Credits tabs, the updater and its channels, toasts and prompts, the drop zone, progress and action bar, the menu, the main window, settings, the log, IPC and isolated sessions, the accent and tokens, the test helpers), never hand-roll them; plus the rules code can't enforce: copy casing, Material Icons Round, an app's own sections, the "desktop app" wording, README installation, and the release files every release carries. Use when building, restyling, reviewing or releasing any Diamond Digital Electron app, or adding a window, view, modal, toast, menu item, button, icon, setting, update behaviour, IPC channel or release to one.
---

# DDD Electron apps: use electron-kit

Every Diamond Digital Development Electron app is built on
[`@diamonddigitaldev/electron-kit`](https://www.npmjs.com/package/@diamonddigitaldev/electron-kit).
The kit implements the house UI and behaviour once, and every app takes it with a version bump. **Apps differ
in one thing only, the accent** (`src/styles/accent.css`). The kit's docs are the reference, and code wins:
<https://github.com/diamonddigitaldev/electron-kit/blob/master/docs/README.md>. Read the page for whatever
you're touching before you touch it. If the repo's code contradicts a rule here, match the surrounding code
and flag the difference rather than silently diverging.

## Use the kit's pieces, never hand-roll them

| The app needs | Use | Docs page |
|---|---|---|
| Its main process set up: one instance, settings, log, menu, theme push, the shared preload | `require("@diamonddigitaldev/electron-kit/main").start({ … })`, once, at the top of `main.js` | Getting Started |
| The main window, its bounds kept, secure web preferences | `kit.windows.createMain({ page, size, min, title, icon, webPreferences })` after `kit.ready` | The Main Process |
| A window that mustn't have the kit's bridge (one handling network data, a page that isn't the app's) | `kit.sessions.isolated(name)`, and its own channels with `kit.ipc.handle(…, { session })` | The Main Process; IPC |
| Its own IPC channels | `kit.ipc.handle("domain:action", handler)`, never `ipcMain.handle()`: it refuses any page but the app's own | IPC |
| Settings | `start({ settings: { defaults, version, migrate, obsoleteKeys } })`; the page reads and writes them through `kitAPI.getSettings()` / `setSettings()` | The Main Process |
| A log | `start({ log: "file" })`, or `"memory"` for an app that keeps nothing by default (on disk only while `keepLogOnDisk` is on); `kit.log.info()` and the rest, redacted | The Main Process |
| Files it's opened with ("Open with", a second launch, a drop on its icon) | `start({ files: true })`, `kitAPI.onFilesOpened()`, `kit.files.open()` for its own menu | The Main Process |
| The menu | `start({ menu: { items } })`: the house `Menu` with Settings `CmdOrCtrl+,` and Check for Updates | The Main Process |
| Links opened in the browser | `kitAPI.openExternal(url)` (http(s) only); `start({ openExternal: { allow } })` to narrow it | IPC |
| The frame, nav rail, header, views, the Settings view with Update and Credits | `kit.ui.mountShell({ title, sections, toolbar, settingsTabs, credits, onViewChange })` | The Shell, Settings and Credits |
| Updates, channels, the update dot | `start({ updates: {} })` and the Update tab `mountShell()` builds | Updates |
| A toast | `kit.ui.toast(message, { type, timeout, action })` | Page Components |
| A question only the person can answer, one item or a batch | `await kit.ui.confirm({ … })`, or its batch form with `choices` and `applyToAll` | Page Components |
| A drop zone, a progress bar, the action bar under a list | `kit.ui.dropZone()`, `kit.ui.progress()` (`set(null)` is "not known"), `kit.ui.actionBar()` | Page Components |
| A section's own keys (Delete, Escape, `Ctrl+A`) | `kit.keys.onKey(handler, { view })`, which ignores typing and open modals | Page Components |
| Counts, sizes and times in words | `kit.format.countOf()`, `plural()`, `summarise()`, `formatBytes()`, `formatEta()` (`require("@diamonddigitaldev/electron-kit/format")` under Node) | Page Components |
| The theme | `page/theme.js` in `<head>`; the kit pushes the OS theme | Theme, Accent and Tokens |
| Its colour | `src/styles/accent.css`, eight values, checked with `assertAccentContrast()` | Theme, Accent and Tokens |
| Builds | `"build": { "extends": "@diamonddigitaldev/electron-kit/builder/base.json", … }` | Building |
| Tests | `electron-kit/testing`: `assertNoOutsideLookups()`, `loadPreload()`, `assertNoBareAccelerators()`, `assertAccentContrast()`, `assertBuildExtendsKit()` | Testing an App |

- **Never restyle a kit component** from the app's stylesheet. Use the kit's tokens (`--dur-*`, `--wash-*`,
  `--radius-*`, `--opacity-*`, `var(--accent-text)`, `var(--accent-link)`) for the app's own parts.
- **When the kit can't do something the app needs,** add it to the kit (an option, a hook or a new piece). Until
  that's released, the app may carry its own version, marked `// kit-gap: <issue URL>`. Look for those markers in
  every session, and retire each once the kit has the piece.
- **Upgrading the kit:** read its release notes (while it's `0.x`, a minor may break), run the app's tests, then
  drive the packaged app on Windows and Linux before it ships in a release.

## Rules the kit can't enforce

### Copy

- **Title Case:** buttons and menu items (verb first: `Add Files`, `Clear All`, `Check for Updates`),
  headlines (`Drag & Drop Files or Folders Here`), and dialog, prompt and window titles (`File Already Exists`).
- **Sentence case** for everything else: counts and summaries (`3 files queued`, `2 selected`), status
  (`Converting`, `Ready`), toasts (a sentence with a period: `Conversion cancelled.`), field labels with **no
  colon** (`Convert to`), help text, select options, and tooltips with no period (`Move up`).
- **Ellipsis is `…`**, one character. **Every count goes through `kit.format.countOf()`**, never `file(s)` or an
  inline ternary; `summarise()` joins only non-zero clauses.
- `&` in headlines, "and" in running copy. Store a display label beside its value; never derive one with
  `toUpperCase()` (`WebM`, `WebP`).
- Errors name the thing and the target: `Could not read clip.avi: …`. No internal words ("job") in the UI.
- **A "desktop app", never a "Windows app".** The README's tagline, `package.json`'s `description`, release
  titles and intros, and the Credits text say `An Electron-based desktop app for …`. Platforms are named only as
  facts: the README's badge lists exactly the platforms released (`Windows | Linux`), the install section has a
  part per platform. What really is Windows-only (Explorer's context menu, SmartScreen, NSIS) stays, named as
  Windows'.
- **The README's Installation has a part per OS released,** files named by pattern (`<version>`), since a
  README outlives each release: **Windows**, `<App>-Setup-<version>.exe` (all users or per user; the SmartScreen
  note, as the installer is unsigned); **Linux**, `sudo apt install ./<App>-<version>.deb`,
  `sudo dnf install ./<App>-<version>.rpm`, or the AppImage (`chmod +x`, then run it). Then anything bundled,
  that the `latest*.yml` and `.blockmap` files are the updater's, and how to go back to an earlier version.

### Icons and the look of the app's own parts

- **Material Icons Round only**, from `node_modules`: the glyph name as the text of a
  `<span class="material-icons-round" aria-hidden="true">`. No SVG, sprites or emoji. A section's rail glyph is
  also its drop zone's icon. Recolour with text utilities or tokens, never a hex.
- **In-app UI over native dialogs** everywhere it can be: a decision is `kit.ui.confirm()`, a report is
  `kit.ui.toast()`, including prompts main raises mid-batch (main sends an event, the page asks, the answer comes
  back through `invoke`). Native only for file and folder pickers, when no window exists, and while quitting.
  Updates never prompt.
- **One toast per batch,** never one per failure: the item carries each reason, and the toast's `action` lists them.
- **Cards and rows** in a section: bordered, `--radius-card`; hover and selected take the washes. An 18px kind
  glyph, a name that truncates (`flex: 1 1 0; min-width: 0`), a 20px circular remove button, a meta line with its
  height reserved, and a status line coloured by tone. Act on the item: each card has its own small outline button
  for its state (`Cancel` while running, `Show in Folder` when done, `Retry` after an error).
- **Buttons:** secondary actions `btn btn-sm btn-secondary`; destructive `btn-outline-danger`; toolbar and "add"
  buttons may lead with a 16px glyph; commit, cancel and prompt buttons are text only. An icon-only button has an
  `aria-label` and a `title`. Enable, don't hide.
- **Form rows:** `label.form-label` above, the control (`form-select-sm`, `form-control-sm`, or an `input-group`
  with `Browse`), then a `.form-text` help line with its height reserved, so nothing jumps.
- **Settings that belong to one control stay on it.** The rest go in the app's own Settings tabs, saved as they
  change: no save button anywhere.
- Nothing is selectable but fields and the things worth copying (a file name in a toast's list, a command preview).

### Main process, preload and IPC

- **The app's preload runs sandboxed** and may only `require("electron")`; anything else leaves its bridge
  undefined with no error in main. Its channel names are inlined, and a test (`loadPreload()`) checks them against
  `constants.js`. Its own bridge is `window.electronAPI`; the kit's is `window.kitAPI`. Never declare a top-level
  `kitAPI`, `electronAPI` or `kit` in a classic script.
- **Channels are `domain:action`**, kebab-case, in `IPC` in `constants.js` with `SCREAMING_SNAKE` keys, each
  commented with its payload. Page to main is `invoke`, answered with `kit.ipc.handle()`; main to page is
  `webContents.send`, guarded by `!win.isDestroyed()`.
- A setting whose default is `null` means "not chosen yet". Bump `settings.version` with a `migrate` when a
  setting's shape changes.
- **Every accelerator has a modifier other than Shift**, or is a function key (the kit throws otherwise).
  Developer Tools are in the menu on pre-releases only (the kit's menu does this).
- **Privacy:** the app makes no network request the person didn't ask for, logs no folder or URL fragment (the
  kit's log redacts; never `console.log` a path in main), and keeps no history. Its tests launch it with
  `netLogSwitches()` and end with `assertNoOutsideLookups()`.

### Code

`src/` holds `main.js`, `preload.js`, `renderer.js`, `constants.js` (the cross-process contract: `IPC`,
`SETTINGS_DEFAULTS`, timings), the pages, `styles/accent.css` then `styles.css`, and `core/`: pure logic with no
Electron, tested without launching the app. 4-space indent, double quotes, semicolons, CommonJS, no bundler.
Comments explain why, often naming the bug the code prevents. DOM is built with `createElement` and
`textContent`, never `innerHTML` with data in it. `package-lock.json` is committed, and CI runs `npm ci`.

## Releases

**Every release carries its update files and every blockmap, pre-releases too.** With GitHub, electron-builder
writes only `latest.yml` (`latest-linux.yml` on Linux) whatever the version, and the updater reads it from the
newest release in the person's channel: Beta and Alpha from a pre-release, Stable from GitHub's "latest". A
release without them can't be found ("The newest release has no update files yet."). The blockmap lets an
installed app download only the parts of the next installer that changed; without it, every update is a full
download (the AppImage carries its own; `.deb` and `.rpm` have none).

1. Attach the installers and packages, and each installer's `.blockmap`.
2. Then **`latest.yml` and `latest-linux.yml`, last**, so an updater never finds an update file before the
   installer it names is there.
3. Check before announcing: every uploaded file the same as its build (GitHub's sha256), and each update file's
   `sha512` and `size` matching its installer.

A release's title is its tag; a pre-release is marked as one. No AI attribution in commits, pull requests,
releases or tags: the disclosure is the AI Transparency & Quality notice in the README.

## Keeping this skill current

This skill ships in the kit's npm package. An app's copy is written by
`npx @diamonddigitaldev/electron-kit skill` (into `.claude/skills/ddd-electron-ui/`); run it again after each kit
upgrade, and `npx @diamonddigitaldev/electron-kit skill --check` fails when the copy is out of date. A change to
the rules is made in the kit, never in an app's copy.
