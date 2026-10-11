# Building

The electron-builder config every app builds with, the files it opens on each platform, the update files every release carries, and how an app names its files.

[All the docs](README.md)

## Building

An app's electron-builder config is `electron-builder.cjs`, beside its `package.json`, made by the kit's
`config()`:

```js
const { config } = require("@diamonddigitaldev/electron-kit/builder");

module.exports = config(require("./package.json"), {
    build: {
        appId: "com.diamonddigitaldev.<app>",
        productName: "<App>",
        artifactName: "<App>-${version}.${ext}",
        publish: { provider: "github", owner: "diamonddigitaldev", repo: "<App>" },
        win: { icon: "src/assets/<app>.ico" },
        linux: { icon: "src/assets/<app>.png", category: "AudioVideo" },
        nsis: { artifactName: "<App>-Setup-${version}.${ext}" },
    },
    fileTypes: [
        { name: "Audio File", ext: ["mp3", "wav", "flac"] },
        { name: "Video File", ext: ["mp4", "mkv"] },
    ],
    contextMenu: { label: "Convert with <App>", folders: true },
});
```

It's `.cjs`, never `.js`: on Windows, `electron-builder` typed in that folder (in PowerShell or the Command
Prompt, or through `npx`) would find `electron-builder.js` first and run it with Windows Script Host instead,
since `.JS` is a program's extension there.

`package.json` has no `build` then: electron-builder reads it before `electron-builder.cjs`, so `config()`
refuses a `package.json` that still has one. `build` is the app's own electron-builder options, as they
were in `package.json`, and `config()` adds the rest:

- `extends`, the kit's `builder/base.json`;
- **the asking installer** on Windows (below), from the same file types and the app's right-click entry,
  with **its sidebar** made from the app's icon and accent (below);
- **Linux's desktop entry**, from the app's `appId` and its files (below).

The kit owns an app's file associations and its installer's questions. It never sets electron-builder's
`fileAssociations`, which claim every type on Windows without asking. So `config()` refuses
`fileAssociations` (anywhere), `nsis.include`, `nsis.script`, `nsis.oneClick`, `nsis.perMachine`,
`nsis.allowElevation`, both `nsis` shortcut options (the installer asks about both), `nsis.deleteAppDataOnUninstall`
and `nsis.removeDefaultUninstallWelcomePage` (the uninstaller asks), `nsis.installerSidebar` and
`nsis.uninstallerSidebar` (the kit makes the sidebar), `linux.mimeTypes`, `linux.executableArgs`,
`linux.syncDesktopName`, `linux.desktop`, `extraMetadata.desktopName`, and an `extends` of the app's own.
An app's own `installer.nsh` goes: its right-click entry is `contextMenu`.

`build.appId` (such as `com.diamonddigitaldev.dropgateclient`) and `build.linux.category`, one of
freedesktop.org's main categories (`AudioVideo`, `Audio`, `Video`, `Development`, `Education`, `Game`,
`Graphics`, `Network`, `Office`, `Science`, `Settings`, `System`, `Utility`), are needed, and so is
`build.linux.icon`, the app's icon as a PNG (512 × 512), which the installer's sidebar is made from.

`builder/base.json` gives every app the same builds: NSIS on Windows, in the Start menu's `Diamond
Digital Development` folder; AppImage, `.deb` and `.rpm` on Linux, built on Linux; and
`generateUpdatesFilesForAllChannels`, which writes each channel's own update file for an update server
that has no releases of its own (a `generic` one). The app gives its own identity, files, icons, file
types and `publish` (where the updater looks).

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
the config with `assertBuildExtendsKit(require("../electron-builder.cjs"))` from `electron-kit/testing`.

## The Files an App Opens

`fileTypes` lists them in groups, each with a name and its extensions, lowercase and without the dot.
The installer shows each group as a branch of its own, named as the app names it, so a name can't start
with `-` or `!` (NSIS would hide the branch or make it bold).
An app that takes any file (Dropgate) sets `allFiles: true` instead.


```js
fileTypes: [
    { name: "Audio File", ext: ["mp3", "wav", "flac"] },
    { name: "Video File", ext: ["mp4", "mkv"] },
],
contextMenu: { label: "Convert with Diamond File Converter", folders: true },
```

`contextMenu` is the app's entry on the menu Explorer shows when a file is right-clicked: its `label`,
`folders: true` to show it on folders too, and `args`, switches given after the file (Dropgate's
`["--upload"]`). The installer's box for it reads `Add "<label>" to the right-click menu` on one line, so a
`label` holds at most 48 characters.

### The Asking Installer (Windows)

The installer never claims a file type, adds a right-click entry or makes a shortcut without asking. It
opens on a welcome page saying what it will ask ("You'll choose who it's for, the files it opens and its
shortcuts.", without the files for an app with none), then:

1. **Who it's for:** "Only for me", the default, which needs no administrator, or "Anyone who uses this
   computer". If the app is already installed for everyone (every install before the kit was), this is
   skipped and that copy is upgraded, so there are never two.
2. **Choose File Types:** a tree with a branch for each of the app's groups, open, and a box for each
   extension, every one ticked. A branch's box ticks or unticks all of its types. An app with `allFiles`, or
   with no `fileTypes`, has no such page.
3. **Shortcuts & Right-Click Menu:** "Add a desktop shortcut", "Add a Start menu shortcut" (in the Start
   menu's `Diamond Digital Development` folder) and the right-click entry's box, all ticked. An app without
   a right-click entry has the two shortcut boxes, on a page called "Shortcuts".

A ticked type puts the app in its Open With list, and lists the app in Settings > Apps > Default apps,
where the person can make it the default. It becomes the type's default by itself only where no app has
been chosen: Windows keeps each person's choice (UserChoice) where no installer can write it, and the
installer never takes another app's default. The page says so. An unticked type gets nothing, and what an
earlier install added for it is taken away. An unticked shortcut is taken away too, and a ticked one that
was deleted is made again. Without a Start menu shortcut, the finish page's "Run" starts the app itself.

**Without a Start menu shortcut, Windows doesn't show the app's notifications** (Electron's `Notification`;
it still says it showed them), and the app isn't in Start or its search. An app that relies on
notifications should say so where the person would notice; in-app toasts (`kit.ui.toast()`) don't depend
on it.

The choices are kept with the install, and the next install starts from them. An update (the updater
runs it silently, with `--updated`) shows no page, never adds back what was unticked and never makes a
shortcut, so a shortcut the person deleted stays deleted. Uninstalling takes away everything the installer
added; an update's uninstall of the version before it takes away nothing.

**The uninstaller asks about the app's settings and logs.** Its welcome page has an "Also remove settings
and logs" box, unticked. Ticked, it removes the app's folders in the person's own app data
(`%APPDATA%\<productName>`, and those named for the app's file name and its package), as electron-builder's
`--delete-app-data` does, even for an install for everyone. Unticked, they stay, so a reinstall starts where
the person left off. A silent uninstall keeps them unless given `--delete-app-data`; an update's uninstall
always keeps them.

Silently (`/S`), these choose instead:

| Switch | What it does |
|---|---|
| `/FILETYPES=all`, `none`, or a list such as `/FILETYPES=mp3,wav` | the file types |
| `/NOCONTEXTMENU` | no right-click entry |
| `/NODESKTOPSHORTCUT` (or electron-builder's `--no-desktop-shortcut`) | no desktop shortcut |
| `/NOSTARTMENUSHORTCUT` | no Start menu shortcut |
| `/allusers` or `/currentuser` (electron-builder's) | who it's for |
| `--delete-app-data` (electron-builder's), when uninstalling | the app's settings and logs removed too |

**The sidebar.** The welcome and finish pages, the installer's and the uninstaller's, show the app's own
picture on their left, never electron-builder's stock one: `config()` makes it from `build.linux.icon`, the
icon centred with a drop shadow on a soft gradient in the app's colour. The colour is the app's `--accent`,
from `src/styles/accent.css`, unless the app chooses another:

```js
sidebar: { colour: "logo" },     // the icon's most common colour, leaving out white, black and grey
sidebar: { colour: "#208637" },  // a colour of its own
```

The icon is read as an 8-bit RGB or RGBA PNG that isn't interlaced, as most editors save one; `config()`
refuses any other, saying how to save it again. Its paths are the app's folder's, where electron-builder runs.
The same icon and colour always make the same image.

`config()` writes the installer's include and the sidebar outside the app, in a
`diamonddigitaldev-electron-kit` folder in the system's temp folder, so they're never packed or committed.
Where that folder isn't the person's own or can't be written to (on Linux, `/tmp` is shared, and another
user, or root in a container, may have made it), it uses a new folder of its own beside it instead.

The kit's CI installs the demo silently with each choice, reads back what it wrote to the registry and
the shortcuts it made, and whether the app's data survives an update and each kind of uninstall
(`scripts/check-installer.ps1`). It then runs the installer and uninstaller with their pages showing, steps
through them, ticking only "Also remove settings and logs", and keeps a picture of each page for 3 days
(`scripts/capture-installer.ps1`): a change to a page is looked at there, or by running the script after
building the demo.

### On Linux

**On Linux,** the packages can't ask anything as they install, so the app is offered for its types the
way Linux does it. The `.desktop` file the `.deb` and `.rpm` install lists each type's MIME types, so the
app is in the file manager's Open With for each. It opens a type by default only where no app has been
chosen for it. `allFiles` lists `application/octet-stream`, so the app is in Open With for any file. The
kit knows the MIME types of the extensions the house's apps open (`builder/mime.js`, every name each is
known by); for another, give its types in the group:

```js
{ name: "Project", ext: ["dgp"], mimeTypes: { dgp: "application/x-dgp-project" } }
```

The `.desktop` file's command ends in `%F`, so a file manager hands over every selected file as a path,
which `start({ files: true })` passes to the page. The `.desktop` file is named for the app's `appId`
(`com.diamonddigitaldev.<app>.desktop`), and `config()` writes the same name into the packaged
`package.json` as `desktopName`, which Electron gives the running window. So the dock shows the app's
icon for its window, not a generic one. There's no right-click entry on Linux: each file manager has its
own kind, and Open With does the job. The `.deb` and `.rpm` install for everyone on the computer; the
AppImage runs for whoever runs it, and only adds itself to the menu and Open With through a tool such as
AppImageLauncher.

**The `.deb` and `.rpm` update themselves**, as the AppImage does: electron-builder puts the update
config and the package's type inside them, and the updater downloads the next `.deb` or `.rpm` from the
release and installs it, after the system asks for the person's password (pkexec). There's no apt or dnf
repository, so without it they'd never update. So a release attaches the `.deb` and `.rpm` as well as
the AppImage and `latest-linux.yml`.

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
