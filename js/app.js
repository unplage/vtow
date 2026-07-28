import { Recorder } from './recorder.js';
import { decodeAudioFile, getSharedAudioContext, splitAudioChunks, validateAudioFile } from './uploader.js';
import { loadModel, transcribe, isReady, getCurrentModel, isDownloadableModel, getDownloadSize, checkModelCache, clearModelCache, initWorker, getWorkerCount } from './transcription.js';
import { addRecording, getAllRecordings } from './storage.js';
import { initHistory, refreshHistory, filterHistory, exportAll } from './history.js';
import { getString, getLang, setLang, getTheme, setTheme, toggleTheme, initTheme, showToast, formatTime, escapeHtml, onLangChange, MODELS, showConfirmDialog, showDownloadDialog, hideDownloadDialog, updateDownloadProgress } from './ui.js';

const recorder = new Recorder();
let isRecording = false;
let currentLanguage = localStorage.getItem('vtw-lang') || 'auto';
let currentModelId = localStorage.getItem('vtw-model') || 'Xenova/whisper-base';
let currentSegments = [];
let chunkTimer = null;
let downloadTotalLoaded = 0;
let downloadTotalSize = 0;

function $(id) { return document.getElementById(id); }

function init() {
  initTheme();
  initWorker();
  initHistory();
  bindEvents();
  loadModel(currentModelId);
  updateModelStatus();
  updateLangUI();
  updateThemeUI();
  updateModelSelect();
  updateOnlineStatus();
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
  if (startBtn) startBtn.addEventListener('click', startRecording);
  if (stopBtn) stopBtn.addEventListener('click', stopRecording);
  if (pauseBtn) pauseBtn.addEventListener('click', pauseRecording);
  if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

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
      localStorage.setItem('vtw-model', currentModelId);
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
  const isTurbo = currentModelId.includes('large-v3-turbo');
  const isSmall = currentModelId.includes('whisper-small');
  const note = isTurbo ? ` <span class="model-turbo-note">(${getString('modelTurboNote')})</span>` :
    isSmall ? ` <span class="model-turbo-note">(${getString('modelSmallNote')})</span>` : '';
  const wc = getWorkerCount();
  const wcNote = wc > 1 ? ` <span class="model-turbo-note">(${wc} Workers)</span>` : '';
  if (state === 'loading') {
    const pct = typeof progressOrMsg === 'number' ? ` ${progressOrMsg}%` : '';
    el.innerHTML = `<span class="model-loading-icon">⏳</span> ${getString('modelLoading')}${pct}...${note}${wcNote}`;
    el.className = 'model-status model-loading';
  } else if (state === 'ready') {
    el.innerHTML = `<span class="model-loading-icon">✅</span> ${getString('modelReady')}${note}${wcNote}`;
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

function updateOnlineStatus() {
  const el = $('onlineStatus');
  if (el) {
    el.textContent = navigator.onLine ? getString('online') : getString('offline');
    el.className = navigator.onLine ? 'online-indicator' : 'online-indicator offline';
  }
}

async function startRecording() {
  if (isRecording) return;

  if (!isReady()) {
    showToast('模型尚未就绪，请稍候');
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
    updateControlUI();
    startChunkedTranscription();
  } catch (err) {
    showToast(err.message);
  }
}

function startChunkedTranscription() {
  const CHUNK_MS = 3000;

  chunkTimer = setInterval(async () => {
    if (!isRecording || recorder.isPaused) return;

    const blob = recorder.getAndClearNewChunks();
    if (blob.size < 1000) return;

    try {
      const ctx = getSharedAudioContext();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const targetSr = 16000;
      const duration = audioBuffer.duration;
      const offlineCtx = new OfflineAudioContext(1, Math.ceil(duration * targetSr), targetSr);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start();
      const rendered = await offlineCtx.startRendering();
      const audioData = rendered.getChannelData(0);

      const result = await transcribe(audioData, currentLanguage);

      if (result.chunks && result.chunks.length) {
        const baseTime = Date.now() / 1000 - duration;
        result.chunks.forEach(c => {
          const start = baseTime + c.start;
          const end = baseTime + c.end;
          const text = c.text.trim();
          if (text) {
            const overlap = currentSegments.some(s => {
              const timeOverlap = Math.min(end, s.end) - Math.max(start, s.start);
              const minDuration = Math.min(end - start, s.end - s.start);
              return minDuration > 0 && timeOverlap / minDuration > 0.5;
            });
            if (!overlap) {
              currentSegments.push({ start, end, text });
            }
          }
        });
        updateLiveDisplay();
      } else if (result.text && result.text.trim()) {
        const now = Date.now() / 1000;
        currentSegments.push({ start: now - 3, end: now, text: result.text.trim() });
        updateLiveDisplay();
      }
    } catch (err) {
      console.warn('实时转写失败:', err);
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
    return;
  }
  el.innerHTML = currentSegments.map(s =>
    `<div class="segment-item">
      <span class="segment-time">${formatTime(s.start)}–${formatTime(s.end)}</span>
      <span class="segment-text">${escapeHtml(s.text)}</span>
    </div>`
  ).join('');
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

  if (!isReady()) {
    showToast('模型尚未就绪，请稍候');
    return;
  }

  const statusEl = $('modelStatus');
  const progressContainer = $('progressContainer');
  const progressFill = $('progressFill');

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
        const result = await transcribe(chunks[i], currentLanguage);
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
      const result = await transcribe(audioData, currentLanguage);

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
