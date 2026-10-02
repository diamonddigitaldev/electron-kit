#!/usr/bin/env node
"use strict";

// The kit's command, run with npx:
//
//     npx @diamonddigitaldev/electron-kit skill            copy the ddd-electron-ui skill into this app's .claude/skills/
//     npx @diamonddigitaldev/electron-kit skill --check    fail if this app's copy isn't the kit's
//     npx @diamonddigitaldev/electron-kit skill --user     the same, for ~/.claude/skills/ (every project on the machine)
//
// The skill is the kit's rules for a coding agent (skill/ddd-electron-ui/),
// shipped with each version, so an app's copy matches the kit it runs on.

const fs = require("fs");
const os = require("os");
const path = require("path");

/** The skill's name, and its folder in the package. */
const SKILL = "ddd-electron-ui";
const SOURCE = path.join(__dirname, "..", "skill", SKILL);

const USAGE = `Usage: npx @diamonddigitaldev/electron-kit <command>

Commands:
  skill [--dir <app>] [--user] [--check]
        Copy the ${SKILL} skill into the app's .claude/skills/${SKILL}/.
        --dir <app>  the app's folder (the current folder if not given)
        --user       your own skills folder instead (~/.claude/skills/), for every project
        --check      copy nothing; fail if the copy there isn't this version's`;

/** Every file in a folder, as paths relative to it, sorted. */
function filesIn(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
        .sort();
}

/** The files that differ between the kit's skill and a copy of it (missing, changed or extra). */
function differences(target) {
    const theirs = filesIn(target);
    const found = [];
    for (const file of filesIn(SOURCE)) {
        const there = path.join(target, file);
        if (!fs.existsSync(there)) found.push(`${file} is missing`);
        else if (!fs.readFileSync(there).equals(fs.readFileSync(path.join(SOURCE, file)))) found.push(`${file} differs`);
    }
    for (const file of theirs) if (!fs.existsSync(path.join(SOURCE, file))) found.push(`${file} isn't the kit's`);
    return found;
}

/**
 * The skill command.
 * @param {string[]} args
 * @param {{ out?: (line: string) => void, home?: string, cwd?: string }} [io]
 * @returns {number} The exit code.
 */
function skill(args, { out = console.log, home = os.homedir(), cwd = process.cwd() } = {}) {
    let dir = cwd;
    let user = false;
    let check = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--user") user = true;
        else if (args[i] === "--check") check = true;
        else if (args[i] === "--dir" && args[i + 1]) dir = path.resolve(cwd, args[++i]);
        else {
            out(`Unknown option: ${args[i]}\n\n${USAGE}`);
            return 2;
        }
    }
    if (user && dir !== cwd) {
        out("--user and --dir name two places; give one.");
        return 2;
    }
    const target = path.join(user ? home : dir, ".claude", "skills", SKILL);

    if (check) {
        const found = differences(target);
        if (found.length === 0) {
            out(`${target} is the kit's ${SKILL} skill.`);
            return 0;
        }
        out(`${target} isn't the kit's ${SKILL} skill:\n${found.map((line) => `  - ${line}`).join("\n")}\nRun: npx @diamonddigitaldev/electron-kit skill${user ? " --user" : ""}`);
        return 1;
    }
    if (!user && !fs.existsSync(path.join(dir, "package.json"))) {
        out(`${dir} has no package.json: run this in the app's folder, or give it with --dir.`);
        return 2;
    }
    // The kit's files only: anything else there was an earlier version's.
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(SOURCE, target, { recursive: true });
    out(`Copied the ${SKILL} skill into ${target}.`);
    return 0;
}

/**
 * Run the command line.
 * @param {string[]} argv - The arguments after the command's name.
 * @param {object} [io]
 * @returns {number} The exit code.
 */
function main(argv, io = {}) {
    const [command, ...rest] = argv;
    const out = io.out ?? console.log;
    if (command === "skill") return skill(rest, io);
    if (command === undefined || command === "help" || command === "--help" || command === "-h") {
        out(USAGE);
        return command === undefined ? 2 : 0;
    }
    out(`Unknown command: ${command}\n\n${USAGE}`);
    return 2;
}

module.exports = { main, skill, differences, SKILL, SOURCE };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
