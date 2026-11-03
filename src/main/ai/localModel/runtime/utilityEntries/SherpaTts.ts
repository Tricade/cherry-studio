import { createRequire } from 'node:module'
import { join } from 'node:path'

import type { TtsInferenceContract } from '../../capabilities/tts/protocol'

interface SherpaTtsRuntime {
  OfflineTts: {
    createAsync(config: unknown): Promise<{
      generate(request: unknown): { samples: Float32Array; sampleRate: number }
    }>
  }
  writeWave(filename: string, audio: { samples: Float32Array; sampleRate: number }): void
}

function modelConfig(modelDir: string, architecture: 'kokoro' | 'vits') {
  const model = join(modelDir, 'model.onnx')
  const tokens = join(modelDir, 'tokens.txt')
  const cpu = { numThreads: 2, provider: 'cpu', debug: false }
  if (architecture === 'vits') return { model: { vits: { model, tokens }, ...cpu }, maxNumSentences: 1 }

  const dataDir = join(modelDir, 'espeak-ng-data')
  process.env.ESPEAK_DATA_PATH = dataDir
  return {
    model: {
      kokoro: {
        model,
        voices: join(modelDir, 'voices.bin'),
        tokens,
        dataDir,
        lexicon: ['lexicon-us-en.txt', 'lexicon-zh.txt'].map((file) => join(modelDir, file)).join(',')
      },
      ...cpu
    },
    ruleFsts: ['date-zh.fst', 'number-zh.fst', 'phone-zh.fst'].map((file) => join(modelDir, file)).join(','),
    maxNumSentences: 1
  }
}

export class SherpaTts {
  private readonly runtime: SherpaTtsRuntime
  private cached?: { directory: string; model: Awaited<ReturnType<SherpaTtsRuntime['OfflineTts']['createAsync']>> }

  constructor(appPath: string) {
    this.runtime = createRequire(`${appPath}/`)('sherpa-onnx-node')
  }

  async synthesize(input: TtsInferenceContract['methods']['synthesize']['input'], signal: AbortSignal) {
    signal.throwIfAborted()
    if (input.architecture === 'qwen3-tts') throw new Error('Unsupported Sherpa speech model')
    if (this.cached?.directory !== input.modelDir) {
      try {
        const model = await this.runtime.OfflineTts.createAsync(modelConfig(input.modelDir, input.architecture))
        this.cached = { directory: input.modelDir, model }
      } catch (cause) {
        throw Object.assign(new Error('Speech model initialization failed', { cause }), {
          code: 'TTS_MODEL_LOAD_FAILED'
        })
      }
    }
    signal.throwIfAborted()
    const audio = this.cached.model.generate({
      text: input.text,
      sid: Number(input.voice),
      speed: input.speed,
      // Electron's V8 sandbox requires audio buffers owned by the JavaScript runtime.
      enableExternalBuffer: false
    })
    signal.throwIfAborted()
    if (!audio.samples.length || audio.sampleRate <= 0) throw new Error('Speech output is empty')
    if (audio.samples.length > 300 * audio.sampleRate) throw new Error('Speech output exceeds five minutes')
    this.runtime.writeWave(input.outputPath, audio)
  }
}
