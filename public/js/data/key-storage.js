// "Keep unlocked on this device": the data key stored in IndexedDB. The key is non-extractable,
// so its bytes can't be read back out, only used by this origin. It is deleted on logout, when
// the session ends, and when the option is switched off.

const DATABASE = 'silva-mentis';
const STORE = 'keys';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/**
 * @param {string} name e.g. "data-key:normal"
 * @param {CryptoKey} key
 */
export async function storeKey(name, key) {
  await run('readwrite', (store) => store.put(key, name));
}

/** @returns {Promise<CryptoKey|null>} */
export async function loadKey(name) {
  try {
    return (await run('readonly', (store) => store.get(name))) ?? null;
  } catch {
    return null; // private windows may have no IndexedDB
  }
}

export async function deleteKey(name) {
  try {
    await run('readwrite', (store) => store.delete(name));
  } catch {
    // nothing stored, nothing to delete
  }
}
