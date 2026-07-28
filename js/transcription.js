import { WorkerPool } from './pool.js';

let pool = null;
let workerReady = false;
let currentModel = null;
let loadFailed = false;
let _workerCount = 1;

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

function detectWorkerCount() {
  const cores = navigator.hardwareConcurrency || 2;
  const mem = navigator.deviceMemory;
  if (mem !== undefined) {
    if (mem < 2) return 1;
    if (mem < 4) return Math.min(2, cores - 1, 2);
    return Math.min(cores - 1, Math.floor(mem / 2), 4);
  }
  return Math.min(cores - 1, 2);
}

export function getWorkerCount() {
  return _workerCount;
}

export function initWorker() {}

export function loadModel(modelId) {
  if (pool) { pool.destroy(); pool = null; }
  _workerCount = detectWorkerCount();
  currentModel = modelId;
  workerReady = false;
  loadFailed = false;
  pool = new WorkerPool(_workerCount, modelId);

  pool.loadModel(modelId).then(() => {
    workerReady = true;
    document.dispatchEvent(new CustomEvent('model:loaded'));
  }).catch((err) => {
    loadFailed = true;
    document.dispatchEvent(new CustomEvent('model:error', {
      detail: { message: err.message || '模型加载失败' }
    }));
  });
}

export function isLoadFailed() {
  return loadFailed;
}

export async function transcribe(audioData, language) {
  if (!pool) throw new Error('模型未加载');
  return pool.transcribe(audioData, language);
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
  if (!pool || !pool.workers.length) return;
  pool.workers[0].postMessage({ type: 'get-model-status', modelId });
}

export function clearModelCache(modelId) {
  if (!pool || !pool.workers.length) return;
  pool.workers[0].postMessage({ type: 'clear-model-cache', modelId });
}
