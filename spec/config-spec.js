// @ts-check

import {mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "velocious/build/src/testing/test.js"
import Config from "../src/config.js"

describe("Config", () => {
  it("loads required router credentials with watchdog defaults", async () => {
    await withTempConfig({
      password: "secret-password",
      uiUrl: "http://192.168.86.3",
      username: "admin"
    }, async (configPath) => {
      const config = await Config.load({configPath})

      expect(config.uiUrl).toEqual("http://192.168.86.3")
      expect(config.username).toEqual("admin")
      expect(config.password).toEqual("secret-password")
      expect(config.checkIntervalMs).toEqual(300_000)
      expect(config.rebootCooldownMs).toEqual(3_600_000)
      expect(config.bootGracePeriodMs).toEqual(600_000)
      expect(config.minimumUptimeBeforeRebootMs).toEqual(null)
      expect(config.statePath).toEqual("var/state.json")
      expect(config.labels.healthy).toContain("connected")
      expect(config.labels.down).toContain("disconnected")
      expect(config.labels.establishing).toContain("connecting")
    })
  })

  it("loads optional durations, selectors, and labels", async () => {
    await withTempConfig({
      bootGracePeriodMs: 120_000,
      checkIntervalMs: 60_000,
      labels: {
        down: ["No internet access"],
        establishing: ["Registering"],
        healthy: ["IPv4 connected"]
      },
      minimumUptimeBeforeRebootMs: 900_000,
      password: "secret-password",
      rebootCooldownMs: 1_800_000,
      selectors: {
        loginButton: "#loginBtn",
        passwordInput: "#password",
        rebootButton: "#reboot",
        usernameInput: "#username"
      },
      statePath: "var/custom-state.json",
      uiUrl: "http://router.local",
      username: "admin"
    }, async (configPath) => {
      const config = await Config.load({configPath})

      expect(config.checkIntervalMs).toEqual(60_000)
      expect(config.rebootCooldownMs).toEqual(1_800_000)
      expect(config.bootGracePeriodMs).toEqual(120_000)
      expect(config.minimumUptimeBeforeRebootMs).toEqual(900_000)
      expect(config.statePath).toEqual("var/custom-state.json")
      expect(config.selectors.usernameInput).toEqual("#username")
      expect(config.labels.down).toEqual(["No internet access"])
      expect(config.labels.establishing).toEqual(["Registering"])
      expect(config.labels.healthy).toEqual(["IPv4 connected"])
    })
  })

  it("throws when a required secret is missing", async () => {
    await withTempConfig({
      password: "secret-password",
      uiUrl: "http://192.168.86.3"
    }, async (configPath) => {
      await expect(() => Config.load({configPath})).toThrow(/username/)
    })
  })
})

async function withTempConfig(configObject, callback) {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "zyxel-watchdog-config-"))
  const configPath = path.join(tempDirectory, "secrets.json")

  try {
    await writeFile(configPath, `${JSON.stringify(configObject, null, 2)}\n`)
    await callback(configPath)
  } finally {
    await rm(tempDirectory, {force: true, recursive: true})
  }
}
