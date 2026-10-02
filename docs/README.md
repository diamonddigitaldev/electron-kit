# electron-kit's Docs

How to build a Diamond Digital Development Electron app on `@diamonddigitaldev/electron-kit`, and how the
kit works. Each page covers one part of it. Start with Getting Started, then read what your app uses.

These pages describe the kit on `master`. The package's own README, the one npm shows, only introduces it
and links here, so these can be corrected without a new release.

## Contents

| Page | What it covers |
|---|---|
| [Getting Started](getting-started.md) | What the package exports, `start()` at the top of `main.js`, and the stylesheets and scripts a page loads |
| [IPC](ipc.md) | The shared channels behind `window.kitAPI`, and `kit.ipc.handle()` for an app's own, each answering the app's own page only |
| [The Shell, Settings and Credits](shell.md) | `kit.ui.mountShell()`: the nav rail, the header, and the Settings view with its Update and Credits tabs |
| [Page Components](page-components.md) | Toasts, prompts, the parts of a section of files (drop zone, progress, action bar), the key guard, and `kit.format` |
| [The Main Process](main-process.md) | The main window, isolated sessions, spell checking, one instance and the files an app is opened with, the settings and their migration, the redacted log, and the menu |
| [Updates](updates.md) | The updater: when it checks, Stable, Beta and Alpha, automatic downloads, and its state |
| [Building](building.md) | The electron-builder base config, the update files every release carries, and naming an app's files |
| [Theme, Accent and Tokens](theming.md) | The OS theme, an app's accent and its WCAG 2.2 AA check, the house tokens, focus rings and controls |
| [Testing an App](testing.md) | The helpers for an app's own tests: nothing reached beyond the machine, the preload, the menu, the accent and the build config |
| [Development](development.md) | Working on the kit: its tests, the demo app, CI and the visual baselines |
