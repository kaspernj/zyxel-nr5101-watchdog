import {describe, expect, it} from "velocious/build/src/testing/test.js"
import Config from "../src/config.js"
import SystemTestingUiSession from "../src/system-testing-ui-session.js"

/** @typedef {{args: unknown[], method: string}} BrowserCall */

describe("SystemTestingUiSession", () => {
  it("uses the system-testing Browser package API to read gateway status", async () => {
    /** @type {BrowserCall[]} */
    const calls = []
    const session = new SystemTestingUiSession({
      browserFactory: () => fakeBrowser(calls, {
        connectionState: "healthy",
        loginSucceeded: true,
        statusLoaded: true,
        uiReachable: true,
        uptimeMs: 3_600_000,
        uptimeText: "0 days 1 hours 0 mins 0 secs",
        visibleText: "Connected"
      })
    })

    const status = await session.readStatus(testConfig())

    expect(status.connectionState).toEqual("healthy")
    expect(calls.map((call) => call.method)).toEqual([
      "setBaseUrl",
      "start",
      "setTimeouts",
      "visit",
      "executeScript",
      "clearAndSendKeys",
      "clearAndSendKeys",
      "click",
      "waitForNoSelector",
      "executeScript",
      "stopDriver"
    ])
    expect(calls[0].args).toEqual(["http://192.168.86.3"])
    expect(calls[3].args).toEqual(["/"])
    expect(calls[5].args[0]).toContain("#username")
    expect(calls[5].args[1]).toEqual("admin")
    expect(calls[6].args[0]).toContain("#userpassword")
    expect(calls[6].args[1]).toEqual("secret-password")
    expect(calls[7].args[0]).toContain("#loginBtn")
  })

  it("uses the system-testing Browser package API to request a UI reboot", async () => {
    /** @type {BrowserCall[]} */
    const calls = []
    const session = new SystemTestingUiSession({browserFactory: () => fakeBrowser(calls, {ok: true})})

    const result = await session.reboot(testConfig())

    expect(result.ok).toEqual(true)
    expect(calls.map((call) => call.method)).toEqual([
      "setBaseUrl",
      "start",
      "setTimeouts",
      "visit",
      "executeScript",
      "clearAndSendKeys",
      "clearAndSendKeys",
      "click",
      "waitForNoSelector",
      "executeScript",
      "stopDriver"
    ])
    expect(calls[9].args[0]).toContain("rebootButton")
  })

  it("parses zero-valued NR5101 uptime text as zero milliseconds", () => {
    const status = SystemTestingUiSession.statusFromResult({
      connectionState: "down",
      loginSucceeded: true,
      uiReachable: true,
      uptimeText: "0 days 0 hours 0 mins 0 secs",
      visibleText: "Connection down"
    })

    expect(status.uptimeMs).toEqual(0)
  })

  it("waits for the NR5101 dashboard to hydrate before reading status", async () => {
    /** @type {BrowserCall[]} */
    const calls = []
    const session = new SystemTestingUiSession({
      browserFactory: () => fakeBrowser(calls, [
        {
          connectionState: "down",
          loginSucceeded: true,
          statusLoaded: false,
          uiReachable: true,
          uptimeText: "0 days 0 hours 0 mins 0 secs",
          visibleText: "System Info\nModel Name\nFirmware Version\nSystem Uptime\n0 days 0 hours 0 mins 0 secs\nWAN Status\nConnection down"
        },
        {
          connectionState: "healthy",
          loginSucceeded: true,
          statusLoaded: true,
          uiReachable: true,
          uptimeText: "0 days 2 hours 5 mins 15 secs",
          visibleText: "System Info\nModel Name\nNR5101\nFirmware Version\nV1.00(ABVC.8)C0\nSystem Uptime\n0 days 2 hours 5 mins 15 secs\nCellular WAN\nStatus\nUp"
        }
      ]),
      sleep: async () => {}
    })

    const status = await session.readStatus(testConfig())

    expect(status.connectionState).toEqual("healthy")
    expect(status.uptimeMs).toEqual(7_515_000)
    expect(calls.filter((call) => call.method === "executeScript").length).toEqual(3)
  })
})

/**
 * @param {BrowserCall[]} calls - Captured browser calls.
 * @param {Record<string, unknown> | Record<string, unknown>[]} scriptResult - Result returned from executeScript.
 * @returns {import("../src/system-testing-ui-session.js").BrowserSession} Fake browser session.
 */
function fakeBrowser(calls, scriptResult) {
  let executeScriptCount = 0
  let statusScriptCount = 0
  const scriptResults = Array.isArray(scriptResult) ? scriptResult : [scriptResult]

  return {
    async clearAndSendKeys(selector, value) {
      calls.push({args: [selector, value], method: "clearAndSendKeys"})
    },

    async click(selector) {
      calls.push({args: [selector], method: "click"})
    },

    async executeScript(script, ...args) {
      executeScriptCount += 1
      calls.push({args: [script, ...args], method: "executeScript"})

      if (executeScriptCount === 1) {
        return true
      }

      const result = scriptResults[Math.min(statusScriptCount, scriptResults.length - 1)]
      statusScriptCount += 1

      return result
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

    async waitForNoSelector(selector) {
      calls.push({args: [selector], method: "waitForNoSelector"})
    },

    async visit(path) {
      calls.push({args: [path], method: "visit"})
    }
  }
}

function testConfig() {
  return Config.fromObject({
    password: "secret-password",
    uiUrl: "http://192.168.86.3",
    username: "admin"
  }, {source: "spec"})
}
