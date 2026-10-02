# IPC: the Shared Channels and the App's Own

The channels the kit's preload answers, and `kit.ipc.handle()` for an app's own, each answering the app's own page only.

[All the docs](README.md)

## The Shared Channels

| Channel | Kind | `window.kitAPI` |
|---|---|---|
| `app:get-version` | the page asks | `getVersion()`: the app's version |
| `app:get-info` | the page asks | `getInfo()`: `{ name, version, repository, credits: { lines, donate } }`, for the Credits tab |
| `settings:get` | the page asks | `getSettings()`: every setting, the app's and the kit's, over their defaults |
| `settings:set` | the page asks | `setSettings(changes)`: changes some settings (`{ navCollapsed: true }`) and resolves with them all |
| `shell:open-external` | the page asks | `openExternal(url)`: opens an `http(s)` link in the person's browser, on the app's allowlist if it has one ([below](#links-and-the-allowlist)); anything else is refused |
| `update:get-status` | the page asks | `getUpdateStatus()`: the updater's state ([Updates](updates.md)), without checking |
| `update:check` | the page asks | `checkForUpdates()`: checks now, and resolves with the state once the check is done |
| `update:download` | the page asks | `downloadUpdate()`: downloads the update found, and resolves with the state once it's downloaded or has failed |
| `update:install` | the page asks | `installUpdate()`: installs the update downloaded now (the app quits, and the new version starts); with none downloaded, does nothing and resolves with the state |
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

## Links and the Allowlist

`shell:open-external` hands the OS an `http(s)` link only, whatever the page asked for: a `file:`, `javascript:`
or custom-scheme link could run something on the machine. An app can narrow that to the sites it links to:

```js
kit.start({
    openExternal: { allow: ["https://dropgate.link/docs/", "https://github.com/diamonddigitaldev/"] },
});
```

Then a link opens only if it's under an entry: the same scheme, host and port, and a path that's the entry's
or inside it, by whole segments. Entries are matched as URLs, never as text, so `https://diamonddigital.dev`
doesn't let `https://diamonddigital.dev.example.com` through, nor `https://github.com/diamonddigitaldev` let
`https://github.com/diamonddigitaldev-fake`. An entry has no user name, query or fragment, and `start()` throws
on one that isn't an `http(s)` URL. The links the kit shows from the app's own config are always allowed: each
credit line's link, the donate link, and the repository (and so its releases, which Settings > Update links
to), so the Credits and Update tabs keep working. Anything else is refused:

```
Error invoking remote method 'shell:open-external': Error: electron-kit opens links on the app's allowlist only.
```

## The App's Own Channels

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
of the kit's shared channels above, or one that already has a handler.

A channel answers the UI session's page only. A window in an isolated session
([`kit.sessions.isolated()`](main-process.md#isolated-sessions)) has channels of its own, answered for the
app's own page in that session and refused everywhere else, the UI session's pages included:

```js
const transfer = kit.sessions.isolated("transfer");             // once the app is ready
kit.ipc.handle("transfer:progress", (_event, update) => progress(update), { session: transfer });
```

So each side can ask only the channels meant for it: the isolated window is refused the UI's channels and
the kit's shared ones, and the UI is refused the isolated window's. The session must be one
`kit.sessions.isolated()` made.
