"use strict";

// Before an unpackaged run, the demo gets the kit's current files
// (scripts/refresh-demo.js). A packaged build carries its own copy, so a run
// against one (KIT_DEMO_EXECUTABLE) leaves demo/ alone.

const { refreshDemo } = require("../scripts/refresh-demo");

module.exports = () => {
    if (!process.env.KIT_DEMO_EXECUTABLE) refreshDemo();
};
