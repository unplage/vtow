export class Recorder {
  constructor() {
    this.stream = null;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.isRecording = false;
    this.isPaused = false;
    this.audioChunks = [];
    this.recordingStartTime = 0;
    this.onStop = null;
    this.onAnalyser = null;
    this._chunkInterval = null;
    this._analyserInterval = null;
    this._onStopCalled = false;
    this._lastTranscribedIndex = 0;
  }

  async start() {
    this._onStopCalled = false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
    } catch (err) {
      throw new Error('无法访问麦克风: ' + err.message);
    }

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 64;
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);

    this.audioChunks = [];
    this.isRecording = true;
    this.isPaused = false;
    this._lastTranscribedIndex = 0;
    this.recordingStartTime = Date.now();

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm'
      });
    } catch (e) {
      this.mediaRecorder = new MediaRecorder(this.stream);
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.audioChunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      this._handleStop();
    };

    this.mediaRecorder.start(200);

    this._startChunkTimer();
    this._startAnalyserLoop();
  }

  _handleStop() {
    if (this._onStopCalled) return;
    this._onStopCalled = true;
    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
    this._cleanup();
    if (this.onStop) this.onStop(blob);
  }

  _startChunkTimer() {
    this._chunkInterval = setInterval(() => {
      if (this.isRecording && !this.isPaused && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.requestData();
      }
    }, 3000);
  }

  _startAnalyserLoop() {
    this._analyserInterval = setInterval(() => {
      if (this.analyser && this.onAnalyser) {
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(data);
        this.onAnalyser(data);
      }
    }, 100);
  }

  pause() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.isPaused = true;
    }
  }

  resume() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.isPaused = false;
    }
  }

  stop() {
    if (this._onStopCalled) return;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try { this.mediaRecorder.stop(); } catch (e) { this._handleStop(); }
    } else {
      this._handleStop();
    }
  }

  _cleanup() {
    if (this._chunkInterval) { clearInterval(this._chunkInterval); this._chunkInterval = null; }
    if (this._analyserInterval) { clearInterval(this._analyserInterval); this._analyserInterval = null; }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.isRecording = false;
    this.isPaused = false;
    this.analyser = null;
    this.source = null;
    this.mediaRecorder = null;
  }

  getElapsed() {
    if (!this.isRecording) return 0;
    return (Date.now() - this.recordingStartTime) / 1000;
  }

  getBlob() {
    return new Blob(this.audioChunks, { type: 'audio/webm' });
  }

  getAndClearNewChunks() {
    const chunks = this.audioChunks.slice(this._lastTranscribedIndex);
    return new Blob(chunks, { type: 'audio/webm' });
  }

  acknowledgeChunks() {
    if (this._lastTranscribedIndex > 0) {
      this.audioChunks.splice(0, this._lastTranscribedIndex);
      this._lastTranscribedIndex = 0;
    }
  }

  resetChunkIndex() {
    this._lastTranscribedIndex = 0;
  }
}
