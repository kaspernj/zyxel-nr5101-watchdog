// @ts-check

import {mkdir, readFile, writeFile} from "node:fs/promises"
import path from "node:path"
import {optionalInteger} from "typanic"

/** Stores watchdog state such as the last successful reboot timestamp. */
export default class StateStore {
  /**
   * @param {object} args - Constructor arguments.
   * @param {string} args.statePath - JSON state file path.
   */
  constructor({statePath}) {
    this.statePath = statePath
  }

  /**
   * @returns {Promise<{lastRebootAtMs: number | null}>} Persisted watchdog state.
   */
  async load() {
    let stateText

    try {
      stateText = await readFile(this.statePath, "utf8")
    } catch (error) {
      if (StateStore.isMissingFileError(error)) {
        return {lastRebootAtMs: null}
      }

      throw new Error(`Unable to read watchdog state file: ${this.statePath}`, {cause: error})
    }

    let rawState

    try {
      rawState = JSON.parse(stateText)
    } catch (error) {
      throw new Error(`Unable to parse watchdog state JSON: ${this.statePath}`, {cause: error})
    }

    const stateObject = StateStore.requiredPlainObject(rawState, "watchdog state")

    return {
      lastRebootAtMs: optionalInteger(stateObject.lastRebootAtMs, "watchdog state lastRebootAtMs")
    }
  }

  /**
   * @param {{lastRebootAtMs: number | null}} state - Watchdog state to save.
   * @returns {Promise<void>}
   */
  async save(state) {
    await mkdir(path.dirname(this.statePath), {recursive: true})
    await writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`)
  }

  /**
   * @param {unknown} error - Caught filesystem error.
   * @returns {boolean} Whether the error means the file is absent.
   */
  static isMissingFileError(error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
  }

  /**
   * @param {unknown} raw - Raw value.
   * @param {string} label - Error label.
   * @returns {Record<string, unknown>} Validated object.
   */
  static requiredPlainObject(raw, label) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TypeError(`Expected ${label} to be an object`)
    }

    return /** @type {Record<string, unknown>} */ (raw)
  }
}
