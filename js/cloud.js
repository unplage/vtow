const MIMO_API_URL = 'https://api.xiaomimimo.com/v1/chat/completions';
const MIMO_MODEL = 'mimo-v2.5-asr';
const CLOUD_TIMEOUT = 1200000;

function floatToWavBase64(audioData, sampleRate = 16000) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = audioData.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < audioData.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, audioData[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

export async function transcribeCloud(audioData, language, apiKey, options = {}) {
  if (!apiKey) throw new Error('请先设置 MiMo API Key');

  const timeout = options.timeout || CLOUD_TIMEOUT;
  const wavBase64 = floatToWavBase64(audioData);
  const mimeSize = Math.ceil(wavBase64.length * 0.75);

  if (mimeSize > 10 * 1024 * 1024) {
    throw new Error('音频文件过大，云端限制 10MB');
  }

  const langMap = { 'zh-CN': 'zh', 'en-US': 'en', 'auto': 'auto' };
  const asrLang = langMap[language] || 'auto';

  const body = {
    model: MIMO_MODEL,
    messages: [{
      role: 'user',
      content: [{
        type: 'input_audio',
        input_audio: { data: `data:audio/wav;base64,${wavBase64}` }
      }]
    }]
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(MIMO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      if (resp.status === 401) throw new Error('API Key 无效');
      if (resp.status === 429) throw new Error('请求过于频繁，请稍后重试');
      throw new Error(`云端转写失败 (${resp.status}): ${err}`);
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';

    return {
      text: text.trim(),
      chunks: text.trim() ? [{ start: 0, end: audioData.length / 16000, text: text.trim() }] : []
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('云端转写超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
