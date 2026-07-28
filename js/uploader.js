export async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const targetSr = 16000;
    const duration = audioBuffer.duration;
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(duration * targetSr), targetSr);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();
    const rendered = await offlineCtx.startRendering();
    const audioData = rendered.getChannelData(0);

    return { audioData, duration };
  } finally {
    audioContext.close().catch(() => {});
  }
}

export function splitAudioChunks(audioData, chunkDurationSec = 30, overlapSec = 5) {
  const sampleRate = 16000;
  const chunkSize = chunkDurationSec * sampleRate;
  const overlapSize = overlapSec * sampleRate;
  const step = chunkSize - overlapSize;
  const chunks = [];
  for (let offset = 0; offset < audioData.length; offset += step) {
    const end = Math.min(offset + chunkSize, audioData.length);
    chunks.push(audioData.slice(offset, end));
    if (end >= audioData.length) break;
  }
  return chunks;
}

export function validateAudioFile(file) {
  const maxSize = 200 * 1024 * 1024;
  if (file.size > maxSize) {
    return { valid: false, error: '文件过大 (>200MB)' };
  }
  const ext = file.name.split('.').pop().toLowerCase();
  const allowed = ['mp3', 'wav', 'm4a', 'webm', 'ogg', 'flac', 'opus', 'aac'];
  if (!allowed.includes(ext) && !file.type.startsWith('audio/')) {
    return { valid: false, error: '不支持的文件格式' };
  }
  return { valid: true };
}