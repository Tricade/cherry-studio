# Agent Note: German offline dictation and speech

Status: proposed

English | [中文](2026-11-03-german-offline-voice.zh.md)

## Problem

Windows and Linux users can download FunASR Nano and Kokoro, but neither installed preset offers a German voice and German dictation together. The existing PaddleOCR medium recognizer already reads German.

## Proposal

Offer two independent, optional downloads in the existing local model catalog. Use the multilingual [Whisper Small](https://github.com/openai/whisper/tree/86098128c0b4f24f0e2aa2994de830614b474227) INT8 weights with German transcription and the single-speaker [Neon CSS10 German](https://huggingface.co/neongeckocom/tts-vits-css10-de/tree/408f0bf6d6d71e24c7544c9425cdc5cd82829734) VITS voice. The publishers identify the respective model licenses as MIT and BSD-3-Clause. Keep upstream attribution, immutable ONNX sources and per-file SHA-256 digests. Both models use the existing Sherpa 1.13.6 runtime. Keep the existing PaddleOCR download and make its German support visible.

## Alternatives considered

Apple MLX models cannot serve Windows. A German Piper voice considered for this change inherited weights from another voice with different dataset terms. The Neon model has an explicit publisher license and uses a character tokenizer without a separate phonemizer download. Whisper Small takes more space than Base but still less than half of the current FunASR download.

## Acceptance criteria

- AC1 — Users can select and explicitly download or remove each German voice model independently. Each file must match its pinned digest. Existing model choices survive. (verification: catalog, renderer and lifecycle tests)
- AC2 — The German dictation preset transcribes German speech locally, including recordings longer than Whisper's input window, and returns the transcript through the existing voice API. (verification: unit and native inference)
- AC3 — The German voice reads German text into nonempty WAV audio with the selected speed, including after another voice has been used. (verification: unit and native inference)
- AC4 — German text with umlauts and ß can be read by the existing local OCR model; the download card identifies this option. (verification: local image inference and renderer)

## Risks

Weights are downloaded when requested and occupy separate directories. German dictation uses roughly 377 MB including voice activity detection; speech synthesis uses roughly 71 MB. The shared runtime is an additional download on first use. These sizes and individual samples do not establish quality parity across speakers, accents or recording conditions.
