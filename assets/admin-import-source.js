// Browser-local CSV source persistence for the Lesson Release Import page.
// File System Access handles are stored in IndexedDB so Chrome/Edge can reopen
// a previously authorised folder without the user browsing to the CSV each time.

const DB_NAME = 'fpt-admin-import';
const DB_VERSION = 1;
const STORE_NAME = 'settings';
const SOURCE_KEY = 'csvSourceDirectory';
const DEFAULT_CSV_NAME = 'workFP.csv';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open browser storage.'));
  });
}

async function dbGet(key) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Could not read browser storage.'));
    });
  } finally {
    db.close();
  }
}

async function dbSet(key, value) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save browser storage.'));
      tx.onabort = () => reject(tx.error || new Error('Could not save browser storage.'));
    });
  } finally {
    db.close();
  }
}

async function dbDelete(key) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not clear browser storage.'));
      tx.onabort = () => reject(tx.error || new Error('Could not clear browser storage.'));
    });
  } finally {
    db.close();
  }
}

function supported() {
  return Boolean(window.showDirectoryPicker && window.indexedDB);
}

async function permission(handle, request = false) {
  if (!handle) return false;
  const options = { mode:'read' };
  if (typeof handle.queryPermission === 'function') {
    const current = await handle.queryPermission(options);
    if (current === 'granted') return true;
  }
  if (request && typeof handle.requestPermission === 'function') {
    return (await handle.requestPermission(options)) === 'granted';
  }
  return false;
}

async function chooseDirectory() {
  if (!supported()) throw new Error('Folder access is not supported by this browser. Use the manual CSV chooser instead.');
  const handle = await window.showDirectoryPicker({ mode:'read', id:'fpt-lesson-release-csv-source' });
  await dbSet(SOURCE_KEY, handle);
  return handle;
}

async function getSavedDirectory() {
  if (!supported()) return null;
  try { return await dbGet(SOURCE_KEY); }
  catch { return null; }
}

async function clearSavedDirectory() {
  if (!supported()) return;
  await dbDelete(SOURCE_KEY);
}

async function findCsvFile(directoryHandle) {
  // The workbook's authoritative export name is workFP.csv. Reading it through
  // the directory each time means replacing/recreating that file does not break
  // the saved source. A numbered workFP(n).csv fallback is supported for safety.
  try {
    return await directoryHandle.getFileHandle(DEFAULT_CSV_NAME, { create:false });
  } catch (error) {
    if (error?.name !== 'NotFoundError') throw error;
  }

  const matches = [];
  for await (const entry of directoryHandle.values()) {
    if (entry.kind !== 'file' || !/^workFP(?:\(\d+\))?\.csv$/i.test(entry.name)) continue;
    try {
      const file = await entry.getFile();
      matches.push({ entry, file });
    } catch { /* ignore a transient unreadable file */ }
  }
  matches.sort((a,b) => Number(b.file.lastModified || 0) - Number(a.file.lastModified || 0));
  if (!matches.length) throw new Error('No workFP.csv file was found in the selected folder.');
  return matches[0].entry;
}

async function readLatestCsv(directoryHandle, requestPermission = true) {
  if (!(await permission(directoryHandle, requestPermission))) {
    throw new Error('Chrome needs permission to read the saved CSV folder.');
  }
  const fileHandle = await findCsvFile(directoryHandle);
  const file = await fileHandle.getFile();
  return {
    name:file.name,
    text:await file.text(),
    lastModified:file.lastModified || 0,
    directoryName:directoryHandle.name || 'Selected folder'
  };
}

window.FPTAdminCsvSource = {
  supported,
  chooseDirectory,
  getSavedDirectory,
  clearSavedDirectory,
  permission,
  readLatestCsv,
  DEFAULT_CSV_NAME
};
