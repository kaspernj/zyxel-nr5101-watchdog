// @ts-check

import {describe, expect, it} from "velocious/build/src/testing/test.js"
import Config from "../src/config.js"
import SystemTestingUiSession from "../src/system-testing-ui-session.js"

describe("SystemTestingUiSession", () => {
  it("uses the system-testing Browser package API to read gateway status", async () => {
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

function fakeBrowser(calls, scriptResult) {
  return {
    async executeScript(...args) {
      calls.push({args, method: "executeScript"})

      return scriptResult
    },

    getDriverAdapter() {
      return {
        async start() {
          calls.push({args: [], method: "start"})
        },

        setBaseUrl(...args) {
          calls.push({args, method: "setBaseUrl"})
        }
      }
    },

    async setTimeouts(...args) {
      calls.push({args, method: "setTimeouts"})
    },

    async stopDriver() {
      calls.push({args: [], method: "stopDriver"})
    },

    async visit(...args) {
      calls.push({args, method: "visit"})
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
