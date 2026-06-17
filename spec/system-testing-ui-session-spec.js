import {describe, expect, it} from "velocious/build/src/testing/test.js"
import Config from "../src/config.js"
import SystemTestingUiSession from "../src/system-testing-ui-session.js"

/** @typedef {{args: unknown[], method: string}} BrowserCall */

describe("SystemTestingUiSession", () => {
  it("uses the system-testing Browser package API to read gateway status", async () => {
    /** @type {BrowserCall[]} */
    const calls = []
    const session = new SystemTestingUiSession({
      browserFactory: () => fakeBrowser(calls, "System Uptime\n0 days 1 hours 0 mins 0 secs\nCellular WAN\nStatus\nConnected")
    })

    const status = await session.readStatus(testConfig())

    expect(status.connectionState).toEqual("healthy")
    expect(calls.map((call) => call.method)).toEqual([
      "setBaseUrl",
      "start",
      "setTimeouts",
      "visit",
      "exists",
      "exists",
      "clearAndSendKeys",
      "clearAndSendKeys",
      "click",
      "waitForNoSelector",
      "text",
      "stopDriver"
    ])
    expect(calls[0].args).toEqual(["http://192.168.86.3"])
    expect(calls[3].args).toEqual(["/"])
    expect(calls[6].args[0]).toContain("#username")
    expect(calls[6].args[1]).toEqual("admin")
    expect(calls[7].args[0]).toContain("#userpassword")
    expect(calls[7].args[1]).toEqual("secret-password")
    expect(calls[8].args[0]).toContain("#loginBtn")
  })

  it("uses the system-testing Browser package API to request a UI reboot", async () => {
    /** @type {BrowserCall[]} */
    const calls = []
    const session = new SystemTestingUiSession({browserFactory: () => fakeBrowser(calls, "")})

    const result = await session.reboot(testConfig({
      selectors: {
        rebootButton: "#rebootButton",
        rebootConfirmButton: "#confirmRebootButton"
      }
    }))

    expect(result.ok).toEqual(true)
    expect(calls.map((call) => call.method).includes("executeScript")).toEqual(false)
    expect(calls.filter((call) => call.method === "click").map((call) => call.args[0])).toEqual(["#loginBtn", "#rebootButton", "#confirmRebootButton"])
  })

  it("falls back to reboot controls by visible text without injected scripts", async () => {
    /** @type {BrowserCall[]} */
    const calls = []
    const session = new SystemTestingUiSession({
      browserFactory: () => fakeBrowser(calls, "", {
        elementLabels: ["Restart", "OK"]
      })
    })

    const result = await session.reboot(testConfig())

    expect(result.ok).toEqual(true)
    expect(calls.some((call) => call.method === "executeScript")).toEqual(false)
    expect(calls.filter((call) => call.method === "click").map((call) => call.args[0])).toEqual(["#loginBtn", "Restart", "OK"])
  })

  it("returns reboot-button-not-found when the configured reboot selector is missing", async () => {
    /** @type {BrowserCall[]} */
    const calls = []
    const session = new SystemTestingUiSession({
      browserFactory: () => fakeBrowser(calls, "", {missingSelectors: ["#missingRebootButton"]})
    })

    const result = await session.reboot(testConfig({selectors: {rebootButton: "#missingRebootButton"}}))

    expect(result).toEqual({ok: false, reason: "reboot_button_not_found"})
    expect(calls.find((call) => call.method === "executeScript")).toEqual(undefined)
    expect(calls.filter((call) => call.method === "click").map((call) => call.args[0])).toEqual(["#loginBtn"])
  })

  it("does not fail when a configured reboot confirmation selector is missing", async () => {
    /** @type {BrowserCall[]} */
    const calls = []
    const session = new SystemTestingUiSession({
      browserFactory: () => fakeBrowser(calls, "", {missingSelectors: ["#missingConfirmButton"]})
    })

    const result = await session.reboot(testConfig({
      selectors: {
        rebootButton: "#rebootButton",
        rebootConfirmButton: "#missingConfirmButton"
      }
    }))

    expect(result.ok).toEqual(true)
    expect(calls.filter((call) => call.method === "executeScript")).toEqual([])
    expect(calls.filter((call) => call.method === "click").map((call) => call.args[0])).toEqual(["#loginBtn", "#rebootButton"])
  })

  it("parses zero-valued NR5101 uptime text as zero milliseconds", () => {
    const status = SystemTestingUiSession.statusFromText({
      config: testConfig(),
      uptimeText: "0 days 0 hours 0 mins 0 secs",
      visibleText: "Connection down"
    })

    expect(status.uptimeMs).toEqual(0)
  })

  it("falls back to body text when a configured status selector is missing", async () => {
    /** @type {BrowserCall[]} */
    const calls = []
    const session = new SystemTestingUiSession({
      browserFactory: () => fakeBrowser(calls, "System Uptime\n0 days 1 hours 0 mins 0 secs\nCellular WAN\nStatus\nConnected", {missingSelectors: ["#status"]})
    })

    const status = await session.readStatus(testConfig({selectors: {statusText: "#status"}}))

    expect(status.connectionState).toEqual("healthy")
    expect(calls.some((call) => call.method === "text" && call.args[0] === "body")).toEqual(true)
  })

  it("falls back to visible status text when a configured uptime selector is empty", async () => {
    /** @type {BrowserCall[]} */
    const calls = []
    const session = new SystemTestingUiSession({
      browserFactory: () => fakeBrowser(calls, "System Uptime\n0 days 2 hours 5 mins 15 secs\nCellular WAN\nStatus\nConnected", {
        textBySelector: {"#uptime": "   "}
      })
    })

    const status = await session.readStatus(testConfig({selectors: {uptimeText: "#uptime"}}))

    expect(status.connectionState).toEqual("healthy")
    expect(status.uptimeMs).toEqual(7_515_000)
  })

  it("waits for the NR5101 dashboard to hydrate before reading status", async () => {
    /** @type {BrowserCall[]} */
    const calls = []
    const session = new SystemTestingUiSession({
      browserFactory: () => fakeBrowser(calls, [
        "System Info\nModel Name\nFirmware Version\nSystem Uptime\n0 days 0 hours 0 mins 0 secs\nWAN Status\nConnection down",
        "System Info\nModel Name\nNR5101\nFirmware Version\nV1.00(ABVC.8)C0\nSystem Uptime\n0 days 2 hours 5 mins 15 secs\nCellular WAN\nStatus\nUp"
      ]),
      sleep: async () => {}
    })

    const status = await session.readStatus(testConfig())

    expect(status.connectionState).toEqual("healthy")
    expect(status.uptimeMs).toEqual(7_515_000)
    expect(calls.filter((call) => call.method === "text").length).toEqual(2)
  })
})

/**
 * @param {BrowserCall[]} calls - Captured browser calls.
 * @param {string | string[]} result - Text returned from body reads.
 * @param {object} [args] - Fake browser arguments.
 * @param {string[]} [args.elementLabels] - Element labels returned from all().
 * @param {string[]} [args.missingSelectors] - Selectors that should behave as absent.
 * @param {Record<string, string>} [args.textBySelector] - Selector-specific text values.
 * @returns {import("../src/system-testing-ui-session.js").BrowserSession} Fake browser session.
 */
function fakeBrowser(calls, result, {elementLabels = [], missingSelectors = [], textBySelector = {}} = {}) {
  const missingSelectorSet = new Set(missingSelectors)
  const textResults = Array.isArray(result) ? result : [result]
  let textCallCount = 0

  return {
    async all(selector, args) {
      calls.push({args: [selector, args], method: "all"})

      return elementLabels.map((label) => /** @type {import("selenium-webdriver").WebElement} */ ({
        async getAttribute(attributeName) {
          if (attributeName === "value") return label

          return null
        },
        async getText() {
          return label
        }
      }))
    },

    async clearAndSendKeys(selector, value) {
      calls.push({args: [selector, value], method: "clearAndSendKeys"})
    },

    async click(elementOrSelector) {
      calls.push({args: [typeof elementOrSelector === "string" ? elementOrSelector : await elementOrSelector.getText()], method: "click"})
    },

    async exists(selector, args) {
      calls.push({args: [selector, args], method: "exists"})

      return !missingSelectorSet.has(selector)
    },

    getDriverAdapter() {
      return {
        async start() {
          calls.push({args: [], method: "start"})
        },

        setBaseUrl(baseUrl) {
          calls.push({args: [baseUrl], method: "setBaseUrl"})
        }
      }
    },

    async setTimeouts(timeoutMs) {
      calls.push({args: [timeoutMs], method: "setTimeouts"})
    },

    async stopDriver() {
      calls.push({args: [], method: "stopDriver"})
    },

    async text(selector, args) {
      calls.push({args: [selector, args], method: "text"})
      if (missingSelectorSet.has(selector)) {
        throw new Error(`Element couldn't be found by CSS: ${selector}`)
      }

      if (Object.prototype.hasOwnProperty.call(textBySelector, selector)) {
        return textBySelector[selector]
      }

      const textResult = textResults[Math.min(textCallCount, textResults.length - 1)]
      textCallCount += 1

      return String(textResult)
    },

    async waitForNoSelector(selector) {
      calls.push({args: [selector], method: "waitForNoSelector"})
    },

    async visit(path) {
      calls.push({args: [path], method: "visit"})
    }
  }
}

function testConfig(args = {}) {
  return Config.fromObject({
    password: "secret-password",
    ...args,
    uiUrl: "http://192.168.86.3",
    username: "admin"
  }, {source: "spec"})
}
