const CLOUD_TIMEOUT = 1200000;

export const CLOUD_PROVIDERS = {
  mimo: {
    id: 'mimo',
    name: 'MiMo',
    apiBase: 'https://api.xiaomimimo.com/v1',
    defaultModel: 'mimo-v2.5-asr',
    apiType: 'chat'
  },
  siliconflow: {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    apiBase: 'https://api.siliconflow.cn/v1',
    defaultModel: 'FunAudioLLM/SenseVoiceSmall',
    apiType: 'transcriptions'
  },
  custom: {
    id: 'custom',
    name: '自定义 Custom',
    apiBase: '',
    defaultModel: '',
    apiType: 'transcriptions'
  }
};

export function getProviderConfig(providerId) {
  return CLOUD_PROVIDERS[providerId] || CLOUD_PROVIDERS.mimo;
}

function createWavBuffer(audioData, sampleRate = 16000) {
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

  return buffer;
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

function floatToWavBase64(audioData, sampleRate = 16000) {
  return bufferToBase64(createWavBuffer(audioData, sampleRate));
}

function buildResult(text, duration) {
  return {
    text: text.trim(),
    chunks: text.trim() ? [{ start: 0, end: duration, text: text.trim() }] : []
  };
}

function handleResponse(resp, label) {
  if (!resp.ok) {
    if (resp.status === 401) throw new Error('API Key 无效');
    if (resp.status === 429) throw new Error('请求过于频繁，请稍后重试');
    return resp.text().catch(() => '').then(err => {
      throw new Error(`${label}失败 (${resp.status}): ${err}`);
    });
  }
}

async function transcribeChat(audioData, language, cfg, timeout) {
  const wavBase64 = floatToWavBase64(audioData);
  const mimeSize = Math.ceil(wavBase64.length * 0.75);

  if (mimeSize > 10 * 1024 * 1024) {
    throw new Error('音频文件过大，云端限制 10MB');
  }

  const body = {
    model: cfg.model,
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
    const resp = await fetch(`${cfg.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    await handleResponse(resp, '云端转写');
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    return buildResult(text, audioData.length / 16000);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('云端转写超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeTranscriptions(audioData, language, cfg, timeout) {
  const wavBuffer = createWavBuffer(audioData);

  if (wavBuffer.byteLength > 10 * 1024 * 1024) {
    throw new Error('音频文件过大，云端限制 10MB');
  }

  const form = new FormData();
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', cfg.model);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(`${cfg.apiBase}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: form,
      signal: controller.signal
    });

    await handleResponse(resp, '云端转写');
    const data = await resp.json();
    const text = data.text || data.choices?.[0]?.message?.content || '';
    return buildResult(text, audioData.length / 16000);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('云端转写超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeCloud(audioData, language, options = {}) {
  const apiKey = options.apiKey;
  const apiBase = options.apiBase;
  const model = options.model;
  const apiType = options.apiType || 'chat';
  const timeout = options.timeout || CLOUD_TIMEOUT;

  if (!apiKey) throw new Error('请先设置 API Key');
  if (!apiBase) throw new Error('请先设置 API 地址');
  if (!model) throw new Error('请先设置模型名称');

  const cfg = { apiKey, apiBase, model };

  if (apiType === 'transcriptions') {
    return transcribeTranscriptions(audioData, language, cfg, timeout);
  }
  return transcribeChat(audioData, language, cfg, timeout);
}
