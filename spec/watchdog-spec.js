import {describe, expect, it} from "velocious/build/src/testing/test.js"
import Config from "../src/config.js"
import Watchdog, {HEALTH_REASONS, SKIP_REASONS} from "../src/watchdog.js"

/** @typedef {import("../src/watchdog.js").GatewayUiStatus} GatewayUiStatus */
/** @typedef {{lastRebootAtMs?: number, nowMs?: number}} EvaluationOptions */

describe("Watchdog", () => {
  it("exposes the required health reasons", () => {
    expect(Object.values(HEALTH_REASONS).sort()).toEqual([
      "boot_grace_period",
      "connection_down",
      "connection_establishing",
      "healthy",
      "login_failed",
      "ui_unreachable",
      "unknown_status"
    ])
  })

  it("does not reboot when the gateway is healthy", () => {
    const decision = evaluateStatus({connectionState: "healthy", uptimeMs: 3_600_000})

    expect(decision.healthReason).toEqual("healthy")
    expect(decision.shouldReboot).toEqual(false)
  })

  it("allows reboot when the connection is clearly down and cooldown has passed", () => {
    const decision = evaluateStatus({connectionState: "down", uptimeMs: 3_600_000}, {
      lastRebootAtMs: 0,
      nowMs: 7_200_000
    })

    expect(decision.healthReason).toEqual("connection_down")
    expect(decision.shouldReboot).toEqual(true)
    expect(decision.skipReason).toEqual(null)
  })

  it("does not reboot during the reboot cooldown", () => {
    const decision = evaluateStatus({connectionState: "down", uptimeMs: 3_600_000}, {
      lastRebootAtMs: 3_000_000,
      nowMs: 3_300_000
    })

    expect(decision.healthReason).toEqual("connection_down")
    expect(decision.shouldReboot).toEqual(false)
    expect(decision.skipReason).toEqual(SKIP_REASONS.rebootCooldown)
    expect(decision.nextRebootAllowedAtMs).toEqual(6_600_000)
  })

  it("does not reboot while the gateway is inside the boot grace period", () => {
    const decision = evaluateStatus({connectionState: "down", uptimeMs: 120_000})

    expect(decision.healthReason).toEqual("boot_grace_period")
    expect(decision.shouldReboot).toEqual(false)
  })

  it("does not reboot while the UI says the connection is establishing", () => {
    const decision = evaluateStatus({connectionState: "establishing", uptimeMs: 3_600_000})

    expect(decision.healthReason).toEqual("connection_establishing")
    expect(decision.shouldReboot).toEqual(false)
  })

  it("classifies disconnected text as down instead of matching the connected label", () => {
    const decision = evaluateStatus({connectionState: "unknown", uptimeMs: 3_600_000, visibleText: "Disconnected"})

    expect(decision.healthReason).toEqual("connection_down")
    expect(decision.shouldReboot).toEqual(true)
  })

  it("reports login failure, unreachable UI, and unknown status without rebooting", () => {
    expect(evaluateStatus({loginSucceeded: false}).healthReason).toEqual("login_failed")
    expect(evaluateStatus({uiReachable: false}).healthReason).toEqual("ui_unreachable")
    expect(evaluateStatus({connectionState: "unknown", visibleText: "Dashboard"}).healthReason).toEqual("unknown_status")
  })
})

/**
 * @param {Partial<GatewayUiStatus>} statusOverrides - Status fields to override.
 * @param {EvaluationOptions} [options] - Evaluation options.
 * @returns {ReturnType<Watchdog["evaluate"]>} Watchdog decision.
 */
function evaluateStatus(statusOverrides, options = {}) {
  const config = Config.fromObject({
    password: "secret-password",
    uiUrl: "http://192.168.86.3",
    username: "admin"
  }, {source: "spec"})
  const watchdog = new Watchdog({clock: () => options.nowMs ?? 7_200_000})

  /** @type {GatewayUiStatus} */
  const status = {
    connectionState: "unknown",
    loginSucceeded: true,
    uiReachable: true,
    uptimeMs: null,
    visibleText: "",
    ...statusOverrides
  }

  return watchdog.evaluate({
    config,
    state: {lastRebootAtMs: options.lastRebootAtMs ?? null},
    status
  })
}
