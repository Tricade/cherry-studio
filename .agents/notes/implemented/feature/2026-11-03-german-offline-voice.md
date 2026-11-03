# Agent Note: German offline dictation and speech

Status: implemented

English | [中文](2026-11-03-german-offline-voice.zh.md)

## Problem

Windows and Linux users can download FunASR Nano and Kokoro, but neither installed preset offers a German voice and German dictation together. The existing PaddleOCR medium recognizer already reads German.

## Decision

The local model catalog offers two independent, optional downloads. The models are the multilingual [Whisper Small](https://github.com/openai/whisper/tree/86098128c0b4f24f0e2aa2994de830614b474227) INT8 preset for German transcription and the single-speaker [Neon CSS10 German](https://huggingface.co/neongeckocom/tts-vits-css10-de/tree/408f0bf6d6d71e24c7544c9425cdc5cd82829734) VITS voice for speech synthesis. The publishers identify the respective model licenses as MIT and BSD-3-Clause. The catalog retains upstream attribution, immutable ONNX sources and per-file SHA-256 digests. Both models use the existing Sherpa 1.13.6 runtime. The existing PaddleOCR download card identifies its German support.

## Alternatives considered

Apple MLX models cannot serve Windows. A German Piper voice considered for this change inherited weights from another voice with different dataset terms. The Neon model has an explicit publisher license and uses a character tokenizer without a separate phonemizer download. Whisper Small takes more space than Base but still less than half of the current FunASR download.

## Consequences

Weights are downloaded when requested and occupy separate directories. German dictation uses roughly 377 MB including voice activity detection; speech synthesis uses roughly 71 MB. The shared runtime is an additional download on first use. These sizes and individual samples do not establish quality parity across speakers, accents or recording conditions.

## Verification

- AC1 — Catalog, download engine, model service and renderer tests cover independent downloads, pinned file digests, removal and preserved model selection. The packaged renderer IPC lists both models, their licenses and sizes. The nine affected local suites passed 154 tests.
- AC2 — The real Sherpa ASR handler transcribed three human German FLEURS recordings. Unit coverage verifies segmentation beyond Whisper's input window and the voice API returns the transcript. Some words and proper names differed from the references.
- AC3 — The real TTS handler produced nonempty mono 22,050 Hz WAV files at speeds 1 and 1.35. Adapter coverage verifies switching from Kokoro to the German voice.
- AC4 — Native PaddleOCR inference read both German image lines, including umlauts and ß. LocalModelsSection.test.tsx and locale checks cover the German-capable card. The combined Windows production build opened in an isolated profile.
