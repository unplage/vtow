const DB_NAME = 'VoiceTranscriptDB_v2';
const STORE_NAME = 'recordings';
const DB_VERSION = 2;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(new Error('数据库打开失败'));
    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        const s = d.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        s.createIndex('timestamp', 'timestamp', { unique: false });
        s.createIndex('language', 'language', { unique: false });
        s.createIndex('source', 'source', { unique: false });
      }
    };
  });
}

export async function addRecording({ audioBlob, transcript, language, source, segments, model }) {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const entry = {
      timestamp: Date.now(),
      audioBlob,
      transcript: transcript || ' ',
      language: language || 'zh-CN',
      source: source || 'mic',
      model: model || 'whisper-base',
      segments: (segments || []).map(s => ({
        start: s.start, end: s.end, text: s.text
      }))
    };
    const req = store.add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = reject;
  });
}

export async function updateRecording(id, updates) {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result;
      Object.assign(entry, updates);
      store.put(entry);
      resolve();
    };
    getReq.onerror = reject;
  });
}

export async function getAllRecordings() {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = reject;
  });
}

export async function searchRecordings({ query, language, source, startDate, endDate } = {}) {
  const all = await getAllRecordings();
  return all.filter(r => {
    if (query) {
      const q = query.toLowerCase();
      const textMatch = (r.transcript || '').toLowerCase().includes(q);
      const segMatch = (r.segments || []).some(s => (s.text || '').toLowerCase().includes(q));
      if (!textMatch && !segMatch) return false;
    }
    if (language && r.language !== language) return false;
    if (source && r.source !== source) return false;
    if (startDate && r.timestamp < startDate) return false;
    if (endDate && r.timestamp > endDate) return false;
    return true;
  }).sort((a, b) => b.timestamp - a.timestamp);
}

export async function deleteRecording(id) {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = reject;
  });
}

export async function getRecording(id) {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = reject;
  });
}

export async function deleteAllRecordings() {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = reject;
  });
}