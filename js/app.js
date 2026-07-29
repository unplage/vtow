import { Recorder } from './recorder.js';
import { decodeAudioFile, decodeAudioFileShared, getSharedAudioContext, splitAudioChunks, validateAudioFile } from './uploader.js';
import { initWorker, loadModel, transcribe, isReady, getCurrentModel, isDownloadableModel, getDownloadSize, checkModelCache, clearModelCache, abortTranscription } from './transcription.js';
import { addRecording, getAllRecordings } from './storage.js';
import { initHistory, refreshHistory, filterHistory, exportAll } from './history.js';
import { getString, getLang, setLang, getTheme, setTheme, toggleTheme, initTheme, showToast, formatTime, escapeHtml, onLangChange, MODELS, showConfirmDialog, showDownloadDialog, hideDownloadDialog, updateDownloadProgress } from './ui.js';

const recorder = new Recorder();
let isRecording = false;
let currentLanguage = localStorage.getItem('vtw-lang') || 'auto';
let currentModelId = localStorage.getItem('vtw-model') || 'Xenova/whisper-tiny';
let currentSegments = [];
let chunkTimer = null;
let downloadTotalLoaded = 0;
let downloadTotalSize = 0;
let isTranscribing = false;
let recordingStartTime = 0;
let lastChunkAudioData = null;
let lastChunkEndTime = 0;
const OVERLAP_SEC = 2;
let lastRenderedCount = 0;
let currentMode = localStorage.getItem('vtw-mode') || 'local';
let mimoApiKey = localStorage.getItem('vtw-mimo-key') || '';

function $(id) { return document.getElementById(id); }

function computeRMS(audioData) {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  return Math.sqrt(sum / audioData.length);
}

function initAudioMeter() {
  const meter = $('audioMeter');
  if (!meter) return;
  const BAR_COUNT = 16;
  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = document.createElement('div');
    bar.className = 'audio-bar';
    bar.style.height = '3px';
    meter.appendChild(bar);
  }
}

function init() {
  initTheme();
  if (currentMode === 'local') {
    initWorker();
    loadModel(currentModelId);
  }
  initHistory();
  bindEvents();
  initAudioMeter();
  updateModelStatus();
  updateLangUI();
  updateThemeUI();
  updateModelSelect();
  updateOnlineStatus();
  updateModeUI();
  updateApiKeyUI();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
}

function bindEvents() {
  const startBtn = $('startBtn');
  const stopBtn = $('stopBtn');
  const pauseBtn = $('pauseBtn');
  const uploadArea = $('uploadArea');
  const fileInput = $('fileInput');
  const searchInput = $('searchInput');
  const exportAllBtn = $('exportAllBtn');
  const clearCacheBtn = $('clearCacheBtn');
  const themeToggle = $('themeToggle');
  const saveApiKeyBtn = $('saveApiKeyBtn');
  const apiKeyInput = $('apiKeyInput');
  if (startBtn) startBtn.addEventListener('click', startRecording);
  if (stopBtn) stopBtn.addEventListener('click', stopRecording);
  if (pauseBtn) pauseBtn.addEventListener('click', pauseRecording);
  if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

  document.querySelectorAll('.mode-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode === currentMode) return;
      document.querySelectorAll('.mode-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentMode = mode;
      localStorage.setItem('vtw-mode', currentMode);
      updateModeUI();
      if (currentMode === 'local') {
        if (!isReady()) {
          updateModelStatus('loading');
          loadModel(currentModelId);
        }
      } else if (currentMode === 'cloud' && !mimoApiKey) {
        showToast(getString('apiKeyRequired'));
      }
    });
  });

  if (saveApiKeyBtn && apiKeyInput) {
    saveApiKeyBtn.addEventListener('click', () => {
      const key = apiKeyInput.value.trim();
      if (!key) return;
      mimoApiKey = key;
      localStorage.setItem('vtw-mimo-key', mimoApiKey);
      showToast(getString('apiKeySaved'));
    });
    apiKeyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveApiKeyBtn.click();
    });
  }

  document.querySelectorAll('.lang-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lang-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLanguage = btn.dataset.lang;
      setLang(currentLanguage);
    });
  });

  onLangChange(() => updateLangUI());

  if (uploadArea) {
    uploadArea.addEventListener('click', () => fileInput?.click());
    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFileUpload(e.target.files[0]);
      e.target.value = '';
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterHistory(e.target.value || null, null, null);
    });
  }

  if (exportAllBtn) exportAllBtn.addEventListener('click', () => exportAll('txt'));
  if (clearCacheBtn) clearCacheBtn.addEventListener('click', clearCache);

  document.querySelectorAll('.model-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const modelId = btn.dataset.model;
      if (modelId === currentModelId) return;

      if (modelId === 'mimo-v2.5-asr') {
        if (!mimoApiKey) {
          showToast(getString('apiKeyRequired'));
          return;
        }
        document.querySelectorAll('.model-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentModelId = modelId;
        currentMode = 'cloud';
        localStorage.setItem('vtw-model', currentModelId);
        localStorage.setItem('vtw-mode', currentMode);
        updateModeUI();
        updateModelStatus('ready');
        return;
      }

      if (isDownloadableModel(modelId)) {
        const size = getDownloadSize(modelId);
        const proceed = await showConfirmDialog(
          getString('downloadTitle'),
          getString('downloadConfirm').replace('{size}', size)
        );
        if (!proceed) return;
        showDownloadDialog(
          getString('downloadTitle'),
          `正在下载 ${modelId.replace('Xenova/', '')}...`
        );
      }

      document.querySelectorAll('.model-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentModelId = modelId;
      currentMode = 'local';
      localStorage.setItem('vtw-model', currentModelId);
      localStorage.setItem('vtw-mode', currentMode);
      updateModeUI();
      updateModelStatus('loading');
      loadModel(currentModelId);
    });
  });

  document.addEventListener('keydown', handleKeyboard);

  document.addEventListener('model:loaded', () => {
    hideDownloadDialog();
    updateModelStatus('ready');
  });

  document.addEventListener('model:error', (e) => {
    hideDownloadDialog();
    console.error('Model load error:', e.detail.message);
    showToast(getString('modelLoadFailed'));
    if (currentModelId.includes('large-v3-turbo')) {
      currentModelId = 'Xenova/whisper-small';
      localStorage.setItem('vtw-model', currentModelId);
      updateModelSelect();
      updateModelStatus('loading');
      showToast('Turbo 加载失败，已回退到 Small');
      loadModel(currentModelId);
    } else {
      updateModelStatus('error', e.detail.message);
    }
  });

  document.addEventListener('model:progress', (e) => {
    const { loaded, total } = e.detail;
    const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
    updateModelStatus('loading', pct);
  });

  document.addEventListener('model:download-progress', (e) => {
    const modal = document.getElementById('downloadModal');
    const { loaded, total } = e.detail;
    downloadTotalLoaded = loaded;
    downloadTotalSize = total;
    const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
    if (isDownloadableModel(currentModelId) && modal?.classList.contains('hidden') && loaded < total) {
      showDownloadDialog(getString('downloadTitle'), `${currentModelId.replace('Xenova/', '')} ${getString('downloadProgress')}`);
    }
    updateDownloadProgress(pct, loaded, total);
  });

  document.addEventListener('model:status', (e) => {
    const { cached, complete } = e.detail;
    if (cached && complete) {
      hideDownloadDialog();
    }
  });

}

function handleKeyboard(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.contentEditable === 'true') return;

  if (e.code === 'Space' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (isRecording) stopRecording();
    else startRecording();
  }
  if (e.ctrlKey && e.key === 'e') {
    e.preventDefault();
    exportAll('txt');
  }
  if (e.ctrlKey && e.key === 'f') {
    e.preventDefault();
    const el = $('searchInput');
    if (el) el.focus();
  }
  if (e.ctrlKey && e.key === 't') {
    e.preventDefault();
    toggleTheme();
    updateThemeUI();
  }
}

function updateModelStatus(state, progressOrMsg) {
  const el = $('modelStatus');
  if (!el) return;

  if (currentMode === 'cloud') {
    el.innerHTML = `<span class="model-loading-icon">☁️</span> MiMo Cloud · ${mimoApiKey ? '✅ 已配置' : '❌ 需要 API Key'}`;
    el.className = 'model-status model-ready';
    return;
  }

  const isTurbo = currentModelId.includes('large-v3-turbo');
  const isSmall = currentModelId.includes('whisper-small');
  const isMiMo = currentModelId.includes('mimo-v2.5');
  const note = isTurbo ? ` <span class="model-turbo-note">(${getString('modelTurboNote')})</span>` :
    isSmall ? ` <span class="model-turbo-note">(${getString('modelSmallNote')})</span>` :
    isMiMo ? ` <span class="model-turbo-note">(${getString('modelMiMoNote')})</span>` : '';
  if (state === 'loading') {
    const pct = typeof progressOrMsg === 'number' ? ` ${progressOrMsg}%` : '';
    el.innerHTML = `<span class="model-loading-icon">⏳</span> ${getString('modelLoading')}${pct}...${note}`;
    el.className = 'model-status model-loading';
  } else if (state === 'ready') {
    el.innerHTML = `<span class="model-loading-icon">✅</span> ${getString('modelReady')}${note}`;
    el.className = 'model-status model-ready';
  } else if (state === 'error') {
    el.innerHTML = `<span class="model-loading-icon">❌</span> ${progressOrMsg || '加载失败'}${note}`;
    el.className = 'model-status model-loading';
  } else {
    el.innerHTML = `<span class="model-loading-icon">⚡</span> ${getString('statusLoading')}...${note}`;
    el.className = 'model-status model-loading';
  }
}

function updateLangUI() {
  document.querySelectorAll('.lang-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === currentLanguage);
  });
}

function updateThemeUI() {
  const btn = $('themeToggle');
  if (btn) btn.textContent = getTheme() === 'dark' ? '☀️' : '🌙';
}

function updateModelSelect() {
  document.querySelectorAll('.model-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.model === currentModelId);
  });
}

function updateModeUI() {
  document.querySelectorAll('.mode-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === currentMode);
  });
  const apiKeySection = $('apiKeySection');
  if (apiKeySection) {
    apiKeySection.classList.toggle('hidden', currentMode !== 'cloud');
  }
  updateModelStatus();
}

function updateApiKeyUI() {
  const input = $('apiKeyInput');
  if (input) input.value = mimoApiKey;
}

function updateOnlineStatus() {
  const el = $('onlineStatus');
  if (el) {
    el.textContent = navigator.onLine ? getString('online') : getString('offline');
    el.className = navigator.onLine ? 'online-indicator' : 'online-indicator offline';
  }
}

function isCloudReady() {
  return currentMode === 'cloud' && !!mimoApiKey;
}

async function startRecording() {
  if (isRecording) return;

  if (currentMode === 'local' && !isReady()) {
    showToast('模型尚未就绪，请稍候');
    return;
  }
  if (currentMode === 'cloud' && !isCloudReady()) {
    showToast(getString('apiKeyRequired'));
    return;
  }

  currentSegments = [];

  recorder.onStop = async (blob) => {
    if (currentSegments.length > 0) {
      const fullText = currentSegments.map(s => s.text).join(' ').trim();
      try {
        await addRecording({
          audioBlob: blob,
          transcript: fullText || '（无语音识别文本）',
          language: currentLanguage,
          source: 'mic',
          segments: currentSegments,
          model: currentModelId
        });
        showToast('已保存到历史记录');
        refreshHistory();
      } catch (err) {
        console.error('保存失败:', err);
        showToast('保存失败');
      }
    }
    isRecording = false;
    updateControlUI();
  };

  recorder.onAnalyser = (data) => updateAudioMeter(data);

  try {
    await recorder.start();
    recorder.resetChunkIndex();
    isRecording = true;
    recordingStartTime = Date.now() / 1000;
    lastChunkAudioData = null;
    lastChunkEndTime = 0;
    lastRenderedCount = 0;
    updateControlUI();
    startChunkedTranscription();
  } catch (err) {
    showToast(err.message);
  }
}

function startChunkedTranscription() {
  const CHUNK_MS = 5000;

  chunkTimer = setInterval(async () => {
    if (!isRecording || recorder.isPaused) return;
    if (currentMode === 'local' && !isReady()) return;
    if (currentMode === 'cloud' && !isCloudReady()) return;
    if (isTranscribing) return;

    const blob = recorder.getAndClearNewChunks();
    if (blob.size < 1000) return;

    isTranscribing = true;
    try {
      const { audioData, duration } = await decodeAudioFileShared(blob);

      const rms = computeRMS(audioData);
      if (rms < 0.005) {
        recorder.acknowledgeChunks();
        lastChunkEndTime += duration;
        const keepSamples = OVERLAP_SEC * 16000;
        lastChunkAudioData = audioData.slice(-keepSamples);
        return;
      }

      let audioToTranscribe;
      const overlapSamples = OVERLAP_SEC * 16000;
      if (lastChunkAudioData && lastChunkEndTime > 0) {
        audioToTranscribe = new Float32Array(lastChunkAudioData.length + audioData.length);
        audioToTranscribe.set(lastChunkAudioData, 0);
        audioToTranscribe.set(audioData, lastChunkAudioData.length);
      } else {
        audioToTranscribe = new Float32Array(audioData);
      }

      const keepSamples = OVERLAP_SEC * 16000;
      lastChunkAudioData = audioData.slice(-keepSamples);

      const transcribeOpts = currentMode === 'cloud'
        ? { cloudMode: true, apiKey: mimoApiKey }
        : {};
      const result = await transcribe(audioToTranscribe, currentLanguage, transcribeOpts);

      recorder.acknowledgeChunks();

      const baseTime = lastChunkEndTime > 0
        ? Math.max(0, lastChunkEndTime - OVERLAP_SEC)
        : 0;

      if (result.chunks && result.chunks.length) {
        result.chunks.forEach(c => {
          const start = baseTime + c.start;
          const end = baseTime + c.end;
          const text = c.text.trim();
          if (!text) return;
          if (start < lastChunkEndTime) return;
          const isDupe = currentSegments.some(s => {
            const timeOverlap = Math.min(end, s.end) - Math.max(start, s.start);
            const minDur = Math.min(end - start, s.end - s.start);
            return minDur > 0 && timeOverlap / minDur > 0.5;
          });
          if (!isDupe) {
            currentSegments.push({ start, end, text });
          }
        });
        updateLiveDisplay();
      } else if (result.text && result.text.trim()) {
        const start = lastChunkEndTime;
        const end = lastChunkEndTime + duration;
        currentSegments.push({ start, end, text: result.text.trim() });
        updateLiveDisplay();
      }

      lastChunkEndTime += duration;
    } catch (err) {
      console.warn('实时转写失败:', err);
    } finally {
      isTranscribing = false;
    }
  }, CHUNK_MS);
}

function pauseRecording() {
  if (!isRecording) return;
  const btn = $('pauseBtn');
  if (recorder.isPaused) {
    recorder.resume();
    if (btn) btn.innerHTML = '<i class="fas fa-pause"></i>';
  } else {
    recorder.pause();
    if (btn) btn.innerHTML = '<i class="fas fa-play"></i>';
  }
  updateControlUI();
}

function stopRecording() {
  if (!isRecording) return;
  if (chunkTimer) {
    clearInterval(chunkTimer);
    chunkTimer = null;
  }
  isTranscribing = false;
  abortTranscription();
  recorder.stop();
  isRecording = false;
  updateControlUI();
}

function updateControlUI() {
  const startBtn = $('startBtn');
  const stopBtn = $('stopBtn');
  const pauseBtn = $('pauseBtn');
  const statusBadge = $('statusBadge');

  if (isRecording) {
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (pauseBtn) pauseBtn.disabled = false;
    const meter = $('audioMeter');
    if (meter) meter.style.opacity = '1';
    if (statusBadge) {
      if (recorder.isPaused) {
        statusBadge.innerHTML = `<i class="fas fa-circle"></i> ${getString('statusPaused')}`;
        statusBadge.className = 'status-badge paused';
      } else {
        statusBadge.innerHTML = `<i class="fas fa-circle"></i> ${getString('statusRecording')} <span class="rec-timer" id="recTimer">00:00</span>`;
        statusBadge.className = 'status-badge recording';
        startTimer();
      }
    }
  } else {
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = true;
    if (statusBadge) {
      statusBadge.innerHTML = `<i class="fas fa-circle"></i> ${getString('statusIdle')}`;
      statusBadge.className = 'status-badge';
    }
    stopTimer();
    const meter = $('audioMeter');
    if (meter) meter.style.opacity = '0';
  }
}

let timerInterval;
function startTimer() {
  stopTimer();
  timerInterval = setInterval(() => {
    const timerEl = $('recTimer');
    if (timerEl) timerEl.textContent = formatTime(recorder.getElapsed());
  }, 500);
}
function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function updateLiveDisplay() {
  const el = $('segmentList');
  if (!el) return;
  if (currentSegments.length === 0) {
    el.innerHTML = '<div class="live-placeholder">点击开始，对着麦克风说话...</div>';
    lastRenderedCount = 0;
    return;
  }

  const placeholder = el.querySelector('.live-placeholder');
  if (placeholder) placeholder.remove();

  const newSegs = currentSegments.slice(lastRenderedCount);
  if (newSegs.length === 0) return;

  const frag = document.createDocumentFragment();
  newSegs.forEach(s => {
    const div = document.createElement('div');
    div.className = 'segment-item';
    div.innerHTML = `<span class="segment-time">${formatTime(s.start)}–${formatTime(s.end)}</span><span class="segment-text">${escapeHtml(s.text)}</span>`;
    frag.appendChild(div);
  });
  el.appendChild(frag);
  lastRenderedCount = currentSegments.length;
  el.scrollTop = el.scrollHeight;
}

function updateAudioMeter(data) {
  const meter = $('audioMeter');
  if (!meter) return;
  const bars = meter.querySelectorAll('.audio-bar');
  const step = Math.floor(data.length / bars.length);
  bars.forEach((bar, i) => {
    const value = data[i * step] || 0;
    const height = Math.max(3, (value / 255) * 24);
    bar.style.height = height + 'px';
  });
}

async function handleFileUpload(file) {
  const validation = validateAudioFile(file);
  if (!validation.valid) {
    showToast(validation.error);
    return;
  }

  if (currentMode === 'local' && !isReady()) {
    showToast('模型尚未就绪，请稍候');
    return;
  }
  if (currentMode === 'cloud' && !isCloudReady()) {
    showToast(getString('apiKeyRequired'));
    return;
  }

  const statusEl = $('modelStatus');
  const progressContainer = $('progressContainer');
  const progressFill = $('progressFill');

  const transcribeOpts = currentMode === 'cloud'
    ? { cloudMode: true, apiKey: mimoApiKey }
    : {};

  if (statusEl) statusEl.innerHTML = `📁 ${file.name}`;
  if (progressContainer) progressContainer.style.display = 'block';
  if (progressFill) progressFill.style.width = '10%';

  try {
    if (statusEl) statusEl.innerHTML = '🔊 解码音频...';
    if (progressFill) progressFill.style.width = '30%';
    const { audioData, duration } = await decodeAudioFile(file);

    if (audioData.length / 16000 > 300) {
      if (statusEl) statusEl.innerHTML = '⏳ 分块处理大文件...';
      if (progressFill) progressFill.style.width = '40%';
      const chunks = splitAudioChunks(audioData, 30, 5);
      const allChunks = [];
      let fullText = '';

      for (let i = 0; i < chunks.length; i++) {
        if (statusEl) statusEl.innerHTML = `⏳ 处理 ${i + 1}/${chunks.length}...`;
        if (progressFill) progressFill.style.width = `${40 + (i / chunks.length) * 50}%`;
        const result = await transcribe(chunks[i], currentLanguage, transcribeOpts);
        if (result.chunks) {
          const stepSec = 30 - 5;
          const offset = i * stepSec;
          result.chunks.forEach(c => {
            allChunks.push({ start: offset + c.start, end: offset + c.end, text: c.text });
          });
        }
        fullText += result.text + ' ';
      }

      const blob = new Blob([await file.arrayBuffer()], { type: file.type });
      await addRecording({
        audioBlob: blob,
        transcript: fullText.trim(),
        language: currentLanguage,
        source: 'upload',
        segments: allChunks,
        model: currentModelId
      });

      currentSegments = allChunks;
      updateLiveDisplay();

    } else {
      if (statusEl) statusEl.innerHTML = '🤖 识别中...';
      if (progressFill) progressFill.style.width = '70%';
      const result = await transcribe(audioData, currentLanguage, transcribeOpts);

      const blob = new Blob([await file.arrayBuffer()], { type: file.type });
      await addRecording({
        audioBlob: blob,
        transcript: result.text,
        language: currentLanguage,
        source: 'upload',
        segments: result.chunks || [{ start: 0, end: duration, text: result.text }],
        model: currentModelId
      });

      currentSegments = result.chunks || [{ start: 0, end: duration, text: result.text }];
      updateLiveDisplay();
    }

    if (statusEl) statusEl.innerHTML = '✅ 完成';
    if (progressFill) progressFill.style.width = '100%';
    showToast('识别完成');
    refreshHistory();
    setTimeout(() => { if (progressContainer) progressContainer.style.display = 'none'; }, 2000);

  } catch (err) {
    console.error('识别失败:', err);
    if (statusEl) statusEl.innerHTML = '❌ 失败';
    showToast('识别失败: ' + err.message);
    if (progressFill) progressFill.style.width = '0%';
  }
}

async function clearCache() {
  if (!confirm('确定清除所有缓存并刷新？这将同时清除已下载的模型文件。')) return;

  try {
    clearModelCache(currentModelId);
  } catch {}

  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  }
  try { indexedDB.deleteDatabase('transformers-cache'); } catch {}
  try { indexedDB.deleteDatabase('vtw-model-cache'); } catch {}
  location.reload();
}

document.addEventListener('DOMContentLoaded', init);
