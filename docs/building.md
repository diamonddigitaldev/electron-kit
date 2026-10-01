# Building

The electron-builder base config every app extends, the update files every release carries, and how an app names its files.

[All the docs](README.md)

## Building

An app's electron-builder config extends the kit's, in its `package.json`:

```json
"build": {
    "extends": "@diamonddigitaldev/electron-kit/builder/base.json",
    "appId": "com.diamonddigitaldev.<app>",
    "productName": "<App>",
    "publish": { "provider": "github", "owner": "diamonddigitaldev", "repo": "<App>" }
}
```

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
the config with `assertBuildExtendsKit(require("../package.json"))` from `electron-kit/testing`.

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
