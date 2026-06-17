#!/usr/bin/env node
import {execFileSync} from "node:child_process"
import {readFileSync} from "node:fs"
import {resolve} from "node:path"

/**
 * @param {string} command - Command to run.
 * @param {string[]} args - Command arguments.
 * @param {import("node:child_process").StdioOptions} [stdio] - Child process stdio mode.
 * @returns {void}
 */
function run(command, args, stdio = "inherit") {
  execFileSync(command, args, {stdio})
}

/**
 * @returns {{scripts?: Record<string, string>}} Parsed package manifest.
 */
function readPackageJson() {
  return JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"))
}

/** @returns {void} */
function ensureNpmAuth() {
  try {
    run("npm", ["whoami"], "ignore")
  } catch {
    run("npm", ["login"])
  }
}

/** @returns {void} */
function ensureLatestMaster() {
  run("git", ["checkout", "master"])
  run("git", ["fetch", "origin"])
  run("git", ["merge", "--ff-only", "origin/master"])
}

ensureNpmAuth()
ensureLatestMaster()

const packageJson = readPackageJson()

if (packageJson.scripts?.build) {
  run("npm", ["run", "build"])
}

run("npm", ["version", "patch", "--no-git-tag-version"])
run("npm", ["install"])
run("git", ["add", "package.json", "package-lock.json"])
run("git", ["commit", "-m", "chore: bump patch version"])
run("git", ["push", "origin", "master"])
run("npm", ["publish"])
