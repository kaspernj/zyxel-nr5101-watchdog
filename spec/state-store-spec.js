import {mkdtemp, rm} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, expect, it} from "velocious/build/src/testing/test.js"
import StateStore from "../src/state-store.js"

describe("StateStore", () => {
  it("returns an empty reboot state when the state file does not exist", async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "zyxel-watchdog-state-"))

    try {
      const stateStore = new StateStore({statePath: path.join(tempDirectory, "state.json")})

      expect(await stateStore.load()).toEqual({lastRebootAtMs: null})
    } finally {
      await rm(tempDirectory, {force: true, recursive: true})
    }
  })

  it("saves and reloads the last reboot timestamp", async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "zyxel-watchdog-state-"))

    try {
      const stateStore = new StateStore({statePath: path.join(tempDirectory, "nested", "state.json")})

      await stateStore.save({lastRebootAtMs: 7_200_000})

      expect(await stateStore.load()).toEqual({lastRebootAtMs: 7_200_000})
    } finally {
      await rm(tempDirectory, {force: true, recursive: true})
    }
  })
})
