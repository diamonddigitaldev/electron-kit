# Updates

The updater behind Settings > Update: when it checks, the channels, automatic downloads, and its state.

[All the docs](README.md)

## Updates

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
