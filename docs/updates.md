# Updates

The updater behind Settings > Update: when it checks, the channels, automatic downloads, a proxy, and its state.

[All the docs](README.md)

## Updates

`start({ updates: {} })` gives the app an updater: electron-updater, from the update server
electron-builder wrote into the app (its `publish` config). Without `updates` there's none, and nothing is
checked. With it, it runs **only in a packaged app** (`app.isPackaged`; electron-updater isn't even loaded
otherwise), and checks **only when the app says so**: 5 seconds after launch (`updates: { checkOnLaunch:
false }` turns that off), and whenever the page asks (`checkForUpdates()`). It makes no other request.
Settings > Update opened before the launch check has run runs it then, and a check run before it (either
way) takes its place, so the launch never checks twice. Until a check runs, the tab says "Updates haven't
been checked yet."

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
  is installed when the app quits (`autoInstallOnAppQuit`), or at once with `installUpdate()` (Settings >
  Update's Restart Now: electron-updater's `quitAndInstall`, silent, then the new version starts; with nothing
  downloaded it does nothing, and an installer that won't start is one warning in the log). Off, the update dot shows, and the page offers
  `downloadUpdate()`. The dot stays until the app runs the new version, and shows too when a download fails.
  Turning it on downloads an update waiting. Moving to a channel that wouldn't offer an update already
  downloaded keeps it from being installed.
- **No ID of the install is made, kept or sent.** Left to itself, electron-updater makes a random ID on its
  first check, writes it to `userData` (`.updaterId`), sends it with every request (`x-user-staging-id`) and
  uses it to place the install in a staged rollout (`stagingPercentage` in the update file). The kit gives it
  `00000000-0000-0000-0000-000000000000` before its first check, so no ID is made and no file is written, and
  every install is offered every release: no app on the kit uses staged rollouts. A `.updaterId` an earlier
  version wrote is deleted as the updater starts, and never read or sent. The tests check the profile for the file after a
  real update, so an electron-updater upgrade that changes how it keeps the ID fails them.
- **A failed check or download is logged** as one warning (`start({ log })`, redacted like every line):
  the channel, the reason, and the error's code and first line.
- **electron-updater's own lines go to the same log, never the console.** Its detail (what it checks, and
  a failure's whole dump: the response's headers and the stack) is at `debug`, so it's there for a bug
  report with `LOG_LEVEL=debug` and out of the way otherwise; its warnings are at `warn`. Every line is
  redacted, so a URL loses its query (a token in it) and a path keeps only its file name. Without a log,
  electron-updater says nothing.

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
| `pending` | whether the launch check is still waiting to run |
| `current`, `channel` | the version running, and the channel in use |

The version rules are `require("@diamonddigitaldev/electron-kit/main").version` (`parse`, `compare`,
`channelOf`, `isOfferableUpdate` and the rest), for an app's own use.

## Through a Proxy

`kit.updater.setProxy(config)`, from the app's main process, sends every update check and download through a
proxy: an app whose own requests go through one (Dropgate's chosen network adapter) sends its updates the same way.

```js
await kit.updater.setProxy({ proxyRules: "socks5://127.0.0.1:1080", proxyBypassRules: "<-loopback>" });
await kit.updater.setProxy(null);   // back to how the app was launched
```

- **`proxyRules` and `proxyBypassRules`** are Electron's own (`session.setProxy()`), strings; nothing else is taken,
  and anything else throws. `null` goes back to how the app was launched: the system's proxy settings, or none
  when it was launched with `--no-proxy-server`, as its tests are (`netLogSwitches()`, [Testing](testing.md)),
  since the system's settings can search the network for a proxy.
- **It's electron-updater's own session** (its `netSession`), which the kit never makes itself. A proxy set
  before electron-updater loads (before `kit.ready`) is kept, and applied as it loads, before any check.
- **It resolves once applied**, and at once when there's no updater to apply it to (run from source, or without
  `updates`). Calls apply in order, and a check or download waits for the one being applied.
- **A change cuts what's under way:** the session's connections are closed, and a download under way is
  cancelled, so it fails and the Update tab says so ("Version x couldn't be downloaded."), as any network failure.
  Nothing starts again by itself: Check for Updates or Download Update tries again, through the new proxy.
- **Chromium never sends loopback through a proxy** unless `proxyBypassRules` says `<-loopback>`: a proxy that
  must carry everything, an update server on this machine included, needs it.
