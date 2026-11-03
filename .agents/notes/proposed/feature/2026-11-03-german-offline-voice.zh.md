# Agent Note: 德语离线听写和语音合成

Status: proposed

[English](2026-11-03-german-offline-voice.md) | 中文

## 问题

Windows 和 Linux 用户可以下载 FunASR Nano 和 Kokoro，但现有预设无法同时提供德语听写和德语音色。已有的 PaddleOCR medium 识别模型可以读取德语。

## 提案

在本地模型目录中提供两个独立的可选下载。采用多语言 [Whisper Small](https://github.com/openai/whisper/tree/86098128c0b4f24f0e2aa2994de830614b474227) INT8 权重进行德语转写，并使用单说话人的 [Neon CSS10 German](https://huggingface.co/neongeckocom/tts-vits-css10-de/tree/408f0bf6d6d71e24c7544c9425cdc5cd82829734) VITS 音色。发布者标明这两个模型的许可证分别为 MIT 和 BSD-3-Clause。保留上游署名、固定版本的 ONNX 来源和每个文件的 SHA-256 摘要。两个模型共用已有的 Sherpa 1.13.6 运行时。继续使用现有的 PaddleOCR 下载，并标明其德语支持。

## 考虑过的替代方案

Apple MLX 模型无法在 Windows 上运行。候选的德语 Piper 音色继承了另一种音色的权重，相关数据集条款有所不同。Neon 模型的发布者明确给出了许可证，字符分词器也无需单独下载音素转换器。Whisper Small 的下载体积比 Base 大，但仍不到当前 FunASR 下载体积的一半。

## 验收标准

- AC1 — 用户可以分别选择、下载和移除两个德语语音模型。每个文件均须通过固定摘要校验。保留用户现有的模型选择。（验证：模型目录、渲染进程和生命周期测试）
- AC2 — 德语听写预设在本地转写德语录音，包括超过 Whisper 输入窗口的录音，并通过现有语音 API 返回文本。（验证：单元测试和原生推理）
- AC3 — 德语音色按所选语速将文本合成为非空 WAV 音频，在切换音色后也能正确合成。（验证：单元测试和原生推理）
- AC4 — 现有的本地 OCR 模型可以读取包含变音字母和 ß 的德语文本；下载卡片标明德语支持。（验证：本地图像推理和渲染进程）

## 风险

按需下载的权重各自存放在独立目录中。德语听写含语音活动检测约需 377 MB，语音合成约需 71 MB。首次使用还需下载共享运行时。文件体积和个别样本不足以证明不同说话人、口音和录音环境中的质量相同。
