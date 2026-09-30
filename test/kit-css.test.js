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
