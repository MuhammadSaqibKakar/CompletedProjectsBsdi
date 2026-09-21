import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let storage
let appHandler
let startupStage = 'module loading'
const bootstrap = express()
bootstrap.use((req, res) => {
  if (appHandler) return appHandler(req, res)
  res.set('Cache-Control', 'no-store').status(503).type('text/plain').send('Portal starting. Please retry shortly.')
})
// Hostinger requires listen() before asynchronous storage and database setup.
const port = Number(process.env.PORT || 4174)
const server = bootstrap.listen(port, '0.0.0.0', () => {
  console.log(`Completed Projects district portal listener ready on 0.0.0.0:${port}.`)
})

async function start() {
  console.log('Portal startup stage: loading modules.')
  const [{ createPortalStorage }, { createApp }, { deriveHostingerDataDir, prepareProductionDataDir }] = await Promise.all([
    import('./portal-storage.js'),
    import('./app.js'),
    import('./persistent-data-dir.js'),
  ])
  startupStage = 'storage configuration'
  console.log('Portal startup stage: storage configuration.')
  const configuredDataDir = process.env.BSDI_DATA_DIR
  let dataDir = path.resolve(configuredDataDir || path.join(rootDir, 'server-data'))
  let fileStorageSource = 'local'
  let fileStorageIssue = ''
  storage = createPortalStorage({ dataDir })
  const production = process.env.NODE_ENV === 'production' || storage.mode === 'mysql' || /^(1|true|required)$/i.test(process.env.BSDI_REQUIRE_MYSQL || '')
  if (production) {
    startupStage = 'persistent storage preparation'
    const hostingerDataDir = deriveHostingerDataDir(rootDir)
    if (hostingerDataDir) {
      // Hostinger's deployment filesystem can block on realpath/fsync probes long
      // enough for its supervisor to kill an otherwise healthy web process. The
      // directory is deterministically derived outside hbuilds/nodejs; createApp
      // performs the concrete directory checks before serving presentation files.
      dataDir = hostingerDataDir
      fileStorageSource = 'hostinger'
      console.warn('Using durable Hostinger presentation storage outside deployment directories.')
    } else {
      const prepared = await prepareProductionDataDir({ configuredPath: configuredDataDir, deploymentRoot: rootDir })
      dataDir = prepared.dataDir
      fileStorageSource = prepared.source
    }
    storage = createPortalStorage({ dataDir })
  }
  startupStage = 'database initialization'
  console.log('Portal startup stage: database initialization.')
  await storage.initialize()
  startupStage = 'application initialization'
  console.log('Portal startup stage: application initialization.')
  appHandler = await createApp({ rootDir, dataDir, storage, fileStorageSource, fileStorageIssue })
  startupStage = 'ready'
  console.log('Completed Projects district portal ready; storage=' + storage.mode)
}
function stop() {
  server.close(async () => {
    await storage?.close().catch(() => {})
    process.exit(0)
  })
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
// Some hosting launchers require the entry module synchronously.
start().catch(async () => {
  console.error(`Portal startup failed during ${startupStage}.`)
  await storage?.close().catch(() => {})
})
