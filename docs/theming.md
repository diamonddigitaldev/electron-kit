# Theme, Accent and Tokens

The OS theme, each app's accent and its contrast check, the house tokens, focus rings and controls.

[All the docs](README.md)

## The Theme

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

## The Accent

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

## Tokens

`kit.css` holds the house tokens: motion (`--dur-micro`, `--dur-state`, `--dur-default`, `--dur-enter`,
`--dur-ambient` and the `--ease-*` curves, `--ease-spring` among them), the wash ladder (`--wash-*`, alphas for
`rgba(var(--accent-rgb), …)`), radii (`--radius-*`), opacity (`--opacity-disabled`, `--opacity-muted`), the
timings the JS side shares (`--timing-*`), the focus ring (`--focus-ring-width`, `--focus-ring-offset`) and
the scrollbar. It binds the accent into Bootstrap's primary (`--bs-primary`, `.btn-primary`, links and
`.progress`) and its form controls: a checked box or switch is the fill.

## Focus Rings and Controls

Bootstrap draws focus as a soft glow, a quarter-opaque ring, which is well under the 3:1 a focus indicator
needs. `kit.css` draws every focus ring as a solid 2px ring in the accent's text shade instead (keyboard
focus only, except in a text field or a select), over 4.5:1 on the page and the rail in both themes.

Checkboxes and switches are drawn by the kit rather than by Bootstrap's still images. A box someone ticks
fills with the accent and its tick is drawn, short stroke then long (`kit.js` asks for the drawing on the
change a person makes, so a box checked by the page, or shown again, has its tick there already), and
unticked, the tick springs away; a switch's knob slides across with a little overshoot and
stretches while it's pressed; both give a little when pressed, and their border takes the accent's text
shade on hover. Unchecked, they're drawn in the secondary text colour, not Bootstrap's 1.3:1 border colour,
so their outline meets 3:1 too. Bootstrap's outline secondary button (a `Cancel`, a `Clear All`) keeps its light
grey text on dark, at 3.28:1; there it takes the theme's secondary text colour instead. Bootstrap's close
button takes the kit's ring. All of it is timed by the `--dur-*` tokens and the `--ease-spring` curve,
so reduced motion stills it. The rail's icons sit on whole pixels, centred in each item when collapsed.

Under `prefers-reduced-motion: reduce`, the `--dur-*` tokens go to 0.01ms, so anything timed by them
finishes at once, and `--dur-ambient` goes to 0s, which stops a pulse rather than making it flicker.
