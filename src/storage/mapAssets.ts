export const MAP_DATABASE = 'dnd.local-maps'
export const MAP_STORE = 'assets'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MAP_DATABASE, 1)
    let settled = false
    const fail = () => { settled = true; clearTimeout(timer); reject(new Error('No se pudo abrir el almacenamiento de mapas. Comprueba permisos y espacio disponible.')) }
    const timer = setTimeout(fail, 10_000)
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return }
      request.result.createObjectStore(MAP_STORE)
    }
    request.onblocked = fail
    request.onerror = event => { event.preventDefault(); fail() }
    request.onsuccess = () => {
      clearTimeout(timer)
      const db = request.result
      db.onversionchange = () => db.close()
      if (settled) db.close()
      else { settled = true; resolve(db) }
    }
  })
}

async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(MAP_STORE, mode)
      let result: T
      const timer = setTimeout(() => { tx.abort() }, 10_000)
      tx.oncomplete = () => { clearTimeout(timer); resolve(result) }
      tx.onabort = () => { clearTimeout(timer); reject(new Error('No se pudo guardar o borrar el mapa. Comprueba permisos y espacio disponible.')) }
      tx.onerror = event => { event.preventDefault(); tx.abort() }
      try {
        const request = operation(tx.objectStore(MAP_STORE))
        request.onsuccess = () => { result = request.result }
      } catch {
        tx.abort()
      }
    })
  } finally { db.close() }
}

export async function readMap(id: string): Promise<Blob | null> {
  const result: unknown = await transact('readonly', store => store.get(id))
  return result instanceof Blob ? result : null
}
export async function storeMap(id: string, blob: Blob): Promise<void> { await transact('readwrite', store => store.put(blob, id)) }
export async function deleteMap(id: string): Promise<void> { await transact('readwrite', store => store.delete(id)) }
export async function clearMaps(): Promise<void> { await transact('readwrite', store => store.clear()) }
