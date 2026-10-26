# The Shell, Settings and Credits

`kit.ui.mountShell()`: the nav rail, the header, the bottom bar, and the Settings view with its Update and Credits tabs.

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
    busy:     () => (converting ? "A conversion is running." : null),   // asked before Restart Now
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

## The Bottom Bar

With `statusBar`, the shell adds a slim bar along the window's bottom, under the rail and the sections, for what
the app shows at all times, such as its connection. The kit builds the bar, each item's button and its panel, and
wires them; the app fills each item and its panel with its own elements:

```js
const shell = kit.ui.mountShell({
    // …the shell's other options, as above
    statusBar: {
        items: [{ id: "connection", label: "Connection", live: true, panel: { label: "Connection Details", width: 440 } }],
    },
});
const connection = shell.statusBar.item("connection");    // { button, panel, open(), close(), opened }
const line = kit.ui.statusLine({ text: "Connected", tone: "success", title: "Connected, through whichever adapter Windows chooses." });
connection.button.append(line.element);                  // the item: a status line, then anything else
connection.panel.append(details);                         // the panel: the app's own elements
shell.statusBar.show(settings.showConnection);            // hidden until shown
```

```
.app-frame.kit-with-statusbar             the window less the bar
footer.kit-statusbar                      26px, a line along its top
├── button.kit-statusbar-item             an item, filled by the app
└── .kit-statusbar-panel[role=dialog]     its panel, Close at its top right, then .panel
```

- **Hidden until `show(true)`**; `show(false)` hides it again, closing any open panel. While it shows, the frame takes
  the rest of the window, so nothing scrolls; without `statusBar`, nothing about the frame changes and
  `shell.statusBar` is `null`.
- **The bar** is 26px, in Bootstrap's tertiary background with a line along its top, its text 0.75rem.
- **Each item** is a borderless button, washed in the accent when hovered and while its panel is open, with
  `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`. It's named by its `label`, which isn't drawn, then
  what the app put in it ("Connection Connected"), so the label says what the item is and the content its state.
  A status line's `title` is its tooltip: say what the colour means there.
- **`live: true`** makes the item a polite live region, its new content read out as it changes. Without it nothing in
  the bar is announced: ask for it only where a change is news to someone who can't see the bar.
- **The panel** is a non-modal `role="dialog"` named by `panel.label`, `panel.width` px wide (capped to the window,
  8px from its sides), 6px above its item, with the kit's Close at its top right (the app's first element leaves
  room for it). It opens on a click, Enter or Space and takes the focus, so a screen reader reads its name and Tab
  reaches its controls. **Escape, Close, or Tab past its last control (Shift+Tab before its first) close it, and the
  focus goes back to its item;** a click outside closes it and leaves the focus where the click put it. It's never
  left open behind the focus. One panel is open at a time.
- **`open()`** opens it as a click does (refused while the bar is hidden); **`close()`** closes it, the focus going
  back to the item if it was in the panel, so a panel's own button (Network Settings) can close it and move on;
  **`opened`** says whether it's open.
- A mistake in the options, an `id` that isn't an item, or `show()` given anything but `true` or `false` throws, as
  every `kit.ui` helper does. Each `id` is a lowercase name; the button's `id` is `kit-statusbar-<id>`.

## Settings and Credits

The Settings view has tabs across the top (`role="tablist"`; the arrow keys, Home and End move between
them, and only the selected tab is in the Tab order): the app's own tabs, then **Update**, then
**Credits**, always last. They're plain text on a thin line, the selected one darker, with a thicker bar in
the accent's fill under it that slides to the next tab chosen and takes its text's width (the update dot, beside
Update's text, moves nothing). There's no save button anywhere: a tab keeps each change through
`setSettings()` as it's made. It's reached from the rail, and from the menu's `Settings` (`CmdOrCtrl+,`),
which puts focus on the selected tab.

**A tab's cards fill the pane**, edge to edge, as the tab bar above them does, however wide the window: the kit's
tabs hold nothing to a column, and an app's own tabs shouldn't either, so they all look alike. What's inside a card
keeps its own layout (buttons side by side, a switch or a select at its usual size). Where a readable width is
wanted, it's the text inside a card, a help line, never the card. A pane taller than the window scrolls, with the
kit's thin scrollbar ([Theming](theming.md#scrollbars)).

**Update** is two cards, one under the other. The first is headed with the version running
(`Version 2.0.0`), then a status line (`role="status"`, its height kept), then `Check for Updates` (disabled
while a check or download runs, or with no updater; busy, "Checking…" with a spinner, while a check runs, however
it was started, through `kit.ui.busy()`) and, when there's an update to download, `Download
Update` beside it. While an update downloads, a bar in the accent (`kit.ui.progress()`) shows under the
status line; it goes the moment the download finishes or fails, never fading or left at 100%. Once an update
has downloaded, **`Restart Now`** takes `Check for Updates`' place (and the focus, if it had it): it installs
the update at once, silently, and starts the new version, "Restarting…" while it does (its label comes back if the
app is still open). If the app passes `busy`, a function returning
what it's busy with (`"A conversion is running."`, or `null`), and it returns a reason, the kit asks first, in
its own warning prompt: "Restart Now?", the reason, "<App> will close to install the update, and open
again.", with the focus on Cancel. Without `busy`, or with nothing running, it restarts at once. In "Version x is available.", "Version x" is a link to that release's page on GitHub,
opened in the browser. "Checking for updates…" shows for a second at least, so a check that fails at once still
looks pressed. A failed check says why, in Bootstrap's warning shade (it passes): "You seem to be offline.",
"The newest release has no update files yet." or "Try again later."; a failed download is in the danger
shade. The second card, **Preferences**, holds the `Download updates automatically` switch (`kit.ui.switchField()`), on by default,
whose help says what it does on and what it does off, and the `Update channel`, `Stable`, `Beta` or
`Alpha`, each with its help line. Each change is kept as it's made, and a new channel checks again. The menu's `Check for Updates` opens this tab and runs a check.
While an update waits (`dot` in the updater's state), a **yellow dot** shows on the rail's Settings item (6px,
at its end, or in the item's top-right corner when the rail is collapsed, as far in from the right as from the
top) and on the Update tab (8px). It breathes slowly, a little fainter and smaller every 3.5 seconds, to draw
the eye without nagging; under reduced motion it's still. Its ring holds 3:1
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
