import {forcedBoolean, forcedNonBlankString, forcedString, optionalInteger} from "typanic"
import {Browser} from "system-testing/build/index.js"

/**
 * @typedef {object} BrowserDriverAdapter
 * @property {(baseUrl: string) => void} setBaseUrl - Sets the browser base URL.
 * @property {() => Promise<void>} start - Starts the browser driver.
 */

/**
 * @typedef {object} BrowserSession
 * @property {(script: string, ...args: string[]) => Promise<unknown>} executeScript - Executes script in the browser.
 * @property {() => BrowserDriverAdapter} getDriverAdapter - Returns the browser driver adapter.
 * @property {(timeoutMs: number) => Promise<void>} setTimeouts - Sets browser timeouts.
 * @property {() => Promise<void>} stopDriver - Stops the browser driver.
 * @property {(path: string) => Promise<void>} visit - Visits a URL or path.
 */

const LOGIN_SCRIPT = String.raw`
const config = JSON.parse(arguments[0])
const selectors = config.selectors || {}
const selector = (...candidates) => candidates.find((candidate) => candidate && document.querySelector(candidate))
const usernameSelector = selector(selectors.usernameInput, 'input[name="username"]', 'input[id*="user" i]', 'input[type="text"]')
const passwordSelector = selector(selectors.passwordInput, 'input[name="password"]', 'input[id*="password" i]', 'input[type="password"]')
const loginButtonSelector = selector(selectors.loginButton, 'button[type="submit"]', 'input[type="submit"]')
const usernameInput = usernameSelector ? document.querySelector(usernameSelector) : null
const passwordInput = passwordSelector ? document.querySelector(passwordSelector) : null

function setInputValue(input, value) {
  input.focus()
  input.value = value
  input.dispatchEvent(new Event('input', {bubbles: true}))
  input.dispatchEvent(new Event('change', {bubbles: true}))
}

if (!usernameInput || !passwordInput) {
  return {loginAttempted: false, loginSucceeded: !/login failed|invalid password|incorrect password/i.test(document.body.innerText || '')}
}

setInputValue(usernameInput, config.username)
setInputValue(passwordInput, config.password)

if (loginButtonSelector) {
  document.querySelector(loginButtonSelector).click()
} else {
  passwordInput.form?.requestSubmit()
}

return {loginAttempted: true, loginSucceeded: true}
`

const READ_STATUS_SCRIPT = String.raw`
const config = JSON.parse(arguments[0])
const labels = config.labels || {}
const selectors = config.selectors || {}
const statusElement = selectors.statusText ? document.querySelector(selectors.statusText) : null
const uptimeElement = selectors.uptimeText ? document.querySelector(selectors.uptimeText) : null
const visibleText = (statusElement?.innerText || document.body?.innerText || '').trim()
const uptimeText = (uptimeElement?.innerText || visibleText).trim()
const normalizedText = visibleText.toLowerCase()

function includesAny(values) {
  return Array.isArray(values) && values.some((value) => {
    const specialChars = '\\.*+?^$(){}|[]'
    const escapedValue = String(value).toLowerCase().split('').map((char) => specialChars.includes(char) ? '\\' + char : char).join('').replace(/\s+/g, '\\s+')
    return new RegExp('(^|[^a-z0-9])' + escapedValue + '([^a-z0-9]|$)').test(normalizedText)
  })
}

function parseUptimeMs(text) {
  if (!text) return null
  const normalized = text.toLowerCase()
  const colonMatch = normalized.match(/(\d+)\s*:\s*(\d+)\s*:\s*(\d+)/)
  if (colonMatch) {
    return ((Number(colonMatch[1]) * 60 * 60) + (Number(colonMatch[2]) * 60) + Number(colonMatch[3])) * 1000
  }

  let totalMs = 0
  const units = [
    [/([0-9]+)\s*d(?:ay)?s?/g, 24 * 60 * 60 * 1000],
    [/([0-9]+)\s*h(?:our)?s?/g, 60 * 60 * 1000],
    [/([0-9]+)\s*m(?:in(?:ute)?)?s?/g, 60 * 1000],
    [/([0-9]+)\s*s(?:ec(?:ond)?)?s?/g, 1000]
  ]

  for (const [pattern, multiplier] of units) {
    for (const match of normalized.matchAll(pattern)) {
      totalMs += Number(match[1]) * multiplier
    }
  }

  return totalMs > 0 ? totalMs : null
}

let connectionState = 'unknown'
if (includesAny(labels.establishing)) connectionState = 'establishing'
else if (includesAny(labels.down)) connectionState = 'down'
else if (includesAny(labels.healthy)) connectionState = 'healthy'

return {
  connectionState,
  loginSucceeded: !/login failed|invalid password|incorrect password/i.test(visibleText),
  uiReachable: true,
  uptimeMs: parseUptimeMs(uptimeText),
  visibleText
}
`

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
   * @param {number} [args.timeoutMs] - Browser command timeout.
   */
  constructor({browserFactory = () => new Browser(), timeoutMs = 15_000} = {}) {
    this.browserFactory = browserFactory
    this.timeoutMs = timeoutMs
  }

  /**
   * @param {import("./config.js").default} config - Watchdog config.
   * @returns {Promise<import("./watchdog.js").GatewayUiStatus>} Gateway UI status.
   */
  async readStatus(config) {
    return await this.withBrowser(config, async (browser) => {
      await browser.visit("/")
      await this.executeScript({browser, config, script: LOGIN_SCRIPT})
      const statusResult = await this.executeScript({browser, config, script: READ_STATUS_SCRIPT})

      return SystemTestingUiSession.statusFromResult(statusResult)
    })
  }

  /**
   * @param {import("./config.js").default} config - Watchdog config.
   * @returns {Promise<Record<string, unknown>>} UI reboot command result.
   */
  async reboot(config) {
    return await this.withBrowser(config, async (browser) => {
      await browser.visit("/")
      await this.executeScript({browser, config, script: LOGIN_SCRIPT})

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
      labels: config.labels,
      password: config.password,
      selectors: config.selectors,
      uiUrl: config.uiUrl,
      username: config.username
    })
  }

  /**
   * @param {unknown} rawStatus - Browser status result.
   * @returns {import("./watchdog.js").GatewayUiStatus} Validated status.
   */
  static statusFromResult(rawStatus) {
    const result = SystemTestingUiSession.requiredPlainObject(rawStatus, "browser status result")

    return {
      connectionState: SystemTestingUiSession.connectionState(result.connectionState),
      loginSucceeded: forcedBoolean(result.loginSucceeded, "gateway status loginSucceeded"),
      uiReachable: forcedBoolean(result.uiReachable, "gateway status uiReachable"),
      uptimeMs: optionalInteger(result.uptimeMs, "gateway status uptimeMs"),
      visibleText: forcedString(result.visibleText, "gateway status visibleText")
    }
  }

  /**
   * @param {unknown} rawState - Raw connection state.
   * @returns {import("./watchdog.js").GatewayConnectionState} Validated connection state.
   */
  static connectionState(rawState) {
    const connectionState = forcedNonBlankString(rawState, "gateway status connectionState")

    if (["down", "establishing", "healthy", "unknown"].includes(connectionState)) {
      return /** @type {import("./watchdog.js").GatewayConnectionState} */ (connectionState)
    }

    throw new Error(`Unknown gateway connection state: ${connectionState}`)
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
