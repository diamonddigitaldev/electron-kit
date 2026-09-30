"use strict";

// The focused element's focus ring, measured in the page: what it is (its
// role and name), how its outline is drawn, and the colour behind the ring.
// The ring sits outside the element, so what's behind it is the parent's
// background, laid over each ancestor's in turn down to the window's own.

const { contrastRatio, parseColor, over } = require("../../testing");

/**
 * The focused element and its ring.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<{ role: string, name: string, tag: string, outline: { style: string, width: number, color: string }, behind: string[] }>}
 */
async function focused(page) {
    // The accessible name, as a screen reader has it: the first line of the focused element's ARIA snapshot, "- role "name"".
    const [first] = (await page.locator("*:focus").ariaSnapshot()).split("\n");
    const [, role, name = ""] = /^- ([\w-]+)(?: "((?:[^"\\]|\\.)*)")?/.exec(first) ?? [];
    const ring = await page.evaluate(() => {
        const element = document.activeElement;
        const style = getComputedStyle(element);
        const behind = [];
        for (let node = element.parentElement; node; node = node.parentElement) {
            behind.push(getComputedStyle(node).backgroundColor);
        }
        return {
            tag: element.tagName.toLowerCase(),
            outline: { style: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor },
            behind,
        };
    });
    return { role, name, ...ring };
}

/** The colour behind a ring: each ancestor's background laid over the next, over white (the window). */
function behindColour(behind) {
    return behind.reduceRight((below, colour) => over(parseColor(colour), below), parseColor("#fff"));
}

/**
 * The focused element's ring: solid, at least 2px, and 3:1 or more against
 * what's behind it. Returns a line saying what's wrong, or null.
 * @param {Awaited<ReturnType<typeof focused>>} info
 */
function ringProblem({ name, outline, behind }) {
    if (outline.style !== "solid") return `"${name}": its ring is ${outline.style}, not solid`;
    if (outline.width < 2) return `"${name}": its ring is ${outline.width}px wide`;
    const ratio = contrastRatio(parseColor(outline.color), behindColour(behind));
    if (ratio < 3) return `"${name}": its ring is ${ratio.toFixed(2)}:1 against what's behind it`;
    return null;
}

module.exports = { focused, ringProblem, behindColour };
