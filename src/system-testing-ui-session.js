import {setTimeout as sleepMs} from "node:timers/promises"
import {Browser} from "system-testing/build/index.js"

/**
 * @typedef {object} BrowserDriverAdapter
 * @property {(baseUrl: string) => void} setBaseUrl - Sets the browser base URL.
 * @property {() => Promise<void>} start - Starts the browser driver.
 */

/**
 * @typedef {object} BrowserSession
 * @property {(selector: string, value: string) => Promise<void>} clearAndSendKeys - Replaces an input value through browser interactions.
 * @property {(selector: string) => Promise<void>} click - Clicks an element.
 * @property {(script: string, ...args: string[]) => Promise<unknown>} executeScript - Executes script in the browser.
 * @property {(selector: string, args?: {timeout?: number, visible?: boolean | null}) => Promise<boolean>} exists - Checks whether an element exists.
 * @property {() => BrowserDriverAdapter} getDriverAdapter - Returns the browser driver adapter.
 * @property {(timeoutMs: number) => Promise<void>} setTimeouts - Sets browser timeouts.
 * @property {() => Promise<void>} stopDriver - Stops the browser driver.
 * @property {(selector: string, args?: {timeout?: number, visible?: boolean | null}) => Promise<string>} text - Reads visible text from an element.
 * @property {(path: string) => Promise<void>} visit - Visits a URL or path.
 * @property {(selector: string, args?: {useBaseSelector?: boolean}) => Promise<void>} waitForNoSelector - Waits for an element to disappear.
 */

// NR5101 firmware defaults; local config selectors can override these when firmware markup differs.
const DEFAULT_LOGIN_BUTTON_SELECTOR = "#loginBtn"
const DEFAULT_LOGIN_GONE_SELECTOR = "#Login-login, #loginBtn"
const DEFAULT_PASSWORD_SELECTOR = ".maskPassword#userpassword"
const DEFAULT_USERNAME_SELECTOR = "#username"
const STATUS_LOAD_POLL_INTERVAL_MS = 250

const REBOOT_SCRIPT = String.raw`
const config = JSON.parse(arguments[0])
const selectors = config.selectors || {}
const rebootButton = selectors.rebootButton ? document.querySelector(selectors.rebootButton) : Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a')).find((element) => /reboot|restart/i.test(element.innerText || element.value || ''))

if (!rebootButton) {
  return {ok: false, reason: 'reboot_button_not_found'}
}

rebootButton.click()

const confirmButton = selectors.rebootConfirmButton ? document.querySelector(selectors.rebootConfirmButton) : Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a')).find((element) => /confirm|ok|yes/i.test(element.innerText || element.value || ''))
if (confirmButton) {
  confirmButton.click()
}

return {ok: true}
`

/** Drives the Zyxel UI through a system-testing Browser session. */
export default class SystemTestingUiSession {
  /**
   * @param {object} [args] - Constructor arguments.
   * @param {() => BrowserSession} [args.browserFactory] - Browser factory, mainly for tests.
   * @param {(ms: number) => Promise<void>} [args.sleep] - Sleep function, mainly for tests.
   * @param {number} [args.statusPollIntervalMs] - Delay between status hydration checks.
   * @param {number} [args.timeoutMs] - Browser command timeout.
   */
  constructor({browserFactory = () => new Browser(), sleep = sleepMs, statusPollIntervalMs = STATUS_LOAD_POLL_INTERVAL_MS, timeoutMs = 15_000} = {}) {
    this.browserFactory = browserFactory
    this.sleep = sleep
    this.statusPollIntervalMs = statusPollIntervalMs
    this.timeoutMs = timeoutMs
  }

  /**
   * @param {import("./config.js").default} config - Watchdog config.
   * @returns {Promise<import("./watchdog.js").GatewayUiStatus>} Gateway UI status.
   */
  async readStatus(config) {
    return await this.withBrowser(config, async (browser) => {
      await browser.visit("/")
      await this.login({browser, config})
      const visibleText = await this.loadedStatusText({browser, config})
      const uptimeText = await this.statusUptimeText({browser, config, visibleText})

      return SystemTestingUiSession.statusFromText({config, uptimeText, visibleText})
    })
  }

  /**
   * @param {import("./config.js").default} config - Watchdog config.
   * @returns {Promise<Record<string, unknown>>} UI reboot command result.
   */
  async reboot(config) {
    return await this.withBrowser(config, async (browser) => {
      await browser.visit("/")
      await this.login({browser, config})

      return SystemTestingUiSession.requiredPlainObject(await this.executeScript({browser, config, script: REBOOT_SCRIPT}), "browser reboot result")
    })
  }

  /**
   * @template T
   * @param {import("./config.js").default} config - Watchdog config.
   * @param {(browser: BrowserSession) => Promise<T>} callback - Browser callback.
   * @returns {Promise<T>} Callback result.
   */
  async withBrowser(config, callback) {
    const browser = this.browserFactory()
    const driverAdapter = browser.getDriverAdapter()

    driverAdapter.setBaseUrl(config.uiUrl)
    await driverAdapter.start()

    try {
      await browser.setTimeouts(this.timeoutMs)

      return await callback(browser)
    } finally {
      await browser.stopDriver()
    }
  }

  /**
   * @param {object} args - Login arguments.
   * @param {BrowserSession} args.browser - Browser session.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @returns {Promise<void>}
   */
  async login({browser, config}) {
    const usernameSelector = config.selectors.usernameInput ?? DEFAULT_USERNAME_SELECTOR
    const passwordSelector = config.selectors.passwordInput ?? DEFAULT_PASSWORD_SELECTOR
    const loginButtonSelector = config.selectors.loginButton ?? DEFAULT_LOGIN_BUTTON_SELECTOR
    const loginGoneSelector = config.selectors.loginButton ?? DEFAULT_LOGIN_GONE_SELECTOR
    const loginControlsPresent = await browser.exists(usernameSelector, {timeout: 0}) && await browser.exists(passwordSelector, {timeout: 0})

    if (!loginControlsPresent) {
      return
    }

    await browser.clearAndSendKeys(usernameSelector, config.username)
    await browser.clearAndSendKeys(passwordSelector, config.password)
    await browser.click(loginButtonSelector)
    await browser.waitForNoSelector(loginGoneSelector)
  }

  /**
   * @param {object} args - Status loading arguments.
   * @param {BrowserSession} args.browser - Browser session.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @returns {Promise<string>} Hydrated status text.
   */
  async loadedStatusText({browser, config}) {
    const statusPollIntervalMs = Math.max(1, this.statusPollIntervalMs)
    const maxAttempts = Math.max(1, Math.ceil(this.timeoutMs / statusPollIntervalMs))

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const visibleText = await this.statusVisibleText({browser, config})

      if (SystemTestingUiSession.statusLoadedFromText(visibleText)) {
        return visibleText
      }

      if (attempt < maxAttempts) {
        await this.sleep(statusPollIntervalMs)
      }
    }

    throw new Error("Timed out waiting for gateway status content to load")
  }

  /**
   * @param {object} args - Status text arguments.
   * @param {BrowserSession} args.browser - Browser session.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @returns {Promise<string>} Visible status text.
   */
  async statusVisibleText({browser, config}) {
    const selectedText = await this.optionalElementText({browser, selector: config.selectors.statusText})

    if (selectedText) return selectedText

    return (await browser.text("body")).trim()
  }

  /**
   * @param {object} args - Uptime text arguments.
   * @param {BrowserSession} args.browser - Browser session.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {string} args.visibleText - Fallback visible status text.
   * @returns {Promise<string>} Uptime text.
   */
  async statusUptimeText({browser, config, visibleText}) {
    const selectedText = await this.optionalElementText({browser, selector: config.selectors.uptimeText})

    if (selectedText) return selectedText

    return visibleText
  }

  /**
   * @param {object} args - Optional text arguments.
   * @param {BrowserSession} args.browser - Browser session.
   * @param {string | null} args.selector - Optional selector.
   * @returns {Promise<string | null>} Trimmed element text, or null when absent/empty.
   */
  async optionalElementText({browser, selector}) {
    if (!selector) return null

    const elementExists = await browser.exists(selector, {timeout: 0, visible: null})

    if (!elementExists) return null

    const text = (await browser.text(selector, {timeout: 0, visible: null})).trim()

    if (text.length === 0) return null

    return text
  }

  /**
   * @param {object} args - Script command arguments.
   * @param {BrowserSession} args.browser - Browser session.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {string} args.script - Browser script body.
   * @returns {Promise<unknown>} Script result.
   */
  async executeScript({browser, config, script}) {
    return await browser.executeScript(script, SystemTestingUiSession.browserConfigJson(config))
  }

  /**
   * @param {import("./config.js").default} config - Watchdog config.
   * @returns {string} JSON payload for browser scripts.
   */
  static browserConfigJson(config) {
    return JSON.stringify({
      selectors: config.selectors
    })
  }

  /**
   * @param {object} args - Status text arguments.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {string} args.uptimeText - Text used for uptime parsing.
   * @param {string} args.visibleText - Text used for status classification.
   * @returns {import("./watchdog.js").GatewayUiStatus} Validated status.
   */
  static statusFromText({config, uptimeText, visibleText}) {
    return {
      connectionState: SystemTestingUiSession.connectionStateFromText({config, visibleText}),
      loginSucceeded: !/login failed|invalid password|incorrect password/i.test(visibleText),
      uiReachable: true,
      uptimeMs: SystemTestingUiSession.uptimeMsFromText(uptimeText),
      visibleText
    }
  }

  /**
   * @param {string} visibleText - Visible router UI text.
   * @returns {boolean} Whether status content has finished loading.
   */
  static statusLoadedFromText(visibleText) {
    return !/\bModel Name\s*\n\s*Firmware Version\s*\n\s*System Uptime\b/i.test(visibleText)
  }

  /**
   * @param {object} args - Connection state classification arguments.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {string} args.visibleText - Visible router UI text.
   * @returns {import("./watchdog.js").GatewayConnectionState} Connection state.
   */
  static connectionStateFromText({config, visibleText}) {
    const normalizedText = visibleText.toLowerCase()

    if (SystemTestingUiSession.visibleTextContains(normalizedText, config.labels.establishing)) return "establishing"
    if (SystemTestingUiSession.visibleTextContains(normalizedText, config.labels.down)) return "down"
    if (SystemTestingUiSession.visibleTextContains(normalizedText, config.labels.healthy)) return "healthy"

    return "unknown"
  }

  /**
   * @param {string} normalizedText - Lowercase visible router UI text.
   * @param {string[]} labels - Labels to match.
   * @returns {boolean} Whether visible text contains a label.
   */
  static visibleTextContains(normalizedText, labels) {
    return labels.some((label) => {
      const normalizedLabel = label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
      const labelPattern = new RegExp(`(^|[^a-z0-9])${normalizedLabel}([^a-z0-9]|$)`)

      return labelPattern.test(normalizedText)
    })
  }

  /**
   * @param {string} text - Gateway uptime text.
   * @returns {number | null} Parsed uptime in milliseconds, or null when no uptime is present.
   */
  static uptimeMsFromText(text) {
    if (!text) {
      return null
    }

    const normalized = text.toLowerCase()
    const colonMatch = normalized.match(/(\d+)\s*:\s*(\d+)\s*:\s*(\d+)/)

    if (colonMatch) {
      return ((Number(colonMatch[1]) * 60 * 60) + (Number(colonMatch[2]) * 60) + Number(colonMatch[3])) * 1000
    }

    let matchedAnyUnit = false
    let totalMs = 0
    /** @type {[RegExp, number][]} */
    const units = [
      [/([0-9]+)\s*d(?:ay)?s?/g, 24 * 60 * 60 * 1000],
      [/([0-9]+)\s*h(?:our)?s?/g, 60 * 60 * 1000],
      [/([0-9]+)\s*m(?:in(?:ute)?)?s?/g, 60 * 1000],
      [/([0-9]+)\s*s(?:ec(?:ond)?)?s?/g, 1000]
    ]

    for (const [pattern, multiplier] of units) {
      for (const match of normalized.matchAll(pattern)) {
        matchedAnyUnit = true
        totalMs += Number(match[1]) * multiplier
      }
    }

    return matchedAnyUnit ? totalMs : null
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
