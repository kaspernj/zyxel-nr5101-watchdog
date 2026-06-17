import Config, {DEFAULT_CONFIG_PATH} from "./config.js"
import StateStore from "./state-store.js"
import SystemTestingUiSession from "./system-testing-ui-session.js"
import TcpConnectivityProbe from "./tcp-connectivity-probe.js"
import Watchdog from "./watchdog.js"

/**
 * @typedef {object} CliStreams
 * @property {(message: string) => unknown} write - Stream write method.
 */

/**
 * @typedef {object} CliRuntime
 * @property {{load: () => Promise<{lastRebootAtMs: number | null}>, save: (state: {lastRebootAtMs: number | null}) => Promise<void>}} activeStateStore - State store.
 * @property {() => number} clock - Clock returning epoch milliseconds.
 * @property {Config} config - Watchdog config.
 * @property {import("./watchdog.js").ConnectivityProbe} connectivityProbe - Outbound connectivity probe.
 * @property {number | undefined} maxIterations - Maximum watch iterations.
 * @property {(ms: number) => Promise<void>} sleep - Sleep function.
 * @property {CliStreams} stdout - Output stream.
 * @property {{readStatus: (config: Config) => Promise<import("./watchdog.js").GatewayUiStatus>, reboot?: (config: Config) => Promise<Record<string, unknown>>}} uiSession - UI session.
 * @property {Watchdog} watchdog - Watchdog instance.
 */

/** @typedef {(runtime: CliRuntime) => Promise<number>} CliCommandHandler */

/**
 * @param {string[]} [argv] - CLI arguments.
 * @returns {Promise<void>}
 */
export async function main(argv = process.argv.slice(2)) {
  try {
    process.exitCode = await runCli({argv})
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

/**
 * @param {object} [args] - Runtime arguments.
 * @param {string[]} [args.argv] - CLI arguments.
 * @param {() => number} [args.clock] - Clock returning epoch milliseconds.
 * @param {import("./watchdog.js").ConnectivityProbe} [args.connectivityProbe] - Outbound connectivity probe.
 * @param {number} [args.maxIterations] - Maximum watch iterations, mainly for tests.
 * @param {(ms: number) => Promise<void>} [args.sleep] - Sleep function, mainly for tests.
 * @param {{load: () => Promise<{lastRebootAtMs: number | null}>, save: (state: {lastRebootAtMs: number | null}) => Promise<void>}} [args.stateStore] - State store.
 * @param {CliStreams} [args.stdout] - Output stream.
 * @param {{readStatus: (config: Config) => Promise<import("./watchdog.js").GatewayUiStatus>, reboot?: (config: Config) => Promise<Record<string, unknown>>}} [args.uiSession] - UI session.
 * @returns {Promise<number>} Process exit code.
 */
export async function runCli({argv = process.argv.slice(2), clock = () => Date.now(), connectivityProbe = new TcpConnectivityProbe(), maxIterations, sleep = sleepMs, stateStore, stdout = process.stdout, uiSession = new SystemTestingUiSession()} = {}) {
  const {command, configPath} = parseCliArgs(argv)
  const commandHandler = commandHandlerFor(command)

  if (!commandHandler) {
    writeUsage(stdout)

    return 1
  }

  const config = await Config.load({configPath})
  const activeStateStore = stateStore ?? new StateStore({statePath: config.statePath})
  const watchdog = new Watchdog({clock})

  return await commandHandler({activeStateStore, clock, config, connectivityProbe, maxIterations, sleep, stdout, uiSession, watchdog})
}

/**
 * @param {CliRuntime} runtime - CLI runtime collaborators.
 * @returns {Promise<number>} Process exit code.
 */
async function runCheckCommand({activeStateStore, config, connectivityProbe, stdout, uiSession, watchdog}) {
  const state = await activeStateStore.load()
  const {decision} = await watchdog.check({config, connectivityProbe, state, uiSession})

  writeJsonLine(stdout, {command: "check", decision})

  return 0
}

/**
 * @param {CliRuntime} runtime - CLI runtime collaborators.
 * @returns {Promise<number>} Process exit code.
 */
async function runRebootCommand({activeStateStore, clock, config, connectivityProbe, stdout, uiSession, watchdog}) {
  const state = await activeStateStore.load()
  const result = await watchdog.rebootIfNeeded({config, connectivityProbe, state, uiSession: requiredRebootSession(uiSession)})

  await saveRebootStateIfSuccessful({activeStateStore, clock, rebootResult: result.rebootResult})
  writeJsonLine(stdout, {command: "reboot", decision: result.decision, rebootResult: result.rebootResult})

  return 0
}

/**
 * @param {CliRuntime} runtime - CLI runtime collaborators.
 * @returns {Promise<number>} Process exit code.
 */
async function runWatchCommand({activeStateStore, clock, config, connectivityProbe, maxIterations, sleep, stdout, uiSession, watchdog}) {
  await runWatchLoop({activeStateStore, clock, config, connectivityProbe, maxIterations, sleep, stdout, uiSession: requiredRebootSession(uiSession), watchdog})

  return 0
}

/**
 * @param {object} args - Watch loop arguments.
 * @param {{load: () => Promise<{lastRebootAtMs: number | null}>, save: (state: {lastRebootAtMs: number | null}) => Promise<void>}} args.activeStateStore - State store.
 * @param {() => number} args.clock - Clock returning epoch milliseconds.
 * @param {Config} args.config - Watchdog config.
 * @param {import("./watchdog.js").ConnectivityProbe} args.connectivityProbe - Outbound connectivity probe.
 * @param {number} [args.maxIterations] - Maximum iterations.
 * @param {(ms: number) => Promise<void>} args.sleep - Sleep function.
 * @param {CliStreams} args.stdout - Output stream.
 * @param {{readStatus: (config: Config) => Promise<import("./watchdog.js").GatewayUiStatus>, reboot: (config: Config) => Promise<Record<string, unknown>>}} args.uiSession - UI session.
 * @param {Watchdog} args.watchdog - Watchdog instance.
 * @returns {Promise<void>}
 */
async function runWatchLoop({activeStateStore, clock, config, connectivityProbe, maxIterations, sleep, stdout, uiSession, watchdog}) {
  let iterations = 0
  const watchUiSession = watchLoopUiSession(uiSession)

  while (true) {
    const state = await activeStateStore.load()
    const result = await watchdog.rebootIfNeeded({config, connectivityProbe, state, uiSession: watchUiSession})

    await saveRebootStateIfSuccessful({activeStateStore, clock, rebootResult: result.rebootResult})
    writeJsonLine(stdout, {command: "watch", decision: result.decision, rebootResult: result.rebootResult})
    iterations += 1

    if (maxIterations !== undefined && iterations >= maxIterations) {
      return
    }

    await sleep(config.checkIntervalMs)
  }
}

/**
 * @param {{readStatus: (config: Config) => Promise<import("./watchdog.js").GatewayUiStatus>, reboot: (config: Config) => Promise<Record<string, unknown>>}} uiSession - UI session.
 * @returns {{readStatus: (config: Config) => Promise<import("./watchdog.js").GatewayUiStatus>, reboot: (config: Config) => Promise<Record<string, unknown>>}} Watch-loop UI session.
 */
function watchLoopUiSession(uiSession) {
  return {
    async readStatus(config) {
      try {
        return await uiSession.readStatus(config)
      } catch {
        return uiUnreachableStatus()
      }
    },

    async reboot(config) {
      return await uiSession.reboot(config)
    }
  }
}

/**
 * @returns {import("./watchdog.js").GatewayUiStatus} Synthetic unreachable status.
 */
function uiUnreachableStatus() {
  return {
    connectionState: "unknown",
    loginSucceeded: false,
    uiReachable: false,
    uptimeMs: null,
    visibleText: "UI status read failed"
  }
}

/**
 * @param {string[]} argv - CLI arguments.
 * @returns {{command: string, configPath: string}} Parsed arguments.
 */
function parseCliArgs(argv) {
  return {
    command: argv[0] ?? "help",
    configPath: configPathFromArgs(argv.slice(1))
  }
}

/**
 * @param {string[]} args - Arguments after the command.
 * @returns {string} Parsed config path.
 */
function configPathFromArgs(args) {
  let configPath = DEFAULT_CONFIG_PATH

  for (let index = 0; index < args.length; index++) {
    const parsedArg = configPathFromArg({arg: args[index], nextArg: args[index + 1]})

    if (!parsedArg) {
      throw new Error(`Unknown argument: ${args[index]}`)
    }

    configPath = parsedArg.configPath
    index += parsedArg.skipNext ? 1 : 0
  }

  return configPath
}

/**
 * @param {object} args - Parse arguments.
 * @param {string} args.arg - Current argument.
 * @param {string | undefined} args.nextArg - Following argument.
 * @returns {{configPath: string, skipNext: boolean} | null} Parsed config flag, or null for unknown arguments.
 */
function configPathFromArg({arg, nextArg}) {
  if (arg === "--config") {
    return {configPath: requiredConfigPathArg(nextArg), skipNext: true}
  }

  if (arg.startsWith("--config=")) {
    return {configPath: arg.slice("--config=".length), skipNext: false}
  }

  return null
}

/**
 * @param {string | undefined} nextArg - Path following `--config`.
 * @returns {string} Config path.
 */
function requiredConfigPathArg(nextArg) {
  if (!nextArg) {
    throw new Error("--config requires a path")
  }

  return nextArg
}

/**
 * @param {string} command - Parsed CLI command.
 * @returns {CliCommandHandler | null} Matching handler, or null when unknown.
 */
function commandHandlerFor(command) {
  if (command === "check") return runCheckCommand
  if (command === "reboot") return runRebootCommand
  if (command === "watch") return runWatchCommand

  return null
}

/**
 * @param {object} args - Save arguments.
 * @param {{save: (state: {lastRebootAtMs: number | null}) => Promise<void>}} args.activeStateStore - State store.
 * @param {() => number} args.clock - Clock returning epoch milliseconds.
 * @param {Record<string, unknown> | null} args.rebootResult - Reboot result.
 * @returns {Promise<void>}
 */
async function saveRebootStateIfSuccessful({activeStateStore, clock, rebootResult}) {
  if (rebootResult?.ok === true) {
    await activeStateStore.save({lastRebootAtMs: clock()})
  }
}

/**
 * @param {CliStreams} stdout - Output stream.
 * @param {Record<string, unknown>} payload - JSON payload.
 * @returns {void}
 */
function writeJsonLine(stdout, payload) {
  stdout.write(`${JSON.stringify(payload)}\n`)
}

/**
 * @param {CliStreams} stdout - Output stream.
 * @returns {void}
 */
function writeUsage(stdout) {
  writeJsonLine(stdout, {commands: ["check", "watch", "reboot"], usage: "zyxel-nr5101-watchdog <command> [--config config/secrets.json]"})
}

/**
 * @param {number} ms - Milliseconds to sleep.
 * @returns {Promise<void>}
 */
async function sleepMs(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * @param {{readStatus: (config: Config) => Promise<import("./watchdog.js").GatewayUiStatus>, reboot?: (config: Config) => Promise<Record<string, unknown>>}} uiSession - UI session.
 * @returns {{readStatus: (config: Config) => Promise<import("./watchdog.js").GatewayUiStatus>, reboot: (config: Config) => Promise<Record<string, unknown>>}} Reboot-capable session.
 */
function requiredRebootSession(uiSession) {
  if (!uiSession.reboot) {
    throw new Error("UI session does not support reboot")
  }

  return /** @type {{readStatus: (config: Config) => Promise<import("./watchdog.js").GatewayUiStatus>, reboot: (config: Config) => Promise<Record<string, unknown>>}} */ (uiSession)
}
