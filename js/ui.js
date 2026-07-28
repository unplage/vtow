const STRINGS = {
  'zh-CN': {
    appTitle: '语音转写·会议版',
    langZh: '中文',
    langEn: '英文',
    langAuto: '自动检测',
    statusIdle: '空闲',
    statusRecording: '录音中',
    statusPaused: '已暂停',
    statusLoading: '加载模型中',
    btnStart: '开始',
    btnStop: '停止',
    btnPause: '暂停',
    btnResume: '继续',
    uploadHint: '点击或拖拽上传音频文件',
    uploadFormats: '支持 mp3 / wav / m4a / webm / ogg',
    modelReady: '模型已就绪',
    modelLoading: '模型加载中',
    modelSelect: '模型选择',
    themeLight: '浅色',
    themeDark: '深色',
    historyTitle: '历史记录',
    searchPlaceholder: '搜索转写内容...',
    exportSRT: 'SRT',
    exportVTT: 'VTT',
    exportTXT: 'TXT',
    exportJSON: 'JSON',
    exportAll: '全部导出',
    exportSelected: '导出选中',
    deleteAll: '全部删除',
    deleteConfirm: '确定要永久删除所有记录吗？',
    deleteSingleConfirm: '确定要删除这条记录吗？',
    noRecords: '暂无转写记录',
    noResults: '未找到匹配的记录',
    recordingTime: '录音时长',
    sourceMic: '实时录音',
    sourceUpload: '文件上传',
    modelTiny: 'Tiny (快速)',
    modelBase: 'Base (推荐)',
    modelSmall: 'Small (高精度)',
    modelTurbo: 'Turbo (最高)',
    modelTurboNote: '需联网下载 ~800MB',
    modelLoadFailed: '模型加载失败，已切换回 Base',
    settingsTitle: '设置',
    keyboardShortcuts: '快捷键',
    shortcutStart: 'Space - 开始/停止',
    shortcutExport: 'Ctrl+E - 导出全部',
    shortcutSearch: 'Ctrl+F - 搜索',
    shortcutTheme: 'Ctrl+T - 切换主题',
    transcriptEditable: '点击文字可编辑',
    clearCache: '清除缓存并重试',
    offline: '当前离线模式',
    online: '在线模式',
  },
  'en-US': {
    appTitle: 'Voice to Text · Conference',
    langZh: 'Chinese',
    langEn: 'English',
    langAuto: 'Auto Detect',
    statusIdle: 'Idle',
    statusRecording: 'Recording',
    statusPaused: 'Paused',
    statusLoading: 'Loading Model',
    btnStart: 'Start',
    btnStop: 'Stop',
    btnPause: 'Pause',
    btnResume: 'Resume',
    uploadHint: 'Click or drag audio files here',
    uploadFormats: 'Supports mp3 / wav / m4a / webm / ogg',
    modelReady: 'Model ready',
    modelLoading: 'Loading model',
    modelSelect: 'Model',
    themeLight: 'Light',
    themeDark: 'Dark',
    historyTitle: 'History',
    searchPlaceholder: 'Search transcript...',
    exportSRT: 'SRT',
    exportVTT: 'VTT',
    exportTXT: 'TXT',
    exportJSON: 'JSON',
    exportAll: 'Export All',
    exportSelected: 'Export Selected',
    deleteAll: 'Delete All',
    deleteConfirm: 'Delete all records permanently?',
    deleteSingleConfirm: 'Delete this record?',
    noRecords: 'No records yet',
    noResults: 'No matching records',
    recordingTime: 'Duration',
    sourceMic: 'Live Recording',
    sourceUpload: 'File Upload',
    modelTiny: 'Tiny (Fast)',
    modelBase: 'Base (Recommended)',
    modelSmall: 'Small (Accurate)',
    modelTurbo: 'Turbo (Best)',
    modelTurboNote: 'Requires downloading ~800MB',
    modelLoadFailed: 'Load failed, switched back to Base',
    settingsTitle: 'Settings',
    keyboardShortcuts: 'Shortcuts',
    shortcutStart: 'Space - Start/Stop',
    shortcutExport: 'Ctrl+E - Export All',
    shortcutSearch: 'Ctrl+F - Search',
    shortcutTheme: 'Ctrl+T - Toggle Theme',
    transcriptEditable: 'Click text to edit',
    clearCache: 'Clear cache & retry',
    offline: 'Offline mode',
    online: 'Online mode',
  }
};

let currentLang = localStorage.getItem('vtw-lang') || 'zh-CN';
let currentTheme = localStorage.getItem('vtw-theme') || 'light';

const listeners = [];

export function onLangChange(fn) {
  listeners.push(fn);
}

export function getString(key) {
  return STRINGS[currentLang]?.[key] || STRINGS['zh-CN'][key] || key;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('vtw-lang', lang);
  document.documentElement.lang = lang === 'en-US' ? 'en' : 'zh-CN';
  listeners.forEach(fn => fn(lang));
}

export function getTheme() {
  return currentTheme;
}

export function setTheme(theme) {
  currentTheme = theme;
  localStorage.setItem('vtw-theme', theme);
  document.documentElement.setAttribute('data-theme', theme);
}

export function toggleTheme() {
  setTheme(currentTheme === 'light' ? 'dark' : 'light');
}

export function initTheme() {
  const saved = localStorage.getItem('vtw-theme');
  if (saved) {
    currentTheme = saved;
  }
  document.documentElement.setAttribute('data-theme', currentTheme);
}

export function showToast(msg, duration = 2500) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  clearTimeout(toast._hide);
  toast._hide = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
  }, duration);
}

export function formatTime(seconds) {
  if (seconds == null) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTimeFull(seconds) {
  if (seconds == null) return '--:--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]);
}

export function formatDate(ts) {
  return new Date(ts).toLocaleString(currentLang === 'zh-CN' ? 'zh-CN' : 'en-US', { hour12: false });
}

export const MODELS = [
  { id: 'Xenova/whisper-tiny', labelKey: 'modelTiny', size: 'tiny' },
  { id: 'Xenova/whisper-base', labelKey: 'modelBase', size: 'base' },
  { id: 'Xenova/whisper-small', labelKey: 'modelSmall', size: 'small' },
  { id: 'Xenova/whisper-large-v3-turbo', labelKey: 'modelTurbo', size: 'turbo', remote: true },
];