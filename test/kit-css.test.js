"use strict";

// css/kit.css, the token layer: the house tokens, everything but the accent
// (which is each app's accent.css), the Bootstrap bridge that binds the accent
// into Bootstrap's primary, and reduced motion.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { ACCENT_PROPERTIES } = require("../testing");

const KIT_CSS = fs.readFileSync(path.join(__dirname, "..", "css", "kit.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";

/** The house tokens and their values. */
const TOKENS = {
    "--dur-micro": "120ms",
    "--dur-state": "0.2s",
    "--dur-default": "0.3s",
    "--dur-enter": "0.4s",
    "--dur-ambient": "2s",
    "--ease-micro": "ease",
    "--ease-state": "ease-in-out",
    "--ease-standard": "cubic-bezier(0.4, 0, 0.2, 1)",
    "--ease-spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
    "--wash-hover-fill": "0.04",
    "--wash-active-fill": "0.06",
    "--wash-hover-border": "0.5",
    "--wash-active-border": "1",
    "--wash-semantic-fill": "0.1",
    "--wash-semantic-border": "0.3",
    "--radius-control": "5px",
    "--radius-card": "8px",
    "--radius-zone": "12px",
    "--radius-pill": "50rem",
    "--opacity-disabled": "0.5",
    "--opacity-muted": "0.75",
    "--timing-debounce": "500ms",
    "--timing-progress-reset": "3000ms",
    "--timing-toast": "4500ms",
    "--focus-ring-width": "2px",
    "--focus-ring-offset": "2px",
    "--scrollbar-width": "6px",
    "--scrollbar-thumb": "rgba(128, 128, 128, 0.3)",
    "--scrollbar-thumb-hover": "rgba(128, 128, 128, 0.5)",
};

/** A block's text, from its opening brace to the matching closing one. */
function blockAfter(css, start) {
    const open = css.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === "{") depth++;
        if (css[i] === "}" && --depth === 0) return { body: css.slice(open + 1, i), end: i + 1 };
    }
    throw new Error("unbalanced braces");
}

/** A stylesheet's rules, as [{ selector, declarations }], with at-rules set apart. */
function rulesOf(css) {
    const rules = [];
    const atRules = {};
    let rest = css;
    for (let at = rest.indexOf("@"); at >= 0; at = rest.indexOf("@")) {
        const { body, end } = blockAfter(rest, at);
        atRules[rest.slice(at, rest.indexOf("{", at)).trim()] = body;
        rest = rest.slice(0, at) + rest.slice(end);
    }
    for (const [, selector, body] of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const declarations = Object.fromEntries(body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
            const colon = d.indexOf(":");
            return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()];
        }));
        rules.push({ selector: selector.trim().replace(/\s*,\s*/g, ", "), declarations });
    }
    return { rules, atRules };
}

const { rules: KIT_RULES, atRules: KIT_AT_RULES } = rulesOf(KIT_CSS);
const rule = (selector) => {
    const found = KIT_RULES.filter((r) => r.selector === selector);
    assert.equal(found.length, 1, `kit.css has one "${selector}" rule`);
    return found[0].declarations;
};

test("kit.css has the house tokens, in :root, with their values", () => {
    const root = rule(":root");
    for (const [name, value] of Object.entries(TOKENS)) assert.equal(root[name], value, name);
    assert.deepEqual(Object.keys(root).sort(), Object.keys(TOKENS).sort(), "kit.css's :root holds the tokens and nothing else");
});

test("each token is set once, outside reduced motion", () => {
    for (const name of Object.keys(TOKENS)) {
        const set = KIT_RULES.filter((r) => Object.hasOwn(r.declarations, name));
        assert.equal(set.length, 1, name);
    }
});

test("kit.css leaves the accent to the app: it sets none of the accent's eight values", () => {
    for (const { selector, declarations } of KIT_RULES) {
        for (const name of Object.keys(ACCENT_PROPERTIES)) {
            assert.ok(!Object.hasOwn(declarations, name), `"${selector}" sets ${name}`);
        }
    }
});

test("kit.css reads only the accent's eight values and the theme's pair it picks from them", () => {
    const read = new Set([...KIT_CSS.matchAll(/var\((--accent[\w-]*)\)/g)].map(([, name]) => name));
    const allowed = new Set([...Object.keys(ACCENT_PROPERTIES), "--accent-text", "--accent-link"]);
    assert.deepEqual([...read].filter((name) => !allowed.has(name)), []);
    // Everything the app gives is used, except the per-theme shades, which are read through the pair.
    for (const name of ["--accent", "--accent-hover", "--accent-rgb", "--accent-contrast"]) assert.ok(read.has(name), name);
});

test("kit.css picks the light theme's text and link shades by default, and the dark theme's under [data-bs-theme=dark]", () => {
    assert.deepEqual(rule(':root, [data-bs-theme="light"]'), {
        "--accent-text": "var(--accent-text-light)",
        "--accent-link": "var(--accent-link-light)",
    });
    assert.deepEqual(rule('[data-bs-theme="dark"]'), {
        "--accent-text": "var(--accent-text-dark)",
        "--accent-link": "var(--accent-link-dark)",
    });
    // The dark rule comes after the light one, so it wins on an element that matches both (<html data-bs-theme="dark"> is also :root).
    assert.ok(KIT_CSS.indexOf('[data-bs-theme="dark"] {') > KIT_CSS.indexOf('[data-bs-theme="light"] {'));
});

test("the bridge binds the accent into Bootstrap's primary and its links, in both themes", () => {
    assert.deepEqual(rule(':root, [data-bs-theme="light"], [data-bs-theme="dark"]'), {
        "--bs-primary": "var(--accent)",
        "--bs-primary-rgb": "var(--accent-rgb)",
        "--bs-link-color": "var(--accent-link)",
        "--bs-link-hover-color": "var(--accent-text)",
        "--bs-link-color-rgb": "var(--accent-rgb)",
        "--bs-link-hover-color-rgb": "var(--accent-rgb)",
        "--bs-focus-ring-color": "rgba(var(--accent-rgb), 0.25)",
    });
    // Links take the shades directly, not the fill's triplet Bootstrap colours them from.
    assert.deepEqual(rule("a"), { color: "var(--bs-link-color)" });
    assert.deepEqual(rule("a:hover"), { color: "var(--bs-link-hover-color)" });
    assert.deepEqual(rule(".progress, .progress-stacked"), {
        "--bs-progress-bar-bg": "var(--accent)",
        "--bs-progress-bar-color": "var(--accent-contrast)",
    });
});

test("the bridge sets every colour Bootstrap's .btn-primary sets, each from the accent", () => {
    const bootstrap = rulesOf(fs.readFileSync(require.resolve("bootstrap/dist/css/bootstrap.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
    const theirs = bootstrap.rules.find((r) => r.selector === ".btn-primary").declarations;
    const ours = rule(".btn-primary");
    const colours = Object.keys(theirs).filter((name) => name !== "--bs-btn-active-shadow");
    assert.deepEqual(Object.keys(ours).sort(), colours.sort());
    for (const [name, value] of Object.entries(ours)) {
        const expected = /^--bs-btn-((hover|active|disabled)-)?color$/.test(name) ? "var(--accent-contrast)"
            : name === "--bs-btn-focus-shadow-rgb" ? "var(--accent-rgb)"
                : /^--bs-btn-(hover|active)-/.test(name) ? "var(--accent-hover)"
                    : "var(--accent)";
        assert.equal(value, expected, name);
    }
});

test("under reduced motion every duration token goes to (near) zero, and the ambient pulse stops", () => {
    assert.ok(Object.hasOwn(KIT_AT_RULES, REDUCED_MOTION), `kit.css has ${REDUCED_MOTION}`);
    const { rules } = rulesOf(KIT_AT_RULES[REDUCED_MOTION]);
    assert.equal(rules.length, 1);
    assert.equal(rules[0].selector, ":root");
    const durations = Object.keys(TOKENS).filter((name) => name.startsWith("--dur-"));
    assert.deepEqual(Object.keys(rules[0].declarations).sort(), durations.sort(), "every --dur-* token, and nothing else");
    for (const [name, value] of Object.entries(rules[0].declarations)) {
        // A pulse repeats forever: at a near-zero duration it would flicker, so it's 0s, which isn't drawn.
        assert.equal(value, name === "--dur-ambient" ? "0s" : "0.01ms", name);
    }
});

test("kit.css has no at-rule but reduced motion", () => {
    assert.deepEqual(Object.keys(KIT_AT_RULES), [REDUCED_MOTION]);
});

test("the rail's active item is drawn in the accent's text shade, never its fill (every app's fill is under 3:1 on the rail in one theme)", () => {
    const active = rule(".nav-rail .nav-item.active");
    assert.equal(active.color, "var(--accent-text)");
    assert.equal(active["border-color"], "var(--accent-text)");
    assert.equal(active["background-color"], "rgba(var(--accent-rgb), var(--wash-active-fill))");
    for (const { selector, declarations } of KIT_RULES.filter((r) => r.selector.includes(".nav-rail"))) {
        for (const [name, value] of Object.entries(declarations)) {
            assert.doesNotMatch(value, /var\(--accent\)/, `${selector} { ${name} } uses the fill`);
        }
    }
});

test("a collapsed rail hides its labels visually, never with display: none, so each item keeps its name", () => {
    const hidden = rule(".nav-rail.collapsed .nav-label");
    assert.equal(hidden.position, "absolute");
    assert.equal(hidden.width, "1px");
    assert.equal(hidden.height, "1px");
    assert.equal(hidden.overflow, "hidden");
    assert.equal(hidden["clip-path"], "inset(50%)");
    for (const { selector, declarations } of KIT_RULES.filter((r) => r.selector.includes("nav-label"))) {
        assert.notEqual(declarations.display, "none", selector);
        assert.notEqual(declarations.visibility, "hidden", selector);
    }
});

test("every focus ring the kit draws is a solid ring in the accent's text shade, and Bootstrap's glow is gone", () => {
    const ring = "var(--focus-ring-width) solid var(--accent-text)";
    const rings = KIT_RULES.filter((r) => Object.hasOwn(r.declarations, "outline") && r.declarations.outline !== "none");
    assert.ok(rings.length >= 3);
    for (const { selector, declarations } of rings) assert.equal(declarations.outline, ring, selector);
    const focus = rule(":focus-visible, .btn:focus-visible, .nav-link:focus-visible, .form-check-input:focus-visible, .form-range:focus-visible");
    assert.equal(focus["box-shadow"], "none");
    assert.equal(rule(".btn")["--bs-btn-focus-box-shadow"], "none");
    assert.equal(rule(".form-control:focus, .form-select:focus")["box-shadow"], "none");
    // Nothing that can take focus goes without a ring.
    assert.deepEqual(KIT_RULES.filter((r) => r.declarations.outline === "none" || r.declarations.outline === "0").map((r) => r.selector), []);
});

test("checked boxes and switches fill with the accent, and unchecked ones are outlined in the secondary text colour", () => {
    assert.deepEqual(rule('.form-check-input:checked, .form-check-input[type="checkbox"]:indeterminate'), {
        "background-color": "var(--accent)",
        "border-color": "var(--accent)",
    });
    assert.equal(rule(".form-check-input")["border-color"], "var(--bs-secondary-color)");
    // The switch's knob: the secondary text colour when off, the fill's text colour when on.
    assert.equal(rule(".form-switch .form-check-input::before")["background-color"], "var(--bs-secondary-color)");
    assert.equal(rule(".form-switch .form-check-input:checked::before")["background-color"], "var(--accent-contrast)");
    // The tick, in the fill's text colour.
    assert.equal(rule('.form-check-input[type="checkbox"]:not([role="switch"])::after').border, "solid var(--accent-contrast)");
});

test("the tick and the knob are drawn by the kit, spring into place, and are timed by the tokens that reduced motion takes to zero", () => {
    // Bootstrap's images, which can't move, are gone.
    assert.equal(rule('.form-check-input[type="checkbox"]:not([role="switch"])')["background-image"], "none");
    assert.equal(rule(".form-switch .form-check-input")["background-image"], "none");
    const tick = rule('.form-check-input[type="checkbox"]:not([role="switch"])::after');
    assert.match(tick.transform, /scale\(0\)$/);
    assert.match(rule('.form-check-input[type="checkbox"]:not([role="switch"]):checked::after').transform, /scale\(1\)$/);
    assert.equal(tick.transition, "transform var(--dur-state) var(--ease-spring)");
    assert.match(rule(".form-switch .form-check-input::before").transition, /^transform var\(--dur-state\) var\(--ease-spring\)/);
    // Every animated control is timed by a --dur-* token, never a literal.
    for (const { selector, declarations } of KIT_RULES.filter((r) => r.selector.includes("form-check-input"))) {
        if (declarations.transition) assert.doesNotMatch(declarations.transition.replace(/var\(--dur-[a-z]+\)/g, ""), /\d(ms|s)/, selector);
    }
});

test("the Settings tabs sit on a thin line, with a bar in the accent's fill that moves by transition", () => {
    assert.equal(rule(".settings-tabs")["border-bottom"], "1px solid var(--bs-border-color)");
    const bar = rule(".settings-tab-indicator");
    assert.equal(bar["background-color"], "var(--accent)");
    assert.equal(bar.width, "var(--indicator-width, 0)");
    assert.equal(bar.transform, "translateX(var(--indicator-x, 0))");
    assert.equal(bar.transition.replace(/\s+/g, " "), "transform var(--dur-default) var(--ease-standard), width var(--dur-default) var(--ease-standard)");
});
