import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './clay.css'
import App from './App.jsx'

const legacyStorageKeys = new Set([
  'bsdi-dashboard-state-v1',
  'bsdi-dashboard-pending-sync-v1',
  'bsdi-dashboard-last-sync-v1',
  'bsdi-dashboard-projects-v6',
  'bsdi-dashboard-projects-v5',
])
const legacyScope = new URL('/', window.location.origin).href
const legacyCacheNames = new Set([
  'bsdi-media',
  'bsdi-data',
  `workbox-precache-v2-${legacyScope}`,
])

async function clearLegacyBrowserData() {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (legacyStorageKeys.has(key) || key?.startsWith('bsdi-dashboard-conflict-backup-')) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // Storage access can be disabled by the browser.
  }

  const cleanupTasks = []
  if ('indexedDB' in window) {
    cleanupTasks.push(new Promise((resolve) => {
      try {
        const request = window.indexedDB.deleteDatabase('bsdi-dashboard-media')
        request.onsuccess = resolve
        request.onerror = resolve
        // An older open tab may hold a connection until it reloads.
        request.onblocked = resolve
      } catch {
        resolve()
      }
    }))
  }
  if ('caches' in window) {
    cleanupTasks.push(caches.keys().then((names) => Promise.all(
      names.filter((name) => legacyCacheNames.has(name)).map((name) => caches.delete(name)),
    )))
  }
  if ('serviceWorker' in navigator) {
    cleanupTasks.push(navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(
      registrations.filter((registration) => {
        if (registration.scope !== legacyScope) return false
        return [registration.active, registration.waiting, registration.installing].some((worker) => (
          worker && new URL(worker.scriptURL).origin === window.location.origin &&
          new URL(worker.scriptURL).pathname === '/sw.js'
        ))
      }).map((registration) => registration.unregister()),
    )))
  }
  await Promise.allSettled(cleanupTasks)
}

void clearLegacyBrowserData()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
