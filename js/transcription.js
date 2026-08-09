import { transcribeCloud } from './cloud.js';

let worker = null;
let workerReady = false;
let currentModel = null;
let msgId = 0;
let loadFailed = false;

const MODEL_DOWNLOAD_SIZES = {
  'Xenova/whisper-small': '~250MB',
  'Xenova/whisper-large-v3-turbo': '~800MB'
};

const IS_DOWNLOADABLE = (id) =>
  id.includes('whisper-small') || id.includes('large-v3-turbo');

export function getDownloadSize(modelId) {
  return MODEL_DOWNLOAD_SIZES[modelId] || '';
}

export function isDownloadableModel(modelId) {
  return IS_DOWNLOADABLE(modelId);
}

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
      case 'download-progress':
        document.dispatchEvent(new CustomEvent('model:download-progress', {
          detail: { url: msg.url, loaded: msg.loaded, total: msg.total }
        }));
        break;
      case 'model-status':
        document.dispatchEvent(new CustomEvent('model:status', {
          detail: {
            modelId: msg.modelId,
            cached: msg.cached,
            complete: msg.complete,
            totalBytes: msg.totalBytes,
            files: msg.files
          }
        }));
        break;
      case 'model-cache-cleared':
        document.dispatchEvent(new CustomEvent('model:cache-cleared', {
          detail: { modelId: msg.modelId }
        }));
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
  if (options.cloudMode) {
    return transcribeCloud(audioData, language, {
      apiKey: options.apiKey,
      apiBase: options.apiBase,
      model: options.model,
      apiType: options.apiType,
      timeout: options.timeout
    });
  }

  const id = ++msgId;
  const timeout = options.timeout || 30000;

  return new Promise((resolve, reject) => {
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timer);
      document.removeEventListener('transcribe:result', onResult);
      document.removeEventListener('transcribe:error', onError);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('转写超时'));
    }, timeout);

    const onResult = (e) => {
      if (e.detail.id === id) {
        cleanup();
        resolve({ text: e.detail.text, chunks: e.detail.chunks });
      }
    };
    const onError = (e) => {
      if (e.detail.id === id) {
        cleanup();
        reject(new Error(e.detail.message));
      }
    };

    document.addEventListener('transcribe:result', onResult);
    document.addEventListener('transcribe:error', onError);
    worker.postMessage({ type: 'transcribe', audioData, language, id }, [audioData.buffer]);
  });
}

export function abortTranscription(id) {
  if (worker) worker.postMessage({ type: 'cancel', id: id || 0 });
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

export function checkModelCache(modelId) {
  if (!worker) return;
  worker.postMessage({ type: 'get-model-status', modelId });
}

export function clearModelCache(modelId) {
  if (!worker) return;
  worker.postMessage({ type: 'clear-model-cache', modelId });
}
