<div align="center">

   # electron-kit

   <p style="margin-bottom:1rem;">The shared design system for Diamond Digital Development's Electron apps.</p>

</div>

<div align="center">

  ![license](https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square)
  ![version](https://img.shields.io/badge/version-0.0.0-lightgrey?style=flat-square)
  ![platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey?style=flat-square)

  [![discord](https://img.shields.io/discord/667479986214666272?logo=discord&logoColor=white&style=flat-square)](https://diamonddigital.dev/discord)
  [![buy me a coffee](https://img.shields.io/badge/-Buy%20Me%20a%20Coffee-ffdd00?logo=Buy%20Me%20A%20Coffee&logoColor=000000&style=flat-square)](https://www.buymeacoffee.com/willtda)

</div>

`@diamonddigitaldev/electron-kit` is one npm package that every Diamond Digital Development Electron app
installs. It holds what the apps share: main-process behaviour, a shared preload, page components and
CSS on Bootstrap 5.3, and test helpers. A fix to shared UI or behaviour is made once, here, and each app
takes it with a version bump.

It's in early development and not published to npm yet.

## What It Holds

| Export | What it is |
|---|---|
| `@diamonddigitaldev/electron-kit/main` | `start()`, called once at the top of an app's `main.js` |
| `@diamonddigitaldev/electron-kit/preload.js` | the shared bridge, `window.kitAPI`, registered on the app's session by `start()` |
| `@diamonddigitaldev/electron-kit/page/kit.js` | the page library, `window.kit`, loaded as a classic script |
| `@diamonddigitaldev/electron-kit/css/kit.css` | the shared styles, linked after Bootstrap and before the app's `accent.css` |
| `@diamonddigitaldev/electron-kit/testing` | helpers for an app's tests |

Electron 44 or newer, `electron-updater`, `electron-store`, Bootstrap 5.3 and Material Icons are peer
dependencies: each app installs its own.

### The Shared Preload

An app keeps its own sandboxed preload for its own channels (`window.electronAPI`). `start()` registers
the kit's preload on the app's default session with `session.registerPreloadScript`, so every window in
that session also gets `window.kitAPI`. A window in another session or partition doesn't.

```js
const kit = require("@diamonddigitaldev/electron-kit/main").start();

kit.ready.then(() => {
    const win = new BrowserWindow({
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    win.loadFile(path.join(__dirname, "index.html"));
});
```

```html
<link rel="stylesheet" href="../node_modules/bootstrap/dist/css/bootstrap.min.css">
<link rel="stylesheet" href="../node_modules/material-icons/iconfont/round.css">
<link rel="stylesheet" href="../node_modules/@diamonddigitaldev/electron-kit/css/kit.css">
<link rel="stylesheet" href="styles/accent.css">
<link rel="stylesheet" href="styles.css">
...
<script src="../node_modules/@diamonddigitaldev/electron-kit/page/kit.js"></script>
```

## Development

Node.js 24 or newer.

```bash
npm install
npm test            # unit and contract tests (node --test)
npm run test:e2e    # real-Electron tests: Playwright drives demo/
npm run demo        # launch the demo app
```

`demo/` is a small Electron app on the kit. It installs the kit as a packed copy, the way an app gets it
from npm; `npm run demo` and `npm run test:e2e` refresh that copy first.

## License

electron-kit is licensed under the Apache 2.0 License. See the [LICENSE](LICENSE) file for details.

## Acknowledgements

- Built with [Electron](https://www.electronjs.org/) and [Bootstrap](https://getbootstrap.com/)
- Icons from [Material Icons](https://fonts.google.com/icons)

### AI Disclosure

This project uses AI tools to aid development. Read our [AI Transparency & Quality Commitment](https://diamonddigital.dev/ai-transparency) statement for more information.

## Contact Us

- Need help or want to chat? [Join our Discord Server](https://diamonddigital.dev/discord)!
- Found a bug? [Open an issue](https://github.com/diamonddigitaldev/electron-kit/issues) on our GitHub repository.
- Have a feature request? [Submit it here](https://github.com/diamonddigitaldev/electron-kit/issues/new?labels=enhancement)!

---

<div align="center">
  <a href="https://diamonddigital.dev/">
  <strong>Created and maintained by</strong>
  <img align="center" alt="Diamond Digital Development Logo" src="https://diamonddigital.dev/img/png/ddd_logo_text_transparent.png" style="width:25%;height:auto" /></a>
</div>
