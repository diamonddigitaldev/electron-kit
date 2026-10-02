# Getting Started

What the package exports, and the first code an app writes: `start()` in `main.js`, and the page's stylesheets and scripts.

[All the docs](README.md)

## What It Holds

| Export | What it is |
|---|---|
| `@diamonddigitaldev/electron-kit/main` | `start(config)`, called once at the top of an app's `main.js` |
| `@diamonddigitaldev/electron-kit/preload.js` | the shared bridge, `window.kitAPI`, registered on the app's session by `start()` |
| `@diamonddigitaldev/electron-kit/page/theme.js` | the theme script, loaded in `<head>`: draws the page in the OS theme and follows it |
| `@diamonddigitaldev/electron-kit/page/kit.js` | the page library, `window.kit`, loaded as a classic script: `kit.ui.mountShell()` builds the nav rail, the header and the Settings view; `kit.ui.toast()`, `kit.ui.confirm()`, the parts of a section of files, `kit.keys` and `kit.format` |
| `@diamonddigitaldev/electron-kit/css/kit.css` | the shared styles, linked after Bootstrap and before the app's `accent.css` |
| `@diamonddigitaldev/electron-kit/format` | `kit.format` under Node, for a file loaded both in the page and under Node |
| `@diamonddigitaldev/electron-kit/testing` | helpers for an app's tests ([Testing an App](testing.md)) |

## The Shared Preload

An app keeps its own sandboxed preload for its own channels (`window.electronAPI`). `start()` registers
the kit's preload on the app's default session with `session.registerPreloadScript`, so every window in
that session also gets `window.kitAPI`. A window in another session or partition doesn't
([isolated sessions](main-process.md#isolated-sessions)).

```js
const kit = require("@diamonddigitaldev/electron-kit/main").start({
    settings: { defaults: { overwrite: false } },        // the app's own settings (main-process.md)
    credits: {                                           // the Credits tab (shell.md)
        lines: [
            ["Created and maintained by ", { text: "Diamond Digital Development", href: "https://diamonddigital.dev" }, "."],
            "This software is licensed under the Apache 2.0 license.",
        ],
        donate: "https://buymeacoff.ee/willtda",
    },
    menu: { items: [{ label: "Open Files", accelerator: "CmdOrCtrl+O", click: openFiles }] }, // (main-process.md)
});

kit.ready.then(() => kit.windows.createMain({                 // (main-process.md)
    page: path.join(__dirname, "index.html"),
    size: { width: 1100, height: 780 },
    webPreferences: { preload: path.join(__dirname, "preload.js") },
}));
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

`window.kitAPI`, `window.electronAPI` and `window.kit` are globals, so a classic script mustn't declare a
top-level `const`, `let`, `function` or `class` of the same name: `const kitAPI = window.kitAPI;` throws
"Identifier 'kitAPI' has already been declared", and the whole script never runs. Give the local another
name (`const kitApi = window.kitAPI;`), or use `window.kitAPI` where it's needed.
