// @ts-check

import {fileURLToPath} from "node:url"

import Configuration from "velocious/build/src/configuration.js"
import NodeEnvironmentHandler from "velocious/build/src/environment-handlers/node.js"
import SingleMultiUsePool from "velocious/build/src/database/pool/single-multi-use.js"
import SqliteDriver from "velocious/build/src/database/drivers/sqlite/index.web.js"

const directory = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "")
const inertConnection = {
  close: async () => {},
  query: async () => []
}

/** @type {Record<string, import("velocious/build/src/configuration-types.js").DatabaseConfigurationType>} */
const inMemorySqlite = {
  default: {
    driver: SqliteDriver,
    getConnection: () => inertConnection,
    migrations: false,
    name: "zyxel-nr5101-watchdog-test",
    poolType: SingleMultiUsePool,
    type: "sqlite"
  }
}

export default new Configuration({
  database: {
    development: inMemorySqlite,
    production: inMemorySqlite,
    test: inMemorySqlite
  },
  directory,
  environment: "test",
  environmentHandler: new NodeEnvironmentHandler(),
  initializeModels: async () => {},
  locale: () => "en",
  localeFallbacks: {en: ["en"]},
  locales: ["en"]
})
