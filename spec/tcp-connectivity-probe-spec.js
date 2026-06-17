import {createServer} from "node:net"
import {describe, expect, it} from "velocious/build/src/testing/test.js"
import Config from "../src/config.js"
import TcpConnectivityProbe from "../src/tcp-connectivity-probe.js"

describe("TcpConnectivityProbe", () => {
  it("reports success when a TCP connection can be opened", async () => {
    const server = createServer((socket) => {
      socket.destroy()
    })

    await listenOnLocalhost(server)

    try {
      const result = await new TcpConnectivityProbe().check(configFromObject({
        connectivityProbePort: serverPort(server)
      }))

      expect(result).toEqual({error: null, ok: true})
    } finally {
      await closeServer(server)
    }
  })

  it("reports failure instead of throwing when a TCP connection cannot be opened", async () => {
    const server = createServer()

    await listenOnLocalhost(server)
    const closedPort = serverPort(server)
    await closeServer(server)

    const result = await new TcpConnectivityProbe().check(configFromObject({
      connectivityProbePort: closedPort,
      connectivityProbeTimeoutMs: 500
    }))

    expect(result.ok).toEqual(false)
    expect(typeof result.error).toEqual("string")
  })
})

/**
 * @param {Record<string, unknown>} [overrides] - Config fields to override.
 * @returns {Config} Probe config.
 */
function configFromObject(overrides = {}) {
  return Config.fromObject({
    connectivityProbeHost: "127.0.0.1",
    password: "secret-password",
    uiUrl: "http://192.168.86.3",
    username: "admin",
    ...overrides
  }, {source: "spec"})
}

/**
 * @param {import("node:net").Server} server - TCP server.
 * @returns {Promise<void>}
 */
async function listenOnLocalhost(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen({host: "127.0.0.1", port: 0}, () => {
      resolve(undefined)
    })
  })
}

/**
 * @param {import("node:net").Server} server - TCP server.
 * @returns {number} Bound port.
 */
function serverPort(server) {
  const address = server.address()

  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server to listen on a local port")
  }

  return address.port
}

/**
 * @param {import("node:net").Server} server - TCP server.
 * @returns {Promise<void>}
 */
async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve(undefined)
      }
    })
  })
}
