import {readFile} from "node:fs/promises"
import {forcedNonBlankString, optionalNonBlankString, optionalPositiveInteger} from "typanic"

export const DEFAULT_CONFIG_PATH = "config/secrets.json"

const DEFAULT_LABELS = Object.freeze({
  down: Object.freeze(["disconnected", "no internet", "connection failed", "not connected", "connection down"]),
  establishing: Object.freeze(["connecting", "establishing", "booting", "initializing", "registering"]),
  healthy: Object.freeze(["connected", "online", "internet connected", "up"])
})

const DEFAULT_STATE_PATH = "var/state.json"
const SELECTOR_KEYS = Object.freeze(["loginButton", "passwordInput", "rebootButton", "rebootConfirmButton", "statusText", "uptimeText", "usernameInput"])

/**
 * @typedef {object} GatewayLabels
 * @property {string[]} down - Text labels that indicate a clearly down connection.
 * @property {string[]} establishing - Text labels that indicate booting or connection setup.
 * @property {string[]} healthy - Text labels that indicate an active Internet connection.
 */

/**
 * @typedef {object} GatewaySelectors
 * @property {string | null} loginButton - Optional login submit selector.
 * @property {string | null} passwordInput - Optional password field selector.
 * @property {string | null} rebootButton - Optional reboot button selector.
 * @property {string | null} rebootConfirmButton - Optional reboot confirmation selector.
 * @property {string | null} statusText - Optional status text selector.
 * @property {string | null} uptimeText - Optional uptime text selector.
 * @property {string | null} usernameInput - Optional username field selector.
 */

/** Loads and validates watchdog configuration from local secrets JSON. */
export default class Config {
  /**
   * @param {object} args - Load arguments.
   * @param {string} [args.configPath] - Path to the local secrets config file.
   * @returns {Promise<Config>} Parsed config.
   */
  static async load({configPath = DEFAULT_CONFIG_PATH} = {}) {
    let configText

    try {
      configText = await readFile(configPath, "utf8")
    } catch (error) {
      throw new Error(`Unable to read config file: ${configPath}`, {cause: error})
    }

    let parsedConfig

    try {
      parsedConfig = JSON.parse(configText)
    } catch (error) {
      throw new Error(`Unable to parse config JSON: ${configPath}`, {cause: error})
    }

    return Config.fromObject(parsedConfig, {source: configPath})
  }

  /**
   * @param {unknown} raw - Raw config object from JSON.
   * @param {object} args - Parse arguments.
   * @param {string} [args.source] - Source label used in errors.
   * @returns {Config} Parsed config.
   */
  static fromObject(raw, {source = "config"} = {}) {
    const configObject = Config.requiredPlainObject(raw, source)

    return new Config({
      bootGracePeriodMs: Config.durationMs(configObject.bootGracePeriodMs, `${source}.bootGracePeriodMs`, 600_000),
      checkIntervalMs: Config.durationMs(configObject.checkIntervalMs, `${source}.checkIntervalMs`, 300_000),
      labels: Config.labelsFromObject(configObject.labels, `${source}.labels`),
      minimumUptimeBeforeRebootMs: Config.optionalDurationMs(configObject.minimumUptimeBeforeRebootMs, `${source}.minimumUptimeBeforeRebootMs`),
      password: forcedNonBlankString(configObject.password, `${source}.password`),
      rebootCooldownMs: Config.durationMs(configObject.rebootCooldownMs, `${source}.rebootCooldownMs`, 3_600_000),
      selectors: Config.selectorsFromObject(configObject.selectors, `${source}.selectors`),
      statePath: optionalNonBlankString(configObject.statePath, `${source}.statePath`) ?? DEFAULT_STATE_PATH,
      uiUrl: forcedNonBlankString(configObject.uiUrl, `${source}.uiUrl`),
      username: forcedNonBlankString(configObject.username, `${source}.username`)
    })
  }

  /**
   * @param {object} args - Validated config properties.
   * @param {number} args.bootGracePeriodMs - Grace period after boot before rebooting.
   * @param {number} args.checkIntervalMs - Interval between watch checks.
   * @param {GatewayLabels} args.labels - UI status labels.
   * @param {number | null} args.minimumUptimeBeforeRebootMs - Optional minimum uptime gate.
   * @param {string} args.password - Gateway UI password.
   * @param {number} args.rebootCooldownMs - Minimum delay between reboots.
   * @param {GatewaySelectors} args.selectors - Optional discovered selectors.
   * @param {string} args.statePath - Local watchdog state path.
   * @param {string} args.uiUrl - Gateway UI URL.
   * @param {string} args.username - Gateway UI username.
   */
  constructor({bootGracePeriodMs, checkIntervalMs, labels, minimumUptimeBeforeRebootMs, password, rebootCooldownMs, selectors, statePath, uiUrl, username}) {
    this.bootGracePeriodMs = bootGracePeriodMs
    this.checkIntervalMs = checkIntervalMs
    this.labels = labels
    this.minimumUptimeBeforeRebootMs = minimumUptimeBeforeRebootMs
    this.password = password
    this.rebootCooldownMs = rebootCooldownMs
    this.selectors = selectors
    this.statePath = statePath
    this.uiUrl = uiUrl
    this.username = username
  }

  /**
   * @param {unknown} raw - Raw duration value.
   * @param {string} label - Error label.
   * @param {number} defaultValue - Default duration when absent.
   * @returns {number} Validated duration.
   */
  static durationMs(raw, label, defaultValue) {
    const durationMs = optionalPositiveInteger(raw, label)

    return durationMs ?? defaultValue
  }

  /**
   * @param {unknown} raw - Raw optional duration value.
   * @param {string} label - Error label.
   * @returns {number | null} Validated duration, or null when absent.
   */
  static optionalDurationMs(raw, label) {
    return optionalPositiveInteger(raw, label)
  }

  /**
   * @param {unknown} raw - Raw labels object.
   * @param {string} label - Error label.
   * @returns {GatewayLabels} Validated labels.
   */
  static labelsFromObject(raw, label) {
    const labelsObject = Config.optionalPlainObject(raw, label)

    return {
      down: Config.stringList(labelsObject?.down, `${label}.down`, DEFAULT_LABELS.down),
      establishing: Config.stringList(labelsObject?.establishing, `${label}.establishing`, DEFAULT_LABELS.establishing),
      healthy: Config.stringList(labelsObject?.healthy, `${label}.healthy`, DEFAULT_LABELS.healthy)
    }
  }

  /**
   * @param {unknown} raw - Raw selectors object.
   * @param {string} label - Error label.
   * @returns {GatewaySelectors} Validated selectors.
   */
  static selectorsFromObject(raw, label) {
    const selectorsObject = Config.optionalPlainObject(raw, label)
    /** @type {Record<string, string | null>} */
    const selectors = {}

    for (const selectorKey of SELECTOR_KEYS) {
      selectors[selectorKey] = optionalNonBlankString(selectorsObject?.[selectorKey], `${label}.${selectorKey}`)
    }

    return /** @type {GatewaySelectors} */ (selectors)
  }

  /**
   * @param {unknown} raw - Raw list value.
   * @param {string} label - Error label.
   * @param {readonly string[]} defaultValue - Default list when absent.
   * @returns {string[]} Validated string list.
   */
  static stringList(raw, label, defaultValue) {
    if (raw === null || raw === undefined) {
      return [...defaultValue]
    }

    if (!Array.isArray(raw)) {
      throw new TypeError(`Expected ${label} to be an array`)
    }

    return raw.map((entry, index) => forcedNonBlankString(entry, `${label}[${index}]`))
  }

  /**
   * @param {unknown} raw - Raw object value.
   * @param {string} label - Error label.
   * @returns {Record<string, unknown>} Validated object.
   */
  static requiredPlainObject(raw, label) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TypeError(`Expected ${label} to be an object`)
    }

    return /** @type {Record<string, unknown>} */ (raw)
  }

  /**
   * @param {unknown} raw - Raw object value.
   * @param {string} label - Error label.
   * @returns {Record<string, unknown> | null} Validated object, or null when absent.
   */
  static optionalPlainObject(raw, label) {
    if (raw === null || raw === undefined) {
      return null
    }

    return Config.requiredPlainObject(raw, label)
  }
}
