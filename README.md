<div align="center">

   # @diamonddigitaldev/electron-kit

   <p style="margin-bottom:1rem;">The shared design system for Diamond Digital Development's Electron apps.</p>
</div>

<div align="center">

![license](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)
![version](https://img.shields.io/badge/version-0.1.0--beta.4-brightgreen?style=flat-square)
![electron](https://img.shields.io/badge/Electron-44+-blue?style=flat-square)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey?style=flat-square)

[![discord](https://img.shields.io/discord/667479986214666272?logo=discord&logoColor=white&style=flat-square)](https://diamonddigital.dev/discord)
[![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee&logoColor=000000&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>


## Overview

**@diamonddigitaldev/electron-kit** is the one package every Diamond Digital Development Electron app
installs. It holds what the apps share, so a fix to shared UI or behaviour is made once, here, and each app
takes it with a version bump:

- Main-process behaviour from one call, `start()`: a secure main window that keeps its place, one
  instance, the settings, a redacted log, the menu, and an updater with Stable, Beta and Alpha channels
- A shared preload, `window.kitAPI`, that answers the app's own page only
- Page components and CSS on Bootstrap 5.3: the nav rail, the Settings view with its Update and Credits
  tabs, toasts, prompts, drop zones and progress, in each app's accent, meeting WCAG 2.2 AA in both themes
- An electron-builder base config: an NSIS installer on Windows, AppImage, `.deb` and `.rpm` on Linux
- Test helpers for an app's own tests: the accent's contrast, the menu's shortcuts, the build config

It's in early development, and its versions are betas for now.

## Installation

```bash
npm install @diamonddigitaldev/electron-kit@next
```

Betas are published under npm's `next` tag. Electron 44 or newer, `electron-store`, Bootstrap 5.3 and
Material Icons are peer dependencies, and so is `electron-updater`, for an app that updates itself: each
app installs its own.

## Quick Start

At the top of the app's `main.js`:

```js
const path = require("path");

const kit = require("@diamonddigitaldev/electron-kit/main").start({
    settings: { defaults: { overwrite: false } },
    updates: {},
    log: "file",
});

kit.ready.then(() => kit.windows.createMain({
    page: path.join(__dirname, "index.html"),
    size: { width: 1100, height: 780 },
}));
```

Then, in the page, `kit.ui.mountShell()` builds the nav rail, the header and the Settings view around the
app's own sections. The docs show the stylesheets and scripts a page loads, and the rest.

## Documentation

The full docs are in the repository: start at [the docs' contents](https://github.com/diamonddigitaldev/electron-kit/blob/master/docs/README.md).

## License

Licensed under the **Apache-2.0 License**.
See the [LICENSE](./LICENSE) file for details.

## Acknowledgements

* Built with [Electron](https://www.electronjs.org/) and [Bootstrap](https://getbootstrap.com/)
* Icons from [Material Icons](https://fonts.google.com/icons)

### AI Disclosure

This project uses AI tools to aid development. Read our [AI Transparency & Quality Commitment](https://diamonddigital.dev/ai-transparency) statement for more information.

## Contact Us

* **Need help or want to chat?** [Join our Discord Server](https://diamonddigital.dev/discord)
* **Found a bug?** [Open an issue](https://github.com/diamonddigitaldev/electron-kit/issues)
* **Have a suggestion?** [Submit a feature request](https://github.com/diamonddigitaldev/electron-kit/issues/new?labels=enhancement)

<div align="center">
  <a href="https://diamonddigital.dev/">
  <strong>Created and maintained by</strong>
  <img align="center" alt="Diamond Digital Development Logo" src="https://diamonddigital.dev/img/png/ddd_logo_text_transparent.png" style="width:25%;height:auto" /></a>
</div>
