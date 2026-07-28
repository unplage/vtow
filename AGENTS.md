# VtoW — 语音转写离线版 PWA

Single-page PWA (`index.html`) with inline CSS/JS — no bundler, no package.json, no framework.

## Key files

- `index.html` — main app (~890 lines, inline all logic)
- `sw.js` — service worker (dynamic BASE_PATH, cache-first for static assets, network-first for HTML)
- `clear.html` — standalone PWA cache/db cleanup tool
- `manifest.json` — PWA manifest, scope/start_url hardcoded to `/vtow/`
- `models/xenova/whisper-tiny/` — local ONNX Whisper model files (loaded by Transformers.js with `local_files_only: true`)

## Gotchas

- **Transformers.js is loaded from CDN at runtime** (`import()` from `cdn.jsdelivr.net` or `unpkg.com`). `js/transformers.min.js` is vendored but not referenced anywhere in the app — it may be stale/unused.
-  No package.json, no build step, no CI. Edit `index.html` directly.
- IndexedDB store: `VoiceTranscriptDB_v2` / `recordings` — stores audio blobs + transcripts.
- Service worker versioning: cache name is derived from `BASE_PATH` (e.g. `pwa-cache--vtow--v1`). When deployed to a subpath, update `manifest.json` scope/start_url accordingly.
- No test setup exists.