// @ts-check

import {mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "velocious/build/src/testing/test.js"
import {runCli} from "../src/cli.js"

describe("CLI", () => {
  it("prints usage without loading config when no command is given", async () => {
    const stdout = []

    const exitCode = await runCli({argv: [], stdout: {write: (message) => stdout.push(message)}})

    expect(exitCode).toEqual(1)
    expect(JSON.parse(stdout.join(""))).toEqual({
      commands: ["check", "watch", "reboot"],
      usage: "zyxel-nr5101-watchdog <command> [--config config/secrets.json]"
    })
  })

  it("check loads config, reads the UI status, and prints the watchdog decision", async () => {
    await withTempConfig(async (configPath) => {
      const stdout = []
      const stateStore = fakeStateStore()
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

  it("reboot invokes the UI reboot only when the watchdog decision allows it", async () => {
    await withTempConfig(async (configPath) => {
      let rebooted = false
      const savedStates = []
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
      let currentState = {lastRebootAtMs: null}
      let readCount = 0
      const sleepCalls = []
      const savedStates = []
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
})

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
