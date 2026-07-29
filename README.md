# VtoW — 语音转写·会议版

🔗 **https://unplage.github.io/vtow/**

离线语音转写 PWA，支持本地 Whisper 模型和云端 MiMo ASR API，所有推理在浏览器本地完成（云端模式除外），无需服务器。

---

## 功能

| 功能 | 说明 |
|------|------|
| **实时录音转写** | 麦克风录音 → 8秒分块推理 → 带时间戳实时显示 |
| **文件上传转写** | 拖拽/选择音频文件 → 自动按30秒分块识别，支持任意时长 |
| **双模式切换** | 本地离线推理 / 云端 MiMo API |
| **五档模型可选** | Tiny / Base / Small / Turbo（本地）+ MiMo-V2.5-ASR（云端） |
| **中英文支持** | 手动切换语言或自动检测 |
| **多格式导出** | SRT（字幕） / TXT / JSON |
| **历史管理** | 全文搜索、分页、内联编辑、批量操作 |
| **暗色/亮色主题** | 一键切换，偏好持久化 |
| **快捷键** | `Space` 开始/停止 · `Ctrl+E` 导出 · `Ctrl+F` 搜索 · `Ctrl+T` 主题 |
| **PWA 离线** | Service Worker 缓存，支持离线使用 |

---

## 模型

### 本地模型（离线）

| 模型 | 大小 | 特点 | 加载方式 |
|------|------|------|---------|
| `whisper-tiny` | ~40 MB | 速度最快，精度较低，中文支持弱 | 本地离线 |
| `whisper-base` | ~75 MB | **默认推荐**，平衡速度与精度 | 本地离线 |
| `whisper-small` | ~250 MB | 高精度，首次使用需下载 | 联网下载，浏览器缓存后离线 |
| `whisper-large-v3-turbo` | ~800 MB | 最高精度 | 联网下载，浏览器缓存后离线 |

> 本地模型最大输入30秒，文件上传时自动按30秒分块处理。

### 云端模型

| 模型 | 说明 | 计费 |
|------|------|------|
| `MiMo-V2.5-ASR` | 小米 MiMo 语音识别 API，中英双语+方言 | ¥0.5/小时 |

> 云端模式需配置 MiMo API Key，音频上传至小米服务器处理。

---

## 技术栈

- **前端**：纯 HTML/CSS/JS，ES Modules，无构建步骤
- **推理引擎**：[Transformers.js v3](https://huggingface.co/docs/transformers.js) + ONNX Runtime Web (WASM)
- **本地模型**：[Xenova Whisper ONNX 量化版](https://huggingface.co/models?library=onnx&sort=downloads&search=whisper)
- **云端 API**：[小米 MiMo-V2.5-ASR](https://platform.xiaomimimo.com)
- **存储**：IndexedDB（录音数据 + 转写文本）
- **PWA**：Service Worker 离线缓存 + Web App Manifest
- **Web Worker**：本地推理在独立线程运行，UI 不阻塞

---

## 文件结构

```
vtow/
├── index.html              # 主应用入口
├── manifest.json           # PWA 清单
├── sw.js                   # Service Worker（v24 缓存策略）
├── clear.html              # PWA 缓存清理工具
├── css/
│   └── style.css           # 样式（支持亮/暗色主题）
├── js/
│   ├── app.js              # 主入口：初始化、事件绑定、模块协调
│   ├── worker.js           # Web Worker：Transformers.js 推理
│   ├── transcription.js    # 转写引擎封装（本地+云端）
│   ├── recorder.js         # 录音管理（MediaRecorder）
│   ├── uploader.js         # 文件上传：解码、重采样、分块
│   ├── cloud.js            # MiMo Cloud ASR API 集成
│   ├── storage.js          # IndexedDB CRUD + 搜索
│   ├── history.js          # 历史渲染、分页、导出
│   └── ui.js               # i18n、主题、toast、工具函数
└── models/
    └── xenova/
        ├── whisper-tiny/    # Tiny 模型文件（本地）
        ├── whisper-base/    # Base 模型文件（本地）
        └── whisper-small/   # Small 模型文件（配置，按需下载）
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

## 使用说明

### 实时录音转写

1. 选择模式（本地/云端）和模型
2. 选择语言（自动/中文/英文）
3. 点击「开始」或按 `Space` 开始录音
4. 实时查看带时间戳的转写结果
5. 点击「停止」结束录音，自动保存到历史记录

### 文件上传转写

1. 点击上传区域或拖拽音频文件
2. 自动按30秒分块处理（本地模型限制）
3. 显示处理进度
4. 完成后自动保存到历史记录

### 云端模式

1. 切换到「云端」模式
2. 输入 MiMo API Key 并保存
3. 选择「MiMo ☁️」模型
4. 开始录音或上传文件

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
