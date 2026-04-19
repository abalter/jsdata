// ── IndexedDB workspace persistence ──────────────────────────────────────────
// Schema: one object store 'workspace', key 'workspaceState'
// Value: { files: [...], activeFileId: string, version: 1 }

const DB_NAME    = 'jsanalyst'
const DB_VERSION = 1
const STORE      = 'workspace'
const STATE_KEY  = 'workspaceState'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess  = (e) => resolve(e.target.result)
    req.onerror    = (e) => reject(e.target.error)
  })
}

export async function loadWorkspace() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(STATE_KEY)
    req.onsuccess = (e) => resolve(e.target.result ?? null)
    req.onerror   = (e) => reject(e.target.error)
  })
}

export async function saveWorkspace(state) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite')
    const req = tx.objectStore(STORE).put(state, STATE_KEY)
    req.onsuccess = () => resolve()
    req.onerror   = (e) => reject(e.target.error)
  })
}
