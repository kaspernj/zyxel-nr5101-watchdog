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
        uiReachable: true,
        uptimeMs: 3_600_000,
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
      "executeScript",
      "stopDriver"
    ])
    expect(calls[0].args).toEqual(["http://192.168.86.3"])
    expect(calls[3].args).toEqual(["/"])
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
      "executeScript",
      "stopDriver"
    ])
    expect(calls[5].args[0]).toContain("rebootButton")
  })
})

/**
 * @param {BrowserCall[]} calls - Captured browser calls.
 * @param {Record<string, unknown>} scriptResult - Result returned from executeScript.
 * @returns {import("../src/system-testing-ui-session.js").BrowserSession} Fake browser session.
 */
function fakeBrowser(calls, scriptResult) {
  return {
    async executeScript(script, ...args) {
      calls.push({args: [script, ...args], method: "executeScript"})

      return scriptResult
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

    async visit(path) {
      calls.push({args: [path], method: "visit"})
    }
  }
}

function testConfig() {
  return Config.fromObject({
    password: "secret-password",
    selectors: {
      loginButton: "#login",
      passwordInput: "#password",
      rebootButton: "#reboot",
      usernameInput: "#username"
    },
    uiUrl: "http://192.168.86.3",
    username: "admin"
  }, {source: "spec"})
}
