# The Shell, Settings and Credits

`kit.ui.mountShell()`: the nav rail, the header, and the Settings view with its Update and Credits tabs.

[All the docs](README.md)

## The Shell

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

## Settings and Credits

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
[Updates](updates.md). **Credits** replaces the old Credits
window: the logo, the app's name and version, the `•` credit lines, then the donate line and `Donate on Buy
Me a Coffee` and `View Source Code on GitHub`, all from `app:get-info`. The version is Electron's (the app's `package.json`),
and so is the name unless `start({ name })` gives one: an app whose `package.json` `name` is its npm name
(`diamond-file-converter`) passes its own, since a top-level `productName` would move its `userData` folder
and every saved setting with it; the repository is `start({ repository })`, or else the `package.json`'s. Each
credit line is a sentence, or a list of parts with links as `{ text, href }`. Every link and button opens
through `shell:open-external`, which opens `http(s)` links only, and these whatever the app's allowlist
([IPC](ipc.md#links-and-the-allowlist)); the page never follows a link itself.
`start()` checks the credits and throws on a link that isn't `http(s)`, so a mistake shows at launch.
