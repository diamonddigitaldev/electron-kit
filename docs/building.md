# Building

The electron-builder config every app builds with, the files it opens on each platform, the update files every release carries, and how an app names its files.

[All the docs](README.md)

## Building

An app's electron-builder config is `electron-builder.js`, beside its `package.json`, made by the kit's
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
});
```

`package.json` has no `build` then: electron-builder reads it before `electron-builder.js`, so `config()`
refuses a `package.json` that still has one. `build` is the app's own electron-builder options, as they
were in `package.json`, and `config()` adds the rest:

- `extends`, the kit's `builder/base.json`;
- **Linux's desktop entry**, from the app's `appId` and its files (below);
- nothing from the file types on Windows yet: the kit owns an app's file associations, and never sets
  electron-builder's `fileAssociations`, which claim every type without asking. So `config()` refuses
  `fileAssociations` (anywhere), `linux.mimeTypes`, `linux.executableArgs`, `linux.syncDesktopName`,
  `linux.desktop` and `extraMetadata.desktopName`, and an `extends` of the app's own.

`build.appId` (such as `com.diamonddigitaldev.dropgateclient`) and `build.linux.category`, one of
freedesktop.org's main categories (`AudioVideo`, `Audio`, `Video`, `Development`, `Education`, `Game`,
`Graphics`, `Network`, `Office`, `Science`, `Settings`, `System`, `Utility`), are needed.

`builder/base.json` gives every app the same builds: NSIS on Windows, in the Start menu's `Diamond
Digital Development` folder; AppImage, `.deb` and `.rpm` on Linux, built on Linux; and
`generateUpdatesFilesForAllChannels`, which writes each channel's own update file for an update server
that has no releases of its own (a `generic` one). The app gives its own identity, files, icons, file
associations and `publish` (where the updater looks).

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
the config with `assertBuildExtendsKit(require("../electron-builder.js"))` from `electron-kit/testing`.

## The Files an App Opens

`fileTypes` lists them in groups, each with a name and its extensions, lowercase and without the dot.
An app that takes any file (Dropgate) sets `allFiles: true` instead.

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
