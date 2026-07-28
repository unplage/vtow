# VtoW — 语音转写·会议版

🔗 **https://unplage.github.io/vtow/**

离线语音转写 PWA，基于 [OpenAI Whisper](https://github.com/openai/whisper) + [Transformers.js](https://huggingface.co/docs/transformers.js)，所有推理在浏览器本地完成，无需服务器。

---

## 功能

| 功能 | 说明 |
|------|------|
| **实时录音转写** | 麦克风录音 → 分块 Whisper 推理 → 带时间戳实时显示 |
| **文件上传转写** | 拖拽/选择音频文件 → 本地识别，支持大文件自动分块 |
| **四档模型可选** | Tiny / Base / Small（本地离线） + Turbo（远程下载后离线） |
| **中英文支持** | 手动切换语言或自动检测 |
| **多格式导出** | SRT（字幕） / VTT / TXT / JSON |
| **历史管理** | 全文搜索、分页、内联编辑、批量操作 |
| **暗色/亮色主题** | 一键切换，偏好持久化 |
| **快捷键** | `Space` 开始/停止 · `Ctrl+E` 导出 · `Ctrl+F` 搜索 · `Ctrl+T` 主题 |
| **完全离线** | 模型文件打包在仓库中，GitHub Pages 直接托管，无需服务器 |

---

## 模型

| 模型 | 大小 | 特点 | 加载方式 |
|------|------|------|---------|
| `whisper-tiny` | 99 MB | 速度最快，精度较低 | 本地离线 |
| `whisper-base` | 77 MB | **默认推荐**，平衡速度与精度 | 本地离线 |
| `whisper-small` | 131 MB | 高精度，适合慢速设备 | 本地离线 |
| `whisper-large-v3-turbo` | ~800 MB | 最高精度，95% large-v3 准确率 | 首次从 Hugging Face Hub 下载，浏览器缓存后离线可用 |

> Turbo 模型首次使用需联网下载约 800MB，下载完成后浏览器自动缓存。网络不可用时自动回退到 Base 模型。

---

## 技术栈

- **前端**：纯 HTML/CSS/JS，ES Modules，无构建步骤
- **推理引擎**：[Transformers.js v3](https://huggingface.co/docs/transformers.js) + ONNX Runtime Web (WASM)
- **模型**：[Xenova Whisper ONNX 量化版](https://huggingface.co/models?library=onnx&sort=downloads&search=whisper)
- **存储**：IndexedDB（录音数据 + 转写文本）
- **PWA**：Service Worker 离线缓存 + Web App Manifest
- **Web Worker**：推理在独立线程运行，UI 不阻塞

---

## 文件结构

```
vtow/
├── index.html              # 主应用入口
├── manifest.json           # PWA 清单
├── sw.js                   # Service Worker（v2 缓存策略）
├── clear.html              # PWA 缓存清理工具
├── css/
│   └── style.css           # 样式（支持亮/暗色主题）
├── js/
│   ├── app.js              # 主入口：初始化、事件绑定、模块协调
│   ├── worker.js           # Web Worker：Transformers.js 推理
│   ├── transcription.js    # 转写引擎封装
│   ├── recorder.js         # 录音管理（MediaRecorder + 分块）
│   ├── uploader.js         # 文件上传：解码、重采样、分块
│   ├── storage.js          # IndexedDB CRUD + 搜索
│   ├── history.js          # 历史渲染、分页、导出
│   └── ui.js               # i18n、主题、toast、工具函数
└── models/
    └── xenova/
        ├── whisper-tiny/    # Tiny 模型文件
        ├── whisper-base/    # Base 模型文件
        └── whisper-small/   # Small 模型文件
```

---

## 快速开始

### GitHub Pages 部署（推荐）

1. Fork 或克隆本仓库
2. 启用 GitHub Pages（Settings → Pages → Source: `main` 分支）
3. 访问 `https://<your-username>.github.io/vtow/`

### 本地开发

```bash
git clone https://github.com/unplage/vtow.git
cd vtow
python3 -m http.server 8080
# 访问 http://localhost:8080/vtow/
```

> 需通过 HTTP 服务器访问，`file://` 协议下 Service Worker 不可用。

---

## 快捷键

| 按键 | 功能 |
|------|------|
| `Space` | 开始/停止录音 |
| `Ctrl + E` | 导出全部转写文本 |
| `Ctrl + F` | 聚焦搜索框 |
| `Ctrl + T` | 切换亮/暗色主题 |

---

## 浏览器兼容

- Chrome 90+
- Edge 90+
- Safari 16+
- Firefox 110+

> 实时录音转写依赖 `MediaRecorder` + `getUserMedia`，需 HTTPS 或 localhost。

---

## 开源许可

MIT