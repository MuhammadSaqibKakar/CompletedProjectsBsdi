import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPortalStorage } from './portal-storage.js'
import { createApp } from './app.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.resolve(process.env.BSDI_DATA_DIR || path.join(rootDir, 'server-data'))
const storage = createPortalStorage({ dataDir })

async function start() {
  const relativeDataPath = path.relative(rootDir, dataDir)
  if (storage.mode === 'mysql' && (!process.env.BSDI_DATA_DIR ||
      (!relativeDataPath.startsWith(`..${path.sep}`) && relativeDataPath !== '..' && !path.isAbsolute(relativeDataPath)))) {
    throw new Error('Production presentation storage must be configured outside the deployment directory.')
  }
  await storage.initialize()
  const app = await createApp({ rootDir, dataDir, storage })
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
  await storage.close().catch(() => {})
  process.exitCode = 1
})
