import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPortalStorage } from './portal-storage.js'
import { createApp } from './app.js'
import { prepareProductionDataDir } from './persistent-data-dir.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let storage

async function start() {
  const configuredDataDir = process.env.BSDI_DATA_DIR
  let dataDir = path.resolve(configuredDataDir || path.join(rootDir, 'server-data'))
  let fileStorageSource = 'local'
  storage = createPortalStorage({ dataDir })
  const production = process.env.NODE_ENV === 'production' || storage.mode === 'mysql' || /^(1|true|required)$/i.test(process.env.BSDI_REQUIRE_MYSQL || '')
  if (production) {
    const prepared = await prepareProductionDataDir({ configuredPath: configuredDataDir, deploymentRoot: rootDir })
    dataDir = prepared.dataDir
    fileStorageSource = prepared.source
    if (prepared.source === 'hostinger') {
      console.warn('Using durable Hostinger presentation storage outside deployment directories.')
    }
    storage = createPortalStorage({ dataDir })
  }
  await storage.initialize()
  const app = await createApp({ rootDir, dataDir, storage, fileStorageSource })
  const server = app.listen(Number(process.env.PORT || 4174), () => {
    console.log('Completed Projects district portal ready; storage=' + storage.mode)
  })
  function stop() {
    server.close(async () => {
      await storage.close()
      process.exit(0)
    })
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}
// Some hosting launchers require the entry module synchronously.
start().catch(async () => {
  console.error('Portal startup failed. Check the database and persistent storage configuration.')
  await storage?.close().catch(() => {})
  process.exitCode = 1
})
