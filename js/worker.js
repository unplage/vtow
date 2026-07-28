const __originalFetch = globalThis.fetch;

let _cacheDb = null;
let _cacheDbReady = false;
const _cacheQueue = [];

function _initCacheDb() {
  if (_cacheDbReady) return Promise.resolve();
  if (_cacheQueue.length > 0) {
    return new Promise((resolve) => _cacheQueue.push(resolve));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('vtw-model-cache', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'url' });
      }
    };
    req.onsuccess = (e) => {
      _cacheDb = e.target.result;
      _cacheDbReady = true;
      const q = _cacheQueue.splice(0);
      q.forEach(fn => fn());
      resolve();
    };
    req.onerror = () => {
      _cacheDbReady = true;
      const q = _cacheQueue.splice(0);
      q.forEach(fn => fn());
      reject(new Error('无法打开模型缓存'));
    };
  });
}

async function _cacheGet(url) {
  try {
    await _initCacheDb();
    return new Promise((resolve) => {
      const tx = _cacheDb.transaction('files', 'readonly');
      const req = tx.objectStore('files').get(url);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function _cachePut(url, data, totalSize, complete) {
  try {
    await _initCacheDb();
    return new Promise((resolve, reject) => {
      const tx = _cacheDb.transaction('files', 'readwrite');
      tx.objectStore('files').put({
        url,
        data,
        size: data.byteLength,
        totalSize: totalSize || data.byteLength,
        complete: !!complete,
        downloadedAt: Date.now()
      });
      tx.oncomplete = resolve;
      tx.onerror = (e) => reject(e.target.error);
    });
  } catch { /* silent */ }
}

function _mimeFromUrl(url) {
  if (url.endsWith('.json')) return 'application/json';
  if (url.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

globalThis.fetch = async function (input, init) {
  const urlStr = (typeof input === 'string' ? input : (input instanceof Request ? input.url : null));
  if (!urlStr || (!urlStr.includes('huggingface.co') && !urlStr.endsWith('.onnx'))) {
    return __originalFetch(input, init);
  }

  try {
    const cached = await _cacheGet(urlStr);
    if (cached && cached.complete && cached.data && cached.data.byteLength > 0) {
      self.postMessage({ type: 'download-progress', url: urlStr, loaded: cached.data.byteLength, total: cached.data.byteLength });
      return new Response(cached.data, {
        status: 200,
        headers: { 'Content-Type': _mimeFromUrl(urlStr), 'Content-Length': String(cached.data.byteLength) }
      });
    }

    const startByte = (cached && cached.data) ? cached.data.byteLength : 0;
    const fetchOpts = { ...(init || {}) };
    if (startByte > 0) {
      fetchOpts.headers = { ...(fetchOpts.headers || {}), 'Range': `bytes=${startByte}-` };
    }

    const response = await __originalFetch(input, fetchOpts);
    if (response.status === 404) return response;

    const totalSize = (() => {
      if (cached && cached.totalSize) return cached.totalSize;
      const cl = parseInt(response.headers.get('Content-Length') || '0');
      return startByte + cl || 0;
    })();

    if (startByte > 0 && response.status === 206) {
      const newData = await response.arrayBuffer();
      const combined = new Uint8Array(startByte + newData.byteLength);
      combined.set(new Uint8Array(cached.data), 0);
      combined.set(new Uint8Array(newData), startByte);
      const full = combined.buffer;
      await _cachePut(urlStr, full, totalSize, true);
      self.postMessage({ type: 'download-progress', url: urlStr, loaded: totalSize, total: totalSize });
      return new Response(full, {
        status: 200,
        headers: { 'Content-Type': _mimeFromUrl(urlStr), 'Content-Length': String(full.byteLength) }
      });
    }

    const reader = response.body.getReader();
    const parts = [];
    let loaded = 0;
    let lastSave = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.byteLength;
      self.postMessage({ type: 'download-progress', url: urlStr, loaded: startByte + loaded, total: totalSize });

      if (loaded - lastSave > 5 * 1024 * 1024) {
        const partial = new Blob(parts);
        const buf = await partial.arrayBuffer();
        await _cachePut(urlStr, buf, totalSize, false);
        lastSave = loaded;
      }
    }

    const blob = new Blob(parts);
    const fullBuf = await blob.arrayBuffer();
    await _cachePut(urlStr, fullBuf, totalSize, true);
    self.postMessage({ type: 'download-progress', url: urlStr, loaded: totalSize, total: totalSize });

    return new Response(fullBuf, {
      status: 200,
      headers: { 'Content-Type': _mimeFromUrl(urlStr), 'Content-Length': String(fullBuf.byteLength) }
    });
  } catch (err) {
    return __originalFetch(input, init);
  }
};

let createPipeline = null;
let env = null;
let modelId = 'Xenova/whisper-base';
let asrPipeline = null;
let _loadToken = 0;

const CDN_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/+esm';
const CDN_FALLBACK = 'https://unpkg.com/@huggingface/transformers@3.7.5/+esm';
const ORT_WASM_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/';
const ORT_WASM_FALLBACK = 'https://unpkg.com/onnxruntime-web@1.17.3/dist/';

async function loadLibrary() {
  try {
    const mod = await import(CDN_URL);
    createPipeline = mod.pipeline;
    env = mod.env;
  } catch (e) {
    const mod = await import(CDN_FALLBACK);
    createPipeline = mod.pipeline;
    env = mod.env;
  }
}

function isDownloadable(id) {
  return id.includes('whisper-small') || id.includes('large-v3-turbo');
}

function configureEnv() {
  const downloadable = isDownloadable(modelId);
  env.allowRemoteModels = downloadable;
  env.allowLocalModels = !downloadable;
  if (!downloadable) {
    const modelsDir = self.location.pathname.replace(/\/js\/[^/]+$/, '/models/');
    env.localModelPath = modelsDir;
  }
  env.backends = {
    onnx: {
      wasm: {
        wasmPaths: ORT_WASM_CDN
      }
    }
  };
}

async function loadModel() {
  await loadLibrary();
  configureEnv();
  const downloadable = isDownloadable(modelId);
  const opts = {
    quantized: true,
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        self.postMessage({ type: 'model-progress', loaded: p.loaded, total: p.total });
      } else if (p.status === 'done') {
        self.postMessage({ type: 'model-ready' });
      }
    }
  };
  if (!downloadable) opts.local_files_only = true;
  try {
    asrPipeline = await createPipeline('automatic-speech-recognition', modelId, opts);
  } catch (e) {
    if (ORT_WASM_CDN) {
      env.backends = { onnx: { wasm: { wasmPaths: ORT_WASM_FALLBACK } } };
      asrPipeline = await createPipeline('automatic-speech-recognition', modelId, opts);
    } else {
      throw e;
    }
  }
  return asrPipeline;
}

async function transcribeAudio(audioData, language) {
  const lang = language === 'auto' ? null : language === 'zh-CN' ? 'zh' : language === 'en-US' ? 'en' : null;
  const result = await asrPipeline(audioData, {
    language: lang,
    task: 'transcribe',
    return_timestamps: true,
  });
  return result;
}

async function getCachedFiles(modelId) {
  await _initCacheDb();
  return new Promise((resolve) => {
    const tx = _cacheDb.transaction('files', 'readonly');
    const req = tx.objectStore('files').getAll();
    req.onsuccess = () => {
      const files = req.result || [];
      resolve(files.filter(f => f.url.includes(modelId)).map(f => ({
        url: f.url,
        size: f.size,
        complete: f.complete
      })));
    };
    req.onerror = () => resolve([]);
  });
}

async function deleteCachedModel(modelId) {
  const files = await getCachedFiles(modelId);
  await _initCacheDb();
  return new Promise((resolve) => {
    const tx = _cacheDb.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    files.forEach(f => store.delete(f.url));
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

self.addEventListener('message', async (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'load':
      modelId = msg.modelId || modelId;
      const token = ++_loadToken;
      try {
        await loadModel();
        if (_loadToken !== token) return;
        self.postMessage({ type: 'loaded' });
      } catch (err) {
        if (_loadToken !== token) return;
        self.postMessage({ type: 'error', message: err.message });
      }
      break;

    case 'transcribe':
      try {
        const result = await transcribeAudio(msg.audioData, msg.language);
        self.postMessage({
          type: 'result',
          text: result.text,
          chunks: (result.chunks || []).map(c => ({
            start: c.timestamp[0],
            end: c.timestamp[1],
            text: c.text
          })),
          id: msg.id
        });
      } catch (err) {
        self.postMessage({ type: 'error', message: err.message, id: msg.id });
      }
      break;

    case 'set-model':
      modelId = msg.modelId;
      self.postMessage({ type: 'model-set', modelId });
      break;

    case 'get-model-status':
      const files = await getCachedFiles(modelId);
      const total = files.reduce((s, f) => s + (f.size || 0), 0);
      const complete = files.every(f => f.complete);
      self.postMessage({ type: 'model-status', modelId, cached: files.length > 0, complete, totalBytes: total, files });
      break;

    case 'clear-model-cache':
      await deleteCachedModel(msg.modelId || modelId);
      self.postMessage({ type: 'model-cache-cleared', modelId: msg.modelId || modelId });
      break;
  }
});
