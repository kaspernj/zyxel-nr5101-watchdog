export const HEALTH_REASONS = Object.freeze({
  bootGracePeriod: "boot_grace_period",
  connectivityProbeFailed: "connectivity_probe_failed",
  connectionDown: "connection_down",
  connectionEstablishing: "connection_establishing",
  healthy: "healthy",
  loginFailed: "login_failed",
  uiUnreachable: "ui_unreachable",
  unknownStatus: "unknown_status"
})

export const SKIP_REASONS = Object.freeze({
  rebootCooldown: "reboot_cooldown"
})

/** @typedef {"down" | "establishing" | "healthy"} GatewayLabelKey */
/**
 * @typedef {"down" | "establishing" | "healthy" | "unknown"} GatewayConnectionState
 */

/** @type {Record<GatewayConnectionState, string | null>} */
const CONNECTION_STATE_HEALTH_REASONS = Object.freeze({
  down: HEALTH_REASONS.connectionDown,
  establishing: HEALTH_REASONS.connectionEstablishing,
  healthy: HEALTH_REASONS.healthy,
  unknown: null
})

/** @type {readonly {labelsKey: GatewayLabelKey, reason: string}[]} */
const LABEL_HEALTH_REASONS = Object.freeze([
  {labelsKey: "establishing", reason: HEALTH_REASONS.connectionEstablishing},
  {labelsKey: "down", reason: HEALTH_REASONS.connectionDown},
  {labelsKey: "healthy", reason: HEALTH_REASONS.healthy}
])

/** @type {ReadonlySet<string>} */
const REBOOTABLE_HEALTH_REASONS = new Set([
  HEALTH_REASONS.connectivityProbeFailed,
  HEALTH_REASONS.connectionDown
])

/**
 * @typedef {object} ConnectivityProbeResult
 * @property {string | null} error - Probe failure description, or null on success.
 * @property {boolean} ok - Whether the outbound connectivity probe succeeded.
 */

/**
 * @typedef {object} ConnectivityProbe
 * @property {(config: import("./config.js").default) => Promise<ConnectivityProbeResult>} check - Runs the outbound connectivity check.
 */

/**
 * @typedef {object} GatewayUiStatus
 * @property {GatewayConnectionState} connectionState - Structured connection state from the UI adapter.
 * @property {boolean} loginSucceeded - Whether gateway login succeeded.
 * @property {boolean} uiReachable - Whether the browser reached the gateway UI.
 * @property {number | null} uptimeMs - Gateway uptime when known.
 * @property {string} visibleText - Visible UI text used for label fallback classification.
 */

/**
 * @typedef {object} WatchdogState
 * @property {number | null} [lastRebootAtMs] - Last reboot timestamp, if any.
 */

/** Evaluates gateway UI status and decides whether a reboot is safe. */
export default class Watchdog {
  /**
   * @param {object} [args] - Constructor arguments.
   * @param {() => number} [args.clock] - Clock returning epoch milliseconds.
   */
  constructor({clock = () => Date.now()} = {}) {
    this.clock = clock
  }

  /**
   * @param {object} args - Evaluation arguments.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {ConnectivityProbeResult | null} [args.connectivityProbeResult] - Outbound probe result when checked.
   * @param {WatchdogState} [args.state] - Persisted watchdog state.
   * @param {GatewayUiStatus} args.status - Latest gateway UI status.
   * @returns {{healthReason: string, nextRebootAllowedAtMs: number | null, shouldReboot: boolean, skipReason: string | null}} Decision.
   */
  evaluate({config, connectivityProbeResult = null, state = {}, status}) {
    const healthReason = this.healthReason({config, connectivityProbeResult, status})
    const decision = {
      healthReason,
      nextRebootAllowedAtMs: null,
      shouldReboot: false,
      skipReason: null
    }

    if (!REBOOTABLE_HEALTH_REASONS.has(healthReason)) {
      return decision
    }

    const lastRebootAtMs = state.lastRebootAtMs

    if (typeof lastRebootAtMs === "number") {
      const nextRebootAllowedAtMs = lastRebootAtMs + config.rebootCooldownMs

      if (this.clock() < nextRebootAllowedAtMs) {
        return {
          ...decision,
          nextRebootAllowedAtMs,
          skipReason: SKIP_REASONS.rebootCooldown
        }
      }
    }

    return {
      ...decision,
      shouldReboot: true
    }
  }

  /**
   * @param {object} args - Check arguments.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {ConnectivityProbe} [args.connectivityProbe] - Outbound connectivity probe.
   * @param {WatchdogState} [args.state] - Persisted watchdog state.
   * @param {{readStatus: (config: import("./config.js").default) => Promise<GatewayUiStatus>}} args.uiSession - UI automation session.
   * @returns {Promise<{decision: ReturnType<Watchdog["evaluate"]>, status: GatewayUiStatus}>} Check result.
   */
  async check({config, connectivityProbe, state = {}, uiSession}) {
    const status = await uiSession.readStatus(config)
    const connectivityProbeResult = await this.connectivityProbeResult({config, connectivityProbe, status})

    return {
      decision: this.evaluate({config, connectivityProbeResult, state, status}),
      status
    }
  }

  /**
   * @param {object} args - Reboot arguments.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {ConnectivityProbe} [args.connectivityProbe] - Outbound connectivity probe.
   * @param {WatchdogState} [args.state] - Persisted watchdog state.
   * @param {{readStatus: (config: import("./config.js").default) => Promise<GatewayUiStatus>, reboot: (config: import("./config.js").default) => Promise<Record<string, unknown>>}} args.uiSession - UI automation session.
   * @returns {Promise<{decision: ReturnType<Watchdog["evaluate"]>, rebootResult: Record<string, unknown> | null, status: GatewayUiStatus}>} Reboot result.
   */
  async rebootIfNeeded({config, connectivityProbe, state = {}, uiSession}) {
    const checkResult = await this.check({config, connectivityProbe, state, uiSession})

    if (!checkResult.decision.shouldReboot) {
      return {...checkResult, rebootResult: null}
    }

    return {
      ...checkResult,
      rebootResult: await uiSession.reboot(config)
    }
  }

  /**
   * @param {object} args - Health classification arguments.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {ConnectivityProbeResult | null} [args.connectivityProbeResult] - Outbound probe result when checked.
   * @param {GatewayUiStatus} args.status - Latest UI status.
   * @returns {string} Health reason.
   */
  healthReason({config, connectivityProbeResult = null, status}) {
    const preConnectionReason = this.preConnectionHealthReason({status})

    if (preConnectionReason) {
      return preConnectionReason
    }

    const connectionHealthReason = this.connectionHealthReason({config, status})

    if (connectionHealthReason === HEALTH_REASONS.healthy) {
      if (this.connectivityProbeApplies({config, status}) && connectivityProbeResult?.ok === false) {
        return HEALTH_REASONS.connectivityProbeFailed
      }

      return HEALTH_REASONS.healthy
    }

    if (this.insideBootGracePeriod({config, status})) {
      return HEALTH_REASONS.bootGracePeriod
    }

    return connectionHealthReason
  }

  /**
   * @param {object} args - Probe arguments.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {ConnectivityProbe | undefined} args.connectivityProbe - Outbound connectivity probe.
   * @param {GatewayUiStatus} args.status - Latest UI status.
   * @returns {Promise<ConnectivityProbeResult | null>} Probe result, or null when no probe should run.
   */
  async connectivityProbeResult({config, connectivityProbe, status}) {
    if (!connectivityProbe || !this.connectivityProbeApplies({config, status})) {
      return null
    }

    return await connectivityProbe.check(config)
  }

  /**
   * @param {object} args - Probe gating arguments.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {GatewayUiStatus} args.status - Latest UI status.
   * @returns {boolean} Whether the outbound probe applies to this status.
   */
  connectivityProbeApplies({config, status}) {
    if (this.preConnectionHealthReason({status})) {
      return false
    }

    if (status.uptimeMs === null || status.uptimeMs < config.connectivityProbeMinimumUptimeMs) {
      return false
    }

    if (config.minimumUptimeBeforeRebootMs !== null && status.uptimeMs < config.minimumUptimeBeforeRebootMs) {
      return false
    }

    return this.connectionHealthReason({config, status}) === HEALTH_REASONS.healthy
  }

  /**
   * @param {object} args - Health classification arguments.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {GatewayUiStatus} args.status - Latest UI status.
   * @returns {string} Connection-derived health reason.
   */
  connectionHealthReason({config, status}) {
    return this.connectionStateHealthReason(status.connectionState)
      ?? this.visibleTextHealthReason({config, status})
      ?? HEALTH_REASONS.unknownStatus
  }

  /**
   * @param {object} args - Health classification arguments.
   * @param {GatewayUiStatus} args.status - Latest UI status.
   * @returns {string | null} Health reason that blocks connection checks, if any.
   */
  preConnectionHealthReason({status}) {
    if (!status.uiReachable) {
      return HEALTH_REASONS.uiUnreachable
    }

    if (!status.loginSucceeded) {
      return HEALTH_REASONS.loginFailed
    }

    return null
  }

  /**
   * @param {GatewayConnectionState} connectionState - Structured connection state.
   * @returns {string | null} Health reason, or null when unknown.
   */
  connectionStateHealthReason(connectionState) {
    return CONNECTION_STATE_HEALTH_REASONS[connectionState]
  }

  /**
   * @param {object} args - Visible text classification arguments.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {GatewayUiStatus} args.status - Latest UI status.
   * @returns {string | null} Health reason, or null when no label matches.
   */
  visibleTextHealthReason({config, status}) {
    for (const {labelsKey, reason} of LABEL_HEALTH_REASONS) {
      if (this.visibleTextContains(status.visibleText, config.labels[labelsKey])) {
        return reason
      }
    }

    return null
  }

  /**
   * @param {object} args - Boot grace arguments.
   * @param {import("./config.js").default} args.config - Watchdog config.
   * @param {GatewayUiStatus} args.status - Latest UI status.
   * @returns {boolean} Whether the gateway is still inside startup grace.
   */
  insideBootGracePeriod({config, status}) {
    if (status.uptimeMs === null) {
      return false
    }

    if (status.uptimeMs < config.bootGracePeriodMs) {
      return true
    }

    return config.minimumUptimeBeforeRebootMs !== null && status.uptimeMs < config.minimumUptimeBeforeRebootMs
  }

  /**
   * @param {string} visibleText - Visible gateway UI text.
   * @param {string[]} labels - Labels to match.
   * @returns {boolean} Whether text contains one of the labels.
   */
  visibleTextContains(visibleText, labels) {
    const normalizedText = visibleText.toLowerCase()

    return labels.some((label) => this.labelMatches(normalizedText, label))
  }

  /**
   * @param {string} normalizedText - Lowercase visible gateway UI text.
   * @param {string} label - Label to match.
   * @returns {boolean} Whether the label appears as a standalone phrase.
   */
  labelMatches(normalizedText, label) {
    const normalizedLabel = label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
    const labelPattern = new RegExp(`(^|[^a-z0-9])${normalizedLabel}([^a-z0-9]|$)`)

    return labelPattern.test(normalizedText)
  }
}
