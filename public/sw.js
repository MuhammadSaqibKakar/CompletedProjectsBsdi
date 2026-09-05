// Retire the previous offline dashboard when an existing installation checks for updates.
// Keep this file at the old worker URL so returning visitors receive the cleanup.
const legacyCacheNames = new Set([
  'bsdi-media',
  'bsdi-data',
  `workbox-precache-v2-${self.registration.scope}`,
])

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys()
      await Promise.allSettled(names.filter((name) => legacyCacheNames.has(name)).map((name) => caches.delete(name)))
    } catch {
      // Continue retiring the worker if cache storage is unavailable.
    }
    await self.clients.claim()
    await self.registration.unregister()
    const windows = await self.clients.matchAll({ type: 'window' })
    await Promise.allSettled(windows.filter((client) => (
      new URL(client.url).origin === self.location.origin
    )).map((client) => client.navigate(client.url)))
  })())
})
