# Page Components

The page library's parts: toasts, prompts, the parts of a section of files, the key guard and the house's wording for numbers.

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
  faded and still.
- **`kit.ui.actionBar(options)`** is the bar under a list: a status line (a live region; `summary` on the left,
  `detail` on the right), the batch's progress, then `Clear All` and the primary action. The primary action
  and its abort share one place, so only one is ever there: `update({ running: true })` swaps `Convert` for
  `Cancel`, and the keyboard's focus moves with it. `size: "sm"` makes its buttons small.

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
