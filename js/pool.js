function dispatch(type, detail) {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}

export class WorkerPool {
  constructor(count, modelId) {
    this.workers = [];
    this.busy = [];
    this.taskQueue = [];
    this.msgId = 0;
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.workers.push(w);
      this.busy.push(false);
    }
    this._attachForwarding();
  }

  _attachForwarding() {
    this.workers.forEach(w => {
      w.addEventListener('message', (e) => {
        const msg = e.data;
        switch (msg.type) {
          case 'model-progress':
            dispatch('model:progress', { loaded: msg.loaded, total: msg.total });
            break;
          case 'model-ready':
            dispatch('model:ready', { progress: 100 });
            break;
          case 'download-progress':
            dispatch('model:download-progress', { url: msg.url, loaded: msg.loaded, total: msg.total });
            break;
          case 'model-status':
            dispatch('model:status', { modelId: msg.modelId, cached: msg.cached, complete: msg.complete, totalBytes: msg.totalBytes, files: msg.files });
            break;
          case 'model-cache-cleared':
            dispatch('model:cache-cleared', { modelId: msg.modelId });
            break;
          case 'model-set':
            dispatch('model:changed', { modelId: msg.modelId });
            break;
        }
      });
    });
  }

  loadModel(modelId) {
    return Promise.all(this.workers.map((w) => {
      return new Promise((resolve, reject) => {
        const handler = (e) => {
          if (e.data.type === 'loaded') { w.removeEventListener('message', handler); resolve(); }
          if (e.data.type === 'error' && e.data.id == null) { w.removeEventListener('message', handler); reject(new Error(e.data.message)); }
        };
        w.addEventListener('message', handler);
        w.postMessage({ type: 'load', modelId });
      });
    }));
  }

  transcribe(audioData, language) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ id, audioData, language, resolve, reject });
      this._processQueue();
    });
  }

  _getNextWorker() {
    const idx = this.busy.indexOf(false);
    return idx;
  }

  _processQueue() {
    while (this.taskQueue.length > 0) {
      const idx = this._getNextWorker();
      if (idx === -1) break;
      const task = this.taskQueue.shift();
      this.busy[idx] = true;
      const handler = (e) => {
        if (e.data.id !== task.id) return;
        this.workers[idx].removeEventListener('message', handler);
        this.busy[idx] = false;
        this._processQueue();
        if (e.data.type === 'result') task.resolve({ text: e.data.text, chunks: e.data.chunks });
        else task.reject(new Error(e.data.message));
      };
      this.workers[idx].addEventListener('message', handler);
      this.workers[idx].postMessage({ type: 'transcribe', audioData, language, id: task.id });
    }
  }

  destroy() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    this.busy = [];
    this.taskQueue = [];
  }
}
