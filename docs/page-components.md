# Page Components

The page library's parts: toasts, prompts, the parts of a section of files, cards, the card grid and its bulk bar, busy buttons, the key guard and the house's wording for numbers.

[All the docs](README.md)

## Toasts

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

## Prompts

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

## A Section of Files

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
  faded and still. `set(percent, { paused: true })` is paused work: the bar keeps its value (and `aria-valuenow`),
  faded to 0.45 and still; a paused bar whose amount isn't known doesn't slide, it's full and faded. The next
  `set()` without `paused` brings it back.
- **`kit.ui.actionBar(options)`** is the bar under a list: a status line (a live region; `summary` on the left,
  `detail` on the right), the batch's progress, then `Clear All` and the primary action. The primary action
  and its abort share one place, so only one is ever there: `update({ running: true })` swaps `Convert` for
  `Cancel`, and the keyboard's focus moves with it. `size: "sm"` makes its buttons small. The `detail` is
  the app's text: a count of each state, in bullets and Title Case as the house's copy rules have it
  ("1 Paused · 2 Ready").

## Cards

`kit.ui.card()` is one piece of work in a list: a file to convert, a transfer. The app keeps the state and draws
it with `update()`, as it does the action bar:

```js
const select = document.createElement("select");          // the app's own control, with its own name
select.className = "form-select form-select-sm";
select.setAttribute("aria-label", "Upload to");

const card = kit.ui.card({
    icon: "upload_file",                // the kind's glyph, aria-hidden
    name: "site-backup.tar",            // never recased; its title, and the names below
    onConfigure: () => openAdvanced(),  // Advanced Options (tune); leave it out for none
    onRemove: () => removeIt(),         // Remove (close), named "Remove site-backup.tar"; leave it out for none
    route: { label: "To", control: select },   // or { from: "MP4", control }: "MP4 →"; leave it out for none
    onPick: (event, { box }) => pick(event, box),   // a click on the card, or its box
});
list.append(card.element);

card.update({
    meta: "3.1 GB",
    settings: "3 Days · 10 Downloads",  // or { text, tone: "warning" }
    status: { text: "Paused. Kept until 14:32.", tone: "warning" },
    percent: 35, paused: true,          // the thin bar; null is "not known"; leave percent out for no bar
    actions: [
        { label: "Resume", variant: "outline-secondary", onClick: (button) => resume(button) },
        { label: "Cancel", variant: "outline-danger", onClick: () => cancel() },
    ],
    rows: [linkRow],                    // the app's own elements, under the bar
    locked: true,                       // Advanced Options, the route's control and Remove are disabled
    canRemove: true,                    // but Remove isn't: it follows locked unless given
});
```

- **The head:** a selection box named `Select <name>`, the kind's glyph, the name (cut off with an ellipsis, the
  whole name its title), then Advanced Options and Remove when they're given. The card is a group named by its
  name.
- **Under it, in order:** the meta line (secondary text), the settings line (what has been set on it, in the
  accent's text shade, or `tone: "warning"`), the route (an uppercase label such as "To", or "MP4 →", then the
  app's control, which the card disables while it's `locked`), the status line, the thin bar, the app's `rows`,
  and the card's buttons. Each line is one line, cut off with an ellipsis, its whole text the title.
- **`update()` takes the whole state each time**: what's left out is drawn empty or hidden (no `meta` hides the
  meta line, no `status` the status line, no `percent` the bar, no `actions` the buttons; `locked` and `paused`
  are false, and `canRemove` follows `locked`). The exception is `name`, which, when given, renames the card, its
  box, its Remove and its bar.
  `route: false` hides the route. A mistake in the state throws before anything is drawn.
- **The status line** has a dot coloured by its `tone`: `ready` (the accent), `running` (the accent, pulsing; still
  under reduced motion, and its text in the accent's text shade), `warning`, `danger`, `success` and `muted`, each
  text in Bootstrap's colour for it, which holds AA in both themes. The words follow the house's copy rules:
  "Queued: Starts when one of the 3 running finishes.", "Uploaded · End-to-End Encrypted".
- **The buttons** are `btn-sm` in a `variant` (`outline-secondary` if not given: `primary`, `secondary`, `success`,
  `warning`, `danger`, `outline-secondary` or `outline-danger`). They're rebuilt only when their labels or variants
  change, so one isn't swapped out from under the pointer as the card ticks; each calls the `onClick` it was last
  given, with the button, so it can be made busy. **Every button on a card is one size**, whatever its variant and
  while it's busy: `0.1rem 0.45rem` of padding, `0.72rem` text, a line height of 1.5 and a 1px border, set outright.
  A Bootstrap button in the app's rows is the same size.
- **`locked` and `canRemove`:** `locked` is for a card whose work is under way: Advanced Options and the route's
  control are disabled, and so is Remove, unless `canRemove` says otherwise. A card waiting its turn, such as a
  queued upload, is locked but can still be taken off the list: `{ locked: true, canRemove: true }`.
- **Picking:** a click on the card, or on its box, calls `onPick(event, { box })`; a click on one of its controls
  (a button, a field, a select, a link) doesn't. With `onPick` the card washes in the accent when hovered. What a
  pick selects is the app's, or, in a card grid (below), the grid's: a card in a grid is made without `onPick`.
- **The outline buttons** (`outline-secondary`, `outline-danger`) are filled with the page's colour on a card, as
  its Remove is, so their text holds AA on a hovered or selected card's wash too.

`kit.ui.busy(button, label)` shows a button doing what it says, as a card's Pause does while it pauses: the button
is disabled, with Bootstrap's small spinner (`aria-hidden`, sized to the button's text so the button doesn't grow)
before a "[Doing it]…" label. It returns `restore()`, which puts the button's own label back, and the enabled state
it had; calling it twice does nothing more. A button already busy is refused.

```js
onClick: (button) => {
    const restore = kit.ui.busy(button, "Pausing…");
    pause().catch(() => restore());    // a card's buttons are rebuilt anyway once its state changes
}
```

## The Card Grid

`kit.ui.cardGrid(container, { view, onSelect })` lays out a list's cards and selects them, by the rules File
Converter's cards have always had:

```js
const grid = kit.ui.cardGrid($("job-grid"), {
    view: "convert",                         // the shell's view the grid is in: its keys work only there
    onSelect: (selection) => render(),       // told each time the selection changes, however it changed
});
const card = kit.ui.card({ icon: "movie", name: "clip.mp4", onRemove: () => grid.remove(card) });   // no onPick
grid.add(card);

grid.selection;                    // the cards selected, in their order on screen
grid.cards;                        // every card, in the order they were added
grid.select([card]);               // or one card; selectAll(), clear()
grid.remove(card);                 // and out of the selection with it

// Delete is the app's: only it knows when a card can go.
kit.keys.onKey((event) => {
    if (event.key === "Delete" && grid.selection.length > 0 && !converting) {
        event.preventDefault();
        removeJobs(grid.selection);
    }
}, { view: "convert" });
```

- **The layout:** as many columns of at least 272px as fit, `0.75rem` apart, the cards in the order they're added.
  `container` is the app's element; the grid takes it over (`.kit-card-grid`), and one that's a grid already is refused.
- **A click:** a plain click selects that card alone, or, when it's one of several selected, keeps them all (so a
  group can be acted on without collapsing to one first). `Ctrl` (`Cmd` on a Mac) adds or takes away one card.
  `Shift` selects the range from the anchor (the last card clicked without `Shift`) to this one, replacing the
  selection; `Ctrl+Shift` adds the range to it. A card's box toggles just its card, whatever is held down, and is
  ticked while its card is selected. A click on one of a card's controls picks nothing, and a click on the grid's
  empty space clears the selection. A `Shift` click doesn't select the text between.
- **The keys,** through `kit.keys.onKey()` (never while someone types, under a modal, or while another view shows):
  `Ctrl+A` selects every card and `Escape` clears. Give `view` when the grid is in the shell; without it, they work
  in every view. **`Delete` is the app's**, as above.
- **The look:** a selected card has the accent's border and active wash (`.kit-card.selected`); hovered, its wash is
  stronger, so it never looks less selected than a card that's only hovered. In a grid, every card washes when
  hovered and shows the pointer.
- **`add(card)`** takes a card from `kit.ui.card()` made without `onPick` (the grid hears its picks) and not in a
  grid already. **`remove(card)`** takes it out of the page, the grid and the selection (if it was the anchor, the
  next `Shift` click is a plain one), and it can be added again. `select()` takes cards in the grid; its anchor is
  the first of them on screen. `onSelect` isn't told when nothing changed.
- **The rules on their own,** for a list that isn't cards: `kit.ui.cardGrid.resolveSelection(items, current,
  clicked, { ctrl, shift }, anchor)` returns `{ selection, anchor }` (a new `Set`), and
  `kit.ui.cardGrid.pruneSelection(selection, items)` drops what's no longer in the list.

## The Bulk Bar

`kit.ui.bulkBar(grid, { noun, target, actions })` is the bar over a grid that acts on its selection, or on every card
when none is selected (the scope):

```js
const scope = () => (grid.selection.length > 0 ? grid.selection : grid.cards);
const target = document.createElement("select");          // the app's own select, which the bar labels
target.className = "form-select form-select-sm";
target.addEventListener("change", () => setTarget(scope(), target.value));

const bar = kit.ui.bulkBar(grid, {
    noun: "file",                                         // or { one, many }: the box is "Select all files"
    target: {
        verb: "Convert",                                  // "Convert all to", or "Convert selected to"
        control: target,
        note: (scope, { all }) => (formatsFor(scope).length > 0 ? "" : `No format works for every ${all ? "queued" : "selected"} file`),
    },
    actions: [
        { label: "Bulk Edit", variant: "primary", selection: true, enabled: () => !converting, onClick: (scope) => openAdvanced(scope) },
        { label: "Remove", variant: "outline-danger", selection: true, onClick: (scope) => removeJobs(scope) },
    ],
});
$("convert-view").prepend(bar.element);
bar.refresh();                                            // when the app's own state changes what note() or enabled() says
```

- **In order:** the select-all box, "Select all" (or "3 selected": a live region, so `Ctrl+A` and `Escape` are
  heard), then, with a `target`, a rule, its label, the app's select and its note, then the actions on the right
  and Deselect. It wraps onto a second line when there isn't room, and shows only while the grid has cards.
- **The select-all box** is unticked with none selected, has a bar across it with some, and is ticked with all. It
  selects every card, or clears them when all are, and is named "Select all" and the noun's plural.
- **The target** is the app's `<select>`: the app fills it and acts on its changes; the bar labels it for the scope
  and describes it by its note (`aria-describedby`). `note(scope, { all })` returns text (`""` for none), and is
  asked each time the bar is drawn.
- **The actions** are `btn-sm` in a `variant` (`outline-secondary` if not given), each called with the scope. With
  `selection: true` an action shows only while something is selected; without, always. `enabled(scope)` disables it
  when it returns false. **Deselect** is the bar's own, last, and shows with a selection. When a button with the
  keyboard's focus goes, the focus moves to the select-all box. The bar's outline buttons are filled with the page's
  colour, so their text holds AA on its wash.
- **It's drawn again** whenever the selection or the cards change; `refresh()` draws it again for anything else.
  One bar per grid. A mistake in the options throws before anything is drawn.

The bar under the list, with the run's progress and its one primary action, is still `kit.ui.actionBar()`.

## Keys

`kit.keys.onKey(handler, { view })` listens for a section's own shortcuts (Delete, Escape, `Ctrl+A` on a list),
and returns a function that stops listening. The handler isn't called while someone is typing, while a modal
is open (a prompt, or one of Bootstrap's), or, given a `view`, while another view shows. `kit.keys.isTyping()`
says whether a key goes into something being typed in: a text field, a text area or anything editable. A
checkbox isn't, and neither is a select, which keeps the focus after a choice and would swallow the next
Escape.

## Format

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
| `summarise({ done, failed, skipped, cancelled }, { one, done })` | `"3 files converted, 1 failed, 1 skipped, 2 cancelled"` (the first count names the item: `"5 files skipped"`), or `"Nothing converted"` |

A file loaded both in the page and under Node (a module of helpers its tests require) takes the same helpers
under Node from `require("@diamonddigitaldev/electron-kit/format")`, which runs `kit.js`'s own code, so the
house's wording has one implementation.
