import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let storage
let startupStage = 'module loading'

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
  const app = await createApp({ rootDir, dataDir, storage, fileStorageSource, fileStorageIssue })
  startupStage = 'ready'
  const port = Number(process.env.PORT || 3000)
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Completed Projects district portal ready on 0.0.0.0:${port}; storage=${storage.mode}`)
  })
  function stop(signal) {
    console.warn(`Completed Projects district portal received ${signal}.`)
    server.close(async () => {
      await storage?.close().catch(() => {})
      process.exit(0)
    })
  }
  process.once('SIGTERM', () => stop('SIGTERM'))
  process.once('SIGINT', () => stop('SIGINT'))
}
// Some hosting launchers require the entry module synchronously.
start().catch(async () => {
  console.error(`Portal startup failed during ${startupStage}.`)
  await storage?.close().catch(() => {})
  process.exitCode = 1
})
