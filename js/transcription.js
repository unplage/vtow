let worker = null;
let workerReady = false;
let currentModel = null;
let msgId = 0;
let loadFailed = false;

export function initWorker() {
  if (worker) return;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (e) => {
    const msg = e.data;
    switch (msg.type) {
      case 'loaded':
        workerReady = true;
        document.dispatchEvent(new CustomEvent('model:loaded'));
        break;
      case 'model-ready':
        document.dispatchEvent(new CustomEvent('model:ready', { detail: { progress: 100 } }));
        break;
      case 'model-progress':
        document.dispatchEvent(new CustomEvent('model:progress', {
          detail: { loaded: msg.loaded, total: msg.total }
        }));
        break;
      case 'stream-token':
        document.dispatchEvent(new CustomEvent('transcribe:token', { detail: { token: msg.token } }));
        break;
      case 'result':
        document.dispatchEvent(new CustomEvent('transcribe:result', {
          detail: { text: msg.text, chunks: msg.chunks, id: msg.id }
        }));
        break;
      case 'error':
        if (!msg.id) loadFailed = true;
        document.dispatchEvent(new CustomEvent(msg.id ? 'transcribe:error' : 'model:error', {
          detail: { message: msg.message, id: msg.id }
        }));
        break;
      case 'model-set':
        document.dispatchEvent(new CustomEvent('model:changed', { detail: { modelId: msg.modelId } }));
        break;
    }
  });
  worker.addEventListener('error', (err) => {
    console.error('Worker error:', err);
    document.dispatchEvent(new CustomEvent('transcribe:error', { detail: { message: err.message } }));
  });
}

export function loadModel(modelId) {
  if (!worker) initWorker();
  currentModel = modelId;
  workerReady = false;
  loadFailed = false;
  worker.postMessage({ type: 'load', modelId });
}

export function isLoadFailed() {
  return loadFailed;
}

export function transcribe(audioData, language, options = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const onResult = (e) => {
      if (e.detail.id === id) {
        document.removeEventListener('transcribe:result', onResult);
        document.removeEventListener('transcribe:error', onError);
        resolve({ text: e.detail.text, chunks: e.detail.chunks });
      }
    };
    const onError = (e) => {
      if (e.detail.id === id) {
        document.removeEventListener('transcribe:result', onResult);
        document.removeEventListener('transcribe:error', onError);
        reject(new Error(e.detail.message));
      }
    };
    document.addEventListener('transcribe:result', onResult);
    document.addEventListener('transcribe:error', onError);
    worker.postMessage({ type: 'transcribe', audioData, language, id });
  });
}

export function setModel(modelId) {
  currentModel = modelId;
  loadModel(modelId);
}

export function isReady() {
  return workerReady;
}

export function getCurrentModel() {
  return currentModel;
}