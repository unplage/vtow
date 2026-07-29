import { getAllRecordings, searchRecordings, deleteRecording, updateRecording } from './storage.js';
import { getString, getLang, escapeHtml, formatTime, formatDate } from './ui.js';

let currentPage = 1;
const PAGE_SIZE = 10;
let allRecords = [];
let filteredRecords = [];
const activeAudio = new Map();

export function initHistory() {
  refreshHistory();
}

export async function refreshHistory() {
  allRecords = await getAllRecordings();
  allRecords.sort((a, b) => b.timestamp - a.timestamp);
  filteredRecords = [...allRecords];
  currentPage = 1;
  renderHistory();
}

export async function filterHistory(query, language, source) {
  filteredRecords = await searchRecordings({ query, language, source });
  currentPage = 1;
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  const pagination = document.getElementById('historyPagination');

  if (!list) return;

  if (filteredRecords.length === 0) {
    list.innerHTML = '';
    if (empty) {
      empty.textContent = getString('noRecords');
      empty.style.display = 'flex';
    }
    if (pagination) pagination.style.display = 'none';
    return;
  }

  if (empty) empty.style.display = 'none';

  const totalPages = Math.ceil(filteredRecords.length / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRecords = filteredRecords.slice(start, start + PAGE_SIZE);

  list.innerHTML = pageRecords.map(rec => {
    const date = formatDate(rec.timestamp);
    const langLabel = rec.language === 'zh-CN' ? '中文' : rec.language === 'en-US' ? 'English' : '自动';
    const sourceLabel = rec.source === 'mic' ? getString('sourceMic') : getString('sourceUpload');
    const segs = rec.segments || [];
    const modelLabel = (rec.model || 'whisper-base').replace('Xenova/', '');
    const isPlaying = activeAudio.has(rec.id) && !activeAudio.get(rec.id).audio.paused;

    let segsHtml = '';
    if (segs.length > 0) {
      segsHtml = segs.map(s =>
        `<div class="history-seg" data-start="${s.start}" data-end="${s.end}">
          <span class="history-seg-time">${formatTime(s.start)}–${formatTime(s.end)}</span>
          <span class="history-seg-text">${escapeHtml(s.text)}</span>
        </div>`
      ).join('');
    } else {
      segsHtml = `<div class="history-seg"><span class="history-seg-text">${escapeHtml(rec.transcript) || '无文本'}</span></div>`;
    }

    return `
    <div class="history-item" data-id="${rec.id}">
      <div class="history-meta">
        <span>${date}</span>
        <span class="history-badge">${langLabel}</span>
        <span class="history-badge">${sourceLabel}</span>
        <span class="history-badge">${modelLabel}</span>
      </div>
      <div class="history-segments">${segsHtml}</div>
      <div class="history-actions">
        <button class="hist-btn" data-action="play" title="播放"><i class="fas fa-${isPlaying ? 'pause' : 'play'}"></i></button>
        <button class="hist-btn" data-action="edit" title="编辑"><i class="fas fa-pen"></i></button>
        <button class="hist-btn" data-action="srt" title="导出SRT"><i class="fas fa-closed-captioning"></i></button>
        <button class="hist-btn" data-action="txt" title="导出TXT"><i class="fas fa-file-alt"></i></button>
        <button class="hist-btn" data-action="json" title="导出JSON"><i class="fas fa-file-code"></i></button>
        <button class="hist-btn" data-action="audio" title="导出音频"><i class="fas fa-download"></i></button>
        <button class="hist-btn" data-action="delete" title="删除"><i class="fas fa-trash-alt"></i></button>
      </div>
    </div>`;
  }).join('');

  if (pagination && totalPages > 1) {
    pagination.style.display = 'flex';
    let pagesHtml = '';
    for (let i = 1; i <= totalPages; i++) {
      pagesHtml += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    pagination.innerHTML = `<button class="page-btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>&laquo;</button>${pagesHtml}<button class="page-btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}>&raquo;</button>`;
  } else if (pagination) {
    pagination.style.display = 'none';
  }

  bindHistoryEvents();
}

function bindHistoryEvents() {
  document.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.page;
      if (p === 'prev' && currentPage > 1) currentPage--;
      else if (p === 'next') currentPage++;
      else if (p !== 'prev' && p !== 'next') currentPage = parseInt(p);
      renderHistory();
    });
  });

  document.querySelectorAll('.history-item').forEach(item => {
    const id = Number(item.dataset.id);

    item.querySelector('[data-action="play"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const rec = filteredRecords.find(r => r.id === id);
      if (!rec?.audioBlob) return;

      const existing = activeAudio.get(id);
      if (existing) {
        if (existing.audio.paused) {
          existing.audio.play();
          e.currentTarget.innerHTML = '<i class="fas fa-pause"></i>';
        } else {
          existing.audio.pause();
          e.currentTarget.innerHTML = '<i class="fas fa-play"></i>';
        }
        return;
      }

      const url = URL.createObjectURL(rec.audioBlob);
      const audio = new Audio(url);
      activeAudio.set(id, { audio, url });
      e.currentTarget.innerHTML = '<i class="fas fa-pause"></i>';

      audio.play();
      audio.addEventListener('ended', () => {
        e.currentTarget.innerHTML = '<i class="fas fa-play"></i>';
        URL.revokeObjectURL(url);
        activeAudio.delete(id);
      });
    });

    item.querySelector('[data-action="txt"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const rec = filteredRecords.find(r => r.id === id);
      if (!rec) return;
      exportAsTXT(rec);
    });

    item.querySelector('[data-action="srt"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const rec = filteredRecords.find(r => r.id === id);
      if (!rec) return;
      exportAsSRT(rec);
    });

    item.querySelector('[data-action="json"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const rec = filteredRecords.find(r => r.id === id);
      if (!rec) return;
      exportAsJSON(rec);
    });

    item.querySelector('[data-action="audio"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const rec = filteredRecords.find(r => r.id === id);
      if (rec?.audioBlob) {
        const url = URL.createObjectURL(rec.audioBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audio_${rec.timestamp}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      }
    });

    item.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleEditMode(id, item);
    });

    item.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(getString('deleteSingleConfirm'))) {
        await deleteRecording(id);
        refreshHistory();
      }
    });
  });
}

function toggleEditMode(id, item) {
  const segs = item.querySelectorAll('.history-seg-text');
  const isEditing = item.classList.contains('editing');
  if (isEditing) {
    item.classList.remove('editing');
    const newTexts = [];
    segs.forEach(s => {
      s.contentEditable = 'false';
      newTexts.push(s.textContent);
    });
    const fullText = newTexts.join(' ').trim();
    updateRecording(id, { transcript: fullText, segments: (filteredRecords.find(r => r.id === id)?.segments || []).map((s, i) => ({ ...s, text: newTexts[i] || s.text })) });
    refreshHistory();
  } else {
    item.classList.add('editing');
    segs.forEach(s => s.contentEditable = 'true');
    const first = segs[0];
    if (first) first.focus();
  }
}

function exportAsTXT(rec) {
  let content = '';
  if (rec.segments && rec.segments.length) {
    content = rec.segments.map(s => `[${formatTime(s.start)}-${formatTime(s.end)}] ${s.text}`).join('\n');
  } else {
    content = rec.transcript || '';
  }
  downloadFile(`transcript_${rec.timestamp}.txt`, '\uFEFF' + content, 'text/plain;charset=utf-8');
}

function exportAsSRT(rec) {
  if (!rec.segments || !rec.segments.length) {
    downloadFile(`transcript_${rec.timestamp}.srt`, `1\n00:00:00,000 --> 00:00:10,000\n${rec.transcript || ''}\n`, 'text/plain;charset=utf-8');
    return;
  }
  const lines = rec.segments.map((s, i) => {
    return `${i + 1}\n${toSrtTime(s.start)} --> ${toSrtTime(s.end)}\n${s.text}\n`;
  });
  downloadFile(`transcript_${rec.timestamp}.srt`, '\uFEFF' + lines.join('\n'), 'text/plain;charset=utf-8');
}

function exportAsJSON(rec) {
  const data = {
    timestamp: rec.timestamp,
    language: rec.language,
    source: rec.source,
    model: rec.model,
    transcript: rec.transcript,
    segments: rec.segments || []
  };
  downloadFile(`transcript_${rec.timestamp}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function toSrtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function exportAll(format = 'txt') {
  const records = filteredRecords.length > 0 ? filteredRecords : allRecords;
  if (!records.length) return;

  if (format === 'json') {
    const data = records.map(r => ({
      timestamp: r.timestamp,
      language: r.language,
      source: r.source,
      model: r.model,
      transcript: r.transcript,
      segments: r.segments || []
    }));
    downloadFile(`all_transcripts_${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
  } else if (format === 'srt') {
    let idx = 1;
    const lines = [];
    records.forEach(r => {
      (r.segments || []).forEach(s => {
        lines.push(`${idx}\n${toSrtTime(s.start)} --> ${toSrtTime(s.end)}\n${s.text}\n`);
        idx++;
      });
    });
    downloadFile(`all_transcripts_${Date.now()}.srt`, '\uFEFF' + lines.join('\n'), 'text/plain;charset=utf-8');
  } else {
    let content = '';
    records.sort((a, b) => a.timestamp - b.timestamp).forEach(r => {
      const date = formatDate(r.timestamp);
      content += `--- ${date} (${r.language}) [${r.source}] ---\n`;
      if (r.segments && r.segments.length) {
        r.segments.forEach(s => content += `[${formatTime(s.start)}-${formatTime(s.end)}] ${s.text}\n`);
      } else {
        content += (r.transcript || '') + '\n';
      }
      content += '\n';
    });
    downloadFile(`all_transcripts_${Date.now()}.txt`, '\uFEFF' + content, 'text/plain;charset=utf-8');
  }
}