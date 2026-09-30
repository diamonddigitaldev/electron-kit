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
| `@diamonddigitaldev/electron-kit/page/theme.js` | the theme script, loaded in `<head>`: draws the page in the OS theme and follows it |
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
<script src="../node_modules/@diamonddigitaldev/electron-kit/page/theme.js"></script>
...
<script src="../node_modules/@diamonddigitaldev/electron-kit/page/kit.js"></script>
```

### The Shared Channels

| Channel | Kind | `window.kitAPI` |
|---|---|---|
| `app:get-version` | the page asks | `getVersion()`: the app's version |
| `theme:changed` | the kit pushes | `onThemeChanged(callback)`: `"dark"` or `"light"` on each change of the OS theme; returns a function that stops listening |

A pushed value reaches the callback on its own, never with the IPC event behind it.

The kit's preload runs in every page of the app's session, so `window.kitAPI` is in any page a window of
it shows: the app's own, but also a page a window is navigated to, or one it opens. So the kit answers the
app's own page only: a `file://` page inside the app's code (`app.getAppPath()`, `app.asar` when packaged),
in the app's default session. Every shared handler makes that check before it runs, and any other sender's
call rejects:

```
Error invoking remote method 'app:get-version': Error: electron-kit answers "app:get-version" for the app's own page only.
```

### The Theme

`theme.js` goes in `<head>`, after the stylesheets, as a plain script (not `async`, `defer` or a module).
It stamps `data-bs-theme`, `"dark"` or `"light"`, on `<html>` from `prefers-color-scheme` before the body
parses, so the first paint is already in the OS theme. Then it follows the OS theme two ways, and applies
whichever change arrives first: the media query's change, and `start()`'s `theme:changed` push, which the
main process sends every window from `nativeTheme`. The push is there because the media query's change
doesn't always reach the page: on real Windows, an app once stayed dark after Windows switched to Light.
The page needs no code of its own for either, and a window without `window.kitAPI` follows the media
query alone.

To test it, switch the theme as the OS does, with `nativeTheme.themeSource` set from the main process, or
emulate the media query with `page.emulateMedia({ colorScheme })`. Playwright's `_electron.launch()` holds
every page's `prefers-color-scheme` at light unless it's given `colorScheme: null`.

### The Accent

The accent is the only thing that differs between the apps. Each app's `src/styles/accent.css` sets its
eight values in one `:root` block, and `kit.css` reads nothing else of the app's:

```css
:root {
    --accent:            #0d6efd;      /* the fill: primary buttons, progress, checked boxes */
    --accent-hover:      #0b5ed7;      /* the fill, hovered or pressed */
    --accent-rgb:        13, 110, 253; /* --accent as r, g, b, for the washes */
    --accent-contrast:   #fff;         /* text and icons on the fill */
    --accent-text-light: #0a58ca;      /* accent text, and links on hover, in each theme */
    --accent-text-dark:  #8bb9fe;
    --accent-link-light: #0d6efd;      /* links, in each theme */
    --accent-link-dark:  #6ea8fe;
}
```

`kit.css` gives the theme's pair as `var(--accent-text)` and `var(--accent-link)`, so an app never writes
theme selectors. Every pairing meets WCAG 2.2 AA in both themes (4.5:1 for text, 3:1 for the parts of a
control) on Bootstrap's page and nav rail surfaces, including the rail's active item under its accent
wash. An app's tests check its own file:

```js
const { assertAccentContrast } = require("@diamonddigitaldev/electron-kit/testing");

test("the accent meets WCAG 2.2 AA in both themes", () => {
    assertAccentContrast("src/styles/accent.css");
});
```

A failure names each pairing under AA and its ratio. For a new accent, the shades that pass follow
Bootstrap's own link rules: the brand colour as the light link if it passes on white, or else the least
shade of it that does; the light text shade 20% darker; the dark link the brand tinted 40%; the dark text
shade 20% lighter again. White on the fill needs 4.5:1, so the hover goes darker, not lighter.

### Tokens

`kit.css` holds the house tokens: motion (`--dur-micro`, `--dur-state`, `--dur-default`, `--dur-enter`,
`--dur-ambient` and the `--ease-*` curves), the wash ladder (`--wash-*`, alphas for
`rgba(var(--accent-rgb), …)`), radii (`--radius-*`), opacity (`--opacity-disabled`, `--opacity-muted`), the
timings the JS side shares (`--timing-*`) and the scrollbar. It binds the accent into Bootstrap's primary
(`--bs-primary`, `.btn-primary`, links and `.progress`).

Under `prefers-reduced-motion: reduce`, the `--dur-*` tokens go to 0.01ms, so anything timed by them
finishes at once, and `--dur-ambient` goes to 0s, which stops a pulse rather than making it flicker.

## Development

Node.js 24 or newer.

```bash
npm install
npm test            # unit and contract tests (node --test)
npm run test:e2e    # real-Electron tests and axe: Playwright drives demo/
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
