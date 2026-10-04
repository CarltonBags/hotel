/**
 * What the phone keeps (ticket 35): the day's tasks and the changes waiting
 * to send, in IndexedDB, encrypted with a key the browser cannot hand out
 * (AES-GCM, non-extractable). A revoked Device wipes it all. Client only.
 */
const DB = "hs-floor";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("keys");
      req.result.createObjectStore("data");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(store: "keys" | "data", mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

let keyPromise: Promise<CryptoKey> | null = null;
function key(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const found = await request<CryptoKey | undefined>("keys", "readonly", (s) => s.get("main"));
    if (found) return found;
    const made = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await request("keys", "readwrite", (s) => s.put(made, "main"));
    return made;
  })();
  return keyPromise;
}

export async function save(name: string, value: unknown): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(JSON.stringify(value)));
  await request("data", "readwrite", (s) => s.put({ iv, data }, name));
}

export async function load<T>(name: string): Promise<T | null> {
  try {
    const row = await request<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer } | undefined>("data", "readonly", (s) => s.get(name));
    if (!row) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv }, await key(), row.data);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}
