let createPipeline = null;
let env = null;
let modelId = 'Xenova/whisper-base';
let asrPipeline = null;

const CDN_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5/+esm';
const CDN_FALLBACK = 'https://unpkg.com/@huggingface/transformers@3.7.5/+esm';

async function loadLibrary() {
  try {
    const mod = await import(CDN_URL);
    createPipeline = mod.pipeline;
    env = mod.env;
    return;
  } catch (e) {
    const mod = await import(CDN_FALLBACK);
    createPipeline = mod.pipeline;
    env = mod.env;
  }
}

function isTurboModel(id) {
  return id.includes('large-v3-turbo');
}

function configureEnv() {
  const turbo = isTurboModel(modelId);
  env.allowRemoteModels = turbo;
  env.allowLocalModels = !turbo;
  if (!turbo) env.localModelPath = './models/';
  env.backends = ['wasm'];
}

async function loadModel() {
  await loadLibrary();
  configureEnv();
  const turbo = isTurboModel(modelId);
  const opts = {
    quantized: true,
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        self.postMessage({ type: 'model-progress', loaded: p.loaded, total: p.total });
      } else if (p.status === 'done') {
        self.postMessage({ type: 'model-ready' });
      }
    }
  };
  if (!turbo) opts.local_files_only = true;
  asrPipeline = await createPipeline('automatic-speech-recognition', modelId, opts);
  return asrPipeline;
}

async function transcribeAudio(audioData, language) {
  const lang = language === 'zh-CN' ? 'zh' : language === 'en-US' ? 'en' : null;
  const result = await asrPipeline(audioData, {
    language: lang,
    task: 'transcribe',
    return_timestamps: true,
  });
  return result;
}

self.addEventListener('message', async (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'load':
      modelId = msg.modelId || modelId;
      try {
        await loadModel();
        self.postMessage({ type: 'loaded' });
      } catch (err) {
        self.postMessage({ type: 'error', message: err.message });
      }
      break;

    case 'transcribe':
      try {
        const result = await transcribeAudio(msg.audioData, msg.language);
        self.postMessage({
          type: 'result',
          text: result.text,
          chunks: (result.chunks || []).map(c => ({
            start: c.timestamp[0],
            end: c.timestamp[1],
            text: c.text
          })),
          id: msg.id
        });
      } catch (err) {
        self.postMessage({ type: 'error', message: err.message, id: msg.id });
      }
      break;

    case 'set-model':
      modelId = msg.modelId;
      self.postMessage({ type: 'model-set', modelId });
      break;
  }
});