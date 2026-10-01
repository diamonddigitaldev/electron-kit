# Development

Working on the kit itself: its tests, the demo app, CI, and the visual baselines.

[All the docs](README.md)

## Tests and CI

Requires Node.js 24 or later.

```bash
npm ci
npm test            # unit and contract tests (node --test)
npm run test:e2e    # real-Electron tests and axe: Playwright drives demo/
npm run demo        # launch the demo app
```

`demo/` is a small Electron app on the kit. It installs the kit as a packed copy, the way an app gets it
from npm; `npm run demo` and `npm run test:e2e` refresh that copy first.

GitHub Actions runs the unit tests and the Electron tests, unpackaged and against the packaged demo, on
Ubuntu for every push and on Windows too for pull requests ([`ci.yml`](../.github/workflows/ci.yml)). It also
fails if the kit's version in `package.json`, `package-lock.json`, `demo/package-lock.json` and the badge at
the top of the root README don't agree, so change them together.

## Visual Tests

`e2e/visual.spec.js` compares the demo's window with committed images, in
`e2e/visual.spec.js-snapshots/`, using Playwright's `toHaveScreenshot()`. It takes 40 images:

| State | Accents | Themes |
|---|---|---|
| Settings > Update with an update waiting (and the dot), downloading, ready to install, and after a failed check | the demo's | light and dark |
| Settings on its General, Update and Credits tabs | the demo's | light and dark |
| Controls at rest (the box ticked, the switch off) | the demo's | light and dark |
| Controls toggled by keyboard (the box unticked, the switch on and focused) | the demo's and each app's | light and dark |
| The rail expanded, Overview active and Controls focused by keyboard | the demo's and each app's | light and dark |
| The rail collapsed, the same | the demo's | light and dark |
| A warning toast with its list shown | the demo's | light and dark |
| The batch prompt, Save as New focused by keyboard | the demo's | light and dark |
| A section of files: the drop zone, a bar not known, the action bar with Convert focused | the demo's | light and dark |

The app accents are the ones in `test/fixtures/accents/`. The page is 760 × 600 at a scale factor of 1, drawn without the GPU, as on the runner, which has none.
Motion is reduced, so every transition ends at once. The caret is hidden and the mouse is parked. The
pulse dot and the Electron version are masked. A pixel counts as changed past a colour difference of
0.02, not Playwright's 0.2, which would let a shade of the accent pass for another.

The images are Windows' (Segoe UI, as most people see the apps), so the spec runs on Windows only and
skips on Linux. CI runs it on pull requests, unpackaged and against the packaged demo. The images are
made on a Windows CI runner, never on a developer's machine, and a run never writes one unless asked.
Without the GPU, a Windows machine draws exactly what the runner does, so the spec passes locally too.

When a visual test fails in CI, the run uploads `visual-differences-<attempt>`, a workflow artifact
kept 3 days. For each image that changed, it holds what was expected, what was drawn and the difference.

When the look changes on purpose, or a state is added, update the baselines:

1. Push the branch.
2. Run the CI workflow by hand on that branch, with the images updated:
   `gh workflow run ci.yml --ref <branch> -f update-visual-baselines=true`. The same form is under
   Actions > CI > Run workflow.
3. When it's done, download the images to a folder of their own, then copy them over the committed ones
   (`gh run download` won't overwrite a file that's there):
   `gh run download <run id> -n visual-baselines -D <new folder>`, then
   `cp <new folder>/*.png e2e/visual.spec.js-snapshots/`.
4. Look at every changed image (`git diff --stat`, then open them), and commit only the changes you meant.

The artifact is kept 3 days.
