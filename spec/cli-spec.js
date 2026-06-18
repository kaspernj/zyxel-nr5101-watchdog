import {mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "velocious/build/src/testing/test.js"
import {runCli} from "../src/cli.js"

/** @typedef {import("../src/config.js").default} Config */
/** @typedef {import("../src/watchdog.js").GatewayUiStatus} GatewayUiStatus */
/** @typedef {{lastRebootAtMs: number | null}} WatchdogState */
/** @typedef {{check: (config: Config) => Promise<{error: string | null, ok: boolean}>}} FakeConnectivityProbe */
/** @typedef {{savedStates?: WatchdogState[], state?: WatchdogState}} FakeStateStoreArgs */
/** @typedef {{load: () => Promise<WatchdogState>, save: (state: WatchdogState) => Promise<void>}} FakeStateStore */
/** @typedef {{readStatus: (config: Config) => Promise<GatewayUiStatus>, reboot?: (config: Config) => Promise<Record<string, unknown>>}} FakeUiSession */

describe("CLI", () => {
  it("prints usage without loading config when no command is given", async () => {
    /** @type {string[]} */
    const stdout = []

    const exitCode = await runCli({argv: [], stdout: {write: (message) => stdout.push(message)}})

    expect(exitCode).toEqual(1)
    expectUsageOutput(stdout)
  })

  it("prints usage without loading config when help is requested", async () => {
    /** @type {string[]} */
    const stdout = []

    const exitCode = await runCli({argv: ["help"], stdout: {write: (message) => stdout.push(message)}})

    expect(exitCode).toEqual(0)
    expectUsageOutput(stdout)
  })

  it("check loads config, reads the UI status, and prints the watchdog decision", async () => {
    await withTempConfig(async (configPath) => {
      /** @type {string[]} */
      const stdout = []
      const stateStore = fakeStateStore()
      /** @type {FakeUiSession} */
      const uiSession = {
        async readStatus(config) {
          expect(config.uiUrl).toEqual("http://192.168.86.3")

          return {
            connectionState: "healthy",
            loginSucceeded: true,
            uiReachable: true,
            uptimeMs: 3_600_000,
            visibleText: "Connected"
          }
        }
      }

      const exitCode = await runCli({
        argv: ["check", "--config", configPath],
        connectivityProbe: successfulConnectivityProbe(),
        stateStore,
        stdout: {write: (message) => stdout.push(message)},
        uiSession
      })

      expect(exitCode).toEqual(0)
      expect(JSON.parse(stdout.join(""))).toEqual({
        command: "check",
        decision: {
          healthReason: "healthy",
          nextRebootAllowedAtMs: null,
          shouldReboot: false,
          skipReason: null
        }
      })
    })
  })

  it("check uses the injected connectivity probe before printing the decision", async () => {
    await withTempConfig(async (configPath) => {
      /** @type {string[]} */
      const stdout = []
      let probeChecked = false
      /** @type {FakeUiSession} */
      const uiSession = {
        async readStatus() {
          return healthyStatus()
        }
      }

      const exitCode = await runCli({
        argv: ["check", "--config", configPath],
        connectivityProbe: {
          async check(config) {
            expect(config.connectivityProbeHost).toEqual("1.1.1.1")
            probeChecked = true

            return {error: "ECONNREFUSED", ok: false}
          }
        },
        stateStore: fakeStateStore(),
        stdout: {write: (message) => stdout.push(message)},
        uiSession
      })

      expect(exitCode).toEqual(0)
      expect(probeChecked).toEqual(true)
      expect(JSON.parse(stdout.join(""))).toEqual({
        command: "check",
        decision: {
          healthReason: "connectivity_probe_failed",
          nextRebootAllowedAtMs: null,
          shouldReboot: true,
          skipReason: null
        }
      })
    })
  })

  it("reboot invokes the UI reboot only when the watchdog decision allows it", async () => {
    await withTempConfig(async (configPath) => {
      let rebooted = false
      /** @type {WatchdogState[]} */
      const savedStates = []
      /** @type {FakeUiSession} */
      const uiSession = {
        async readStatus() {
          return {
            connectionState: "down",
            loginSucceeded: true,
            uiReachable: true,
            uptimeMs: 3_600_000,
            visibleText: "Disconnected"
          }
        },

        async reboot() {
          rebooted = true

          return {ok: true}
        }
      }

      const exitCode = await runCli({
        argv: ["reboot", "--config", configPath],
        clock: () => 7_200_000,
        connectivityProbe: successfulConnectivityProbe(),
        stateStore: fakeStateStore({savedStates}),
        stdout: {write: () => {}},
        uiSession
      })

      expect(exitCode).toEqual(0)
      expect(rebooted).toEqual(true)
      expect(savedStates).toEqual([{lastRebootAtMs: 7_200_000}])
    })
  })

  it("watch repeats checks on the configured interval", async () => {
    await withTempConfig(async (configPath) => {
      /** @type {WatchdogState} */
      let currentState = {lastRebootAtMs: null}
      let readCount = 0
      /** @type {number[]} */
      const sleepCalls = []
      /** @type {WatchdogState[]} */
      const savedStates = []
      /** @type {FakeUiSession} */
      const uiSession = {
        async readStatus() {
          readCount += 1

          return {
            connectionState: readCount === 1 ? "down" : "healthy",
            loginSucceeded: true,
            uiReachable: true,
            uptimeMs: 3_600_000,
            visibleText: readCount === 1 ? "Disconnected" : "Connected"
          }
        },

        async reboot() {
          return {ok: true}
        }
      }
      /** @type {FakeStateStore} */
      const stateStore = {
        async load() {
          return currentState
        },

        async save(nextState) {
          currentState = nextState
          savedStates.push(nextState)
        }
      }

      const exitCode = await runCli({
        argv: ["watch", "--config", configPath],
        clock: () => 7_200_000,
        connectivityProbe: successfulConnectivityProbe(),
        maxIterations: 2,
        sleep: async (ms) => {
          sleepCalls.push(ms)
        },
        stateStore,
        stdout: {write: () => {}},
        uiSession
      })

      expect(exitCode).toEqual(0)
      expect(readCount).toEqual(2)
      expect(sleepCalls).toEqual([300_000])
      expect(savedStates).toEqual([{lastRebootAtMs: 7_200_000}])
    })
  })

  it("watch keeps running after a transient UI status read failure", async () => {
    await withTempConfig(async (configPath) => {
      /** @type {string[]} */
      const stdout = []
      let readCount = 0
      /** @type {number[]} */
      const sleepCalls = []
      /** @type {FakeUiSession} */
      const uiSession = {
        async readStatus() {
          readCount += 1

          if (readCount === 1) {
            throw new Error("gateway UI temporarily unavailable")
          }

          return {
            connectionState: "healthy",
            loginSucceeded: true,
            uiReachable: true,
            uptimeMs: 3_600_000,
            visibleText: "Connected"
          }
        },

        async reboot() {
          throw new Error("watch should not reboot after a UI read failure")
        }
      }

      const exitCode = await runCli({
        argv: ["watch", "--config", configPath],
        connectivityProbe: successfulConnectivityProbe(),
        maxIterations: 2,
        sleep: async (ms) => {
          sleepCalls.push(ms)
        },
        stateStore: fakeStateStore(),
        stdout: {write: (message) => stdout.push(message)},
        uiSession
      })

      expect(exitCode).toEqual(0)
      expect(readCount).toEqual(2)
      expect(sleepCalls).toEqual([300_000])
      expect(stdout.map((line) => JSON.parse(line))).toEqual([
        {
          command: "watch",
          decision: {
            healthReason: "ui_unreachable",
            nextRebootAllowedAtMs: null,
            shouldReboot: false,
            skipReason: null
          },
          rebootResult: null
        },
        {
          command: "watch",
          decision: {
            healthReason: "healthy",
            nextRebootAllowedAtMs: null,
            shouldReboot: false,
            skipReason: null
          },
          rebootResult: null
        }
      ])
    })
  })
})

/**
 * @param {Partial<GatewayUiStatus>} [overrides] - Status fields to override.
 * @returns {GatewayUiStatus} Healthy gateway status.
 */
function healthyStatus(overrides = {}) {
  return {
    connectionState: "healthy",
    loginSucceeded: true,
    uiReachable: true,
    uptimeMs: 3_600_000,
    visibleText: "Connected",
    ...overrides
  }
}

/**
 * @returns {FakeConnectivityProbe} Connectivity probe that succeeds.
 */
function successfulConnectivityProbe() {
  return {
    async check() {
      return {error: null, ok: true}
    }
  }
}

/**
 * @param {FakeStateStoreArgs} [args] - Fake state-store arguments.
 * @returns {FakeStateStore} Fake state store.
 */
function fakeStateStore({savedStates = [], state = {lastRebootAtMs: null}} = {}) {
  return {
    async load() {
      return state
    },

    async save(nextState) {
      savedStates.push(nextState)
    }
  }
}

/**
 * @param {string[]} stdout - Captured stdout chunks.
 * @returns {void}
 */
function expectUsageOutput(stdout) {
  expect(JSON.parse(stdout.join(""))).toEqual({
    commands: ["check", "watch", "reboot", "help"],
    usage: "zyxel-nr5101-watchdog <command> [--config config/secrets.json]"
  })
}

/**
 * @param {(configPath: string) => Promise<void>} callback - Callback receiving the temporary config path.
 * @returns {Promise<void>}
 */
async function withTempConfig(callback) {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "zyxel-watchdog-cli-"))
  const configPath = path.join(tempDirectory, "secrets.json")

  try {
    await writeFile(configPath, `${JSON.stringify({
      password: "secret-password",
      uiUrl: "http://192.168.86.3",
      username: "admin"
    }, null, 2)}\n`)
    await callback(configPath)
  } finally {
    await rm(tempDirectory, {force: true, recursive: true})
  }
}
