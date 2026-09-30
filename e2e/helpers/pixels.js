"use strict";

// Where something is actually drawn: an element's screenshot, read back pixel
// by pixel, and the box around every pixel that differs from its background
// (the top-left corner's colour). So a check can see where a glyph's ink is,
// not where its box is: an icon font's glyph can sit off-centre in a
// perfectly centred box.

/**
 * The box around an element's ink, and the element's own size, in CSS pixels.
 * @param {import("@playwright/test").Page} page
 * @param {import("@playwright/test").Locator} locator
 * @param {{ threshold?: number }} [options] - How far a channel may be from the background's and still count as background.
 * @returns {Promise<{ width: number, height: number, ink: { left: number, top: number, right: number, bottom: number } | null }>}
 */
async function inkBox(page, locator, { threshold = 48 } = {}) {
    const png = (await locator.screenshot({ animations: "disabled", caret: "hide" })).toString("base64");
    const box = await locator.boundingBox();
    return page.evaluate(async ({ png, box, threshold }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
        // The background: a pixel just inside the corner, clear of a rounded border.
        const at = (x, y) => (y * canvas.width + x) * 4;
        const corner = at(Math.round(canvas.width / 2), 3);
        const bg = [data[corner], data[corner + 1], data[corner + 2]];
        // Only the middle, clear of the element's own border.
        const margin = Math.round(4 * (canvas.width / box.width));
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (let y = margin; y < canvas.height - margin; y++) {
            for (let x = margin; x < canvas.width - margin; x++) {
                const i = at(x, y);
                if (Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2])) > threshold) {
                    left = Math.min(left, x);
                    top = Math.min(top, y);
                    right = Math.max(right, x + 1);
                    bottom = Math.max(bottom, y + 1);
                }
            }
        }
        const scale = canvas.width / box.width;
        return {
            width: box.width,
            height: box.height,
            ink: left === Infinity ? null : { left: left / scale, top: top / scale, right: right / scale, bottom: bottom / scale },
        };
    }, { png, box, threshold });
}

/** How far the ink's centre is from the element's, across and down, in CSS pixels. */
function offCentre({ width, height, ink }) {
    return { x: (ink.left + ink.right) / 2 - width / 2, y: (ink.top + ink.bottom) / 2 - height / 2 };
}

module.exports = { inkBox, offCentre };
