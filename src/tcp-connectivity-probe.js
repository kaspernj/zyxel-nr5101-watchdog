import {createConnection} from "node:net"

/** Runs the watchdog outbound TCP connectivity probe. */
export default class TcpConnectivityProbe {
  /**
   * @param {import("./config.js").default} config - Watchdog config.
   * @returns {Promise<import("./watchdog.js").ConnectivityProbeResult>} Probe result.
   */
  async check(config) {
    return await new Promise((resolve) => {
      const socket = createConnection({
        host: config.connectivityProbeHost,
        port: config.connectivityProbePort
      })
      let settled = false

      /**
       * @param {import("./watchdog.js").ConnectivityProbeResult} result - Probe result.
       * @returns {void}
       */
      const finish = (result) => {
        if (settled) {
          return
        }

        settled = true
        socket.destroy()
        resolve(result)
      }

      socket.setTimeout(config.connectivityProbeTimeoutMs)
      socket.once("connect", () => {
        finish({error: null, ok: true})
      })
      socket.once("error", (error) => {
        finish({error: error.message, ok: false})
      })
      socket.once("timeout", () => {
        finish({error: `Timed out after ${config.connectivityProbeTimeoutMs}ms`, ok: false})
      })
    })
  }
}
