import { Recorder } from './recorder.js';
import { decodeAudioFile, decodeAudioFileShared, getSharedAudioContext, splitAudioChunks, validateAudioFile } from './uploader.js';
import { initWorker, loadModel, transcribe, isReady, getCurrentModel, isDownloadableModel, getDownloadSize, checkModelCache, clearModelCache, abortTranscription } from './transcription.js';
import { getProviderConfig } from './cloud.js';
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
let lastChunkEndTime = 0;
let totalDecodedSamples = 0;
let lastRenderedCount = 0;
let currentMode = localStorage.getItem('vtw-mode') || 'local';
let currentProvider = localStorage.getItem('vtw-provider') || 'mimo';

const CLOUD_STORAGE = {
  mimo: { keyKey: 'vtw-mimo-key', baseKey: 'vtw-base-mimo', modelKey: 'vtw-model-mimo' },
  siliconflow: { keyKey: 'vtw-siliconflow-key', baseKey: 'vtw-base-siliconflow', modelKey: 'vtw-model-siliconflow' },
  custom: { keyKey: 'vtw-custom-key', baseKey: 'vtw-base-custom', modelKey: 'vtw-model-custom' }
};

const CLOUD_MODEL_TO_PROVIDER = {
  'mimo-v2.5-asr': 'mimo',
  'FunAudioLLM/SenseVoiceSmall': 'siliconflow',
  'custom': 'custom'
};

function getCloudKey(providerId) {
  const cfg = CLOUD_STORAGE[providerId];
  return cfg ? (localStorage.getItem(cfg.keyKey) || '') : '';
}

function setCloudKey(providerId, value) {
  const cfg = CLOUD_STORAGE[providerId];
  if (cfg) localStorage.setItem(cfg.keyKey, value);
}

function getCloudBase(providerId) {
  const cfg = CLOUD_STORAGE[providerId];
  const saved = cfg ? localStorage.getItem(cfg.baseKey) : '';
  return saved || (getProviderConfig(providerId).apiBase || '');
}

function setCloudBase(providerId, value) {
  const cfg = CLOUD_STORAGE[providerId];
  if (!cfg) return;
  if (value) localStorage.setItem(cfg.baseKey, value);
  else localStorage.removeItem(cfg.baseKey);
}

function getCloudModel(providerId) {
  const cfg = CLOUD_STORAGE[providerId];
  const saved = cfg ? localStorage.getItem(cfg.modelKey) : '';
  return saved || (getProviderConfig(providerId).defaultModel || '');
}

function setCloudModel(providerId, value) {
  const cfg = CLOUD_STORAGE[providerId];
  if (!cfg) return;
  if (value) localStorage.setItem(cfg.modelKey, value);
  else localStorage.removeItem(cfg.modelKey);
}

function getCloudApiType(providerId) {
  if (providerId === 'custom') {
    return localStorage.getItem('vtw-type-custom') || 'transcriptions';
  }
  return getProviderConfig(providerId).apiType || 'chat';
}

function getEffectiveModel() {
  if (currentMode === 'cloud') return getCloudModel(currentProvider);
  return currentModelId;
}

function getCloudTranscribeOpts() {
  return {
    cloudMode: true,
    apiKey: getCloudKey(currentProvider),
    apiBase: getCloudBase(currentProvider),
    model: getCloudModel(currentProvider),
    apiType: getCloudApiType(currentProvider)
  };
}

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
    if (CLOUD_MODEL_TO_PROVIDER[currentModelId]) {
      currentModelId = 'Xenova/whisper-tiny';
      localStorage.setItem('vtw-model', currentModelId);
    }
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
  updateCloudConfigUI();
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
        if (CLOUD_MODEL_TO_PROVIDER[currentModelId]) {
          currentModelId = 'Xenova/whisper-tiny';
          localStorage.setItem('vtw-model', currentModelId);
          updateModelSelect();
        }
        if (!isReady()) {
          updateModelStatus('loading');
          loadModel(currentModelId);
        }
      } else if (currentMode === 'cloud' && !isCloudReady()) {
        showToast(getString('cloudConfigRequired'));
      }
    });
  });

  const providerSelect = $('providerSelect');
  const apiBaseInput = $('apiBaseInput');
  const modelNameInput = $('modelNameInput');
  const apiTypeSelect = $('apiTypeSelect');

  if (providerSelect) {
    providerSelect.addEventListener('change', () => {
      currentProvider = providerSelect.value;
      localStorage.setItem('vtw-provider', currentProvider);
      updateCloudConfigUI();
    });
  }

  if (saveApiKeyBtn && apiKeyInput) {
    saveApiKeyBtn.addEventListener('click', () => {
      const key = apiKeyInput.value.trim();
      if (!key) return;
      setCloudKey(currentProvider, key);
      setCloudBase(currentProvider, (apiBaseInput ? apiBaseInput.value.trim() : ''));
      setCloudModel(currentProvider, (modelNameInput ? modelNameInput.value.trim() : ''));
      if (currentProvider === 'custom' && apiTypeSelect) {
        localStorage.setItem('vtw-type-custom', apiTypeSelect.value);
      }
      showToast(getString('apiKeySaved'));
      updateCloudConfigUI();
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

      const providerId = CLOUD_MODEL_TO_PROVIDER[modelId];

      if (providerId) {
        currentProvider = providerId;
        localStorage.setItem('vtw-provider', currentProvider);
        if (!isCloudReady()) {
          showToast(getString('cloudConfigRequired'));
        }
        document.querySelectorAll('.model-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentModelId = modelId;
        currentMode = 'cloud';
        localStorage.setItem('vtw-model', currentModelId);
        localStorage.setItem('vtw-mode', currentMode);
        updateModeUI();
        updateCloudConfigUI();
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
    const provider = getProviderConfig(currentProvider);
    const ready = isCloudReady();
    el.innerHTML = `<span class="model-loading-icon">☁️</span> ${escapeHtml(provider.name)} · ${ready ? '✅ ' + escapeHtml(getString('cloudReady')) : '❌ ' + escapeHtml(getString('cloudNeedKey'))}`;
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
  updateCloudConfigUI();
  updateModelStatus();
}

function updateCloudConfigUI() {
  const providerSelect = $('providerSelect');
  const input = $('apiKeyInput');
  const baseInput = $('apiBaseInput');
  const modelInput = $('modelNameInput');
  const typeRow = $('apiTypeRow');
  const typeSelect = $('apiTypeSelect');
  if (providerSelect) providerSelect.value = currentProvider;
  if (input) input.value = getCloudKey(currentProvider);
  if (baseInput) baseInput.value = getCloudBase(currentProvider);
  if (modelInput) modelInput.value = getCloudModel(currentProvider);
  if (typeSelect) typeSelect.value = getCloudApiType(currentProvider);
  if (typeRow) typeRow.classList.toggle('hidden', currentProvider !== 'custom');
}

function updateOnlineStatus() {
  const el = $('onlineStatus');
  if (el) {
    el.textContent = navigator.onLine ? getString('online') : getString('offline');
    el.className = navigator.onLine ? 'online-indicator' : 'online-indicator offline';
  }
}

function isCloudReady() {
  if (currentMode !== 'cloud') return false;
  return !!(getCloudKey(currentProvider) && getCloudBase(currentProvider) && getCloudModel(currentProvider));
}

async function startRecording() {
  if (isRecording) return;

  if (currentMode === 'local' && !isReady()) {
    showToast('模型尚未就绪，请稍候');
    return;
  }
  if (currentMode === 'cloud' && !isCloudReady()) {
    showToast(getString('cloudConfigRequired'));
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
          model: getEffectiveModel()
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
    lastChunkEndTime = 0;
    totalDecodedSamples = 0;
    lastRenderedCount = 0;
    updateControlUI();
    startChunkedTranscription();
  } catch (err) {
    showToast(err.message);
  }
}

function startChunkedTranscription() {
  const CHUNK_MS = 8000;

  function updateTranscriptionStatus(transcribing) {
    const statusBadge = $('statusBadge');
    if (!statusBadge || !isRecording) return;
    if (transcribing) {
      statusBadge.innerHTML = `<i class="fas fa-circle recording"></i> ${getString('statusRecording')} <span class="rec-timer" id="recTimer">00:00</span> · <span style="color:#f59e0b">转写中...</span>`;
    } else {
      statusBadge.innerHTML = `<i class="fas fa-circle"></i> ${getString('statusRecording')} <span class="rec-timer" id="recTimer">00:00</span>`;
    }
  }

  chunkTimer = setInterval(async () => {
    if (!isRecording || recorder.isPaused) return;
    if (currentMode === 'local' && !isReady()) return;
    if (currentMode === 'cloud' && !isCloudReady()) return;
    if (isTranscribing) return;

    const blob = recorder.getAllChunksBlob();
    if (blob.size < 1000) return;

    isTranscribing = true;
    updateTranscriptionStatus(true);
    try {
      const { audioData, duration } = await decodeAudioFileShared(blob);

      const newAudioData = audioData.slice(totalDecodedSamples);
      const newDuration = newAudioData.length / 16000;
      totalDecodedSamples = audioData.length;

      if (newAudioData.length === 0) return;

      const rms = computeRMS(newAudioData);
      if (rms < 0.005) {
        lastChunkEndTime += newDuration;
        return;
      }

      const transcribeOpts = currentMode === 'cloud'
        ? getCloudTranscribeOpts()
        : {};
      const result = await transcribe(newAudioData, currentLanguage, transcribeOpts);

      if (result.chunks && result.chunks.length) {
        result.chunks.forEach(c => {
          const text = c.text.trim();
          if (!text) return;
          let start, end;
          if (currentMode === 'cloud') {
            start = lastChunkEndTime;
            end = lastChunkEndTime + newDuration;
          } else {
            start = lastChunkEndTime + c.start;
            end = lastChunkEndTime + c.end;
          }
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
        const end = lastChunkEndTime + newDuration;
        currentSegments.push({ start, end, text: result.text.trim() });
        updateLiveDisplay();
      }

      lastChunkEndTime += newDuration;
    } catch (err) {
      console.warn('实时转写失败:', err);
      showToast('转写失败: ' + err.message);
    } finally {
      isTranscribing = false;
      updateTranscriptionStatus(false);
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
    showToast(getString('cloudConfigRequired'));
    return;
  }

  const statusEl = $('modelStatus');
  const progressContainer = $('progressContainer');
  const progressFill = $('progressFill');

  const transcribeOpts = currentMode === 'cloud'
    ? { ...getCloudTranscribeOpts(), timeout: 1800000 }
    : { timeout: 1800000 };

  if (statusEl) statusEl.innerHTML = `📁 ${file.name}`;
  if (progressContainer) progressContainer.style.display = 'block';
  if (progressFill) progressFill.style.width = '10%';

  try {
    if (statusEl) statusEl.innerHTML = '🔊 解码音频...';
    if (progressFill) progressFill.style.width = '30%';
    const { audioData, duration } = await decodeAudioFile(file);

    if (statusEl) statusEl.innerHTML = '⏳ 分块处理...';
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
      model: getEffectiveModel()
    });

    currentSegments = allChunks;
    updateLiveDisplay();

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
