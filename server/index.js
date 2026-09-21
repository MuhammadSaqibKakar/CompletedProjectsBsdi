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
const server = bootstrap.listen(Number(process.env.PORT || 4174), () => {
  console.log('Completed Projects district portal listener ready.')
})

async function start() {
  const [{ createPortalStorage }, { createApp }, { deriveHostingerDataDir, prepareProductionDataDir }] = await Promise.all([
    import('./portal-storage.js'),
    import('./app.js'),
    import('./persistent-data-dir.js'),
  ])
  startupStage = 'storage configuration'
  const configuredDataDir = process.env.BSDI_DATA_DIR
  let dataDir = path.resolve(configuredDataDir || path.join(rootDir, 'server-data'))
  let fileStorageSource = 'local'
  let fileStorageIssue = ''
  storage = createPortalStorage({ dataDir })
  const production = process.env.NODE_ENV === 'production' || storage.mode === 'mysql' || /^(1|true|required)$/i.test(process.env.BSDI_REQUIRE_MYSQL || '')
  if (production) {
    startupStage = 'persistent storage preparation'
    try {
      const prepared = await prepareProductionDataDir({ configuredPath: configuredDataDir, deploymentRoot: rootDir })
      dataDir = prepared.dataDir
      fileStorageSource = prepared.source
      if (prepared.source === 'hostinger') {
        console.warn('Using durable Hostinger presentation storage outside deployment directories.')
      }
    } catch (error) {
      const legacyPath = typeof configuredDataDir === 'string' && path.isAbsolute(configuredDataDir)
      if (!deriveHostingerDataDir(rootDir) || !legacyPath) throw error
      dataDir = path.resolve(configuredDataDir)
      fileStorageSource = 'configured-fallback'
      fileStorageIssue = error.message
      console.error('Durable Hostinger presentation storage is unavailable; using the prior configured location temporarily.')
    }
    storage = createPortalStorage({ dataDir })
  }
  startupStage = 'database initialization'
  await storage.initialize()
  startupStage = 'application initialization'
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
