import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SpeechModelV3 } from '@ai-sdk/provider'

import { application } from '@application'
import type { SpeechOptions } from '@cherrystudio/ai-core'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import {
  CSS10_TTS_MODEL_ID,
  DEFAULT_SPEECH_SPEED,
  DOWNLOADABLE_SPEECH_BUNDLES,
  KOKORO_TTS_MODEL_ID,
  LOCAL_VOICE_MODELS,
  MAX_SPEECH_SPEED,
  MIN_SPEECH_SPEED,
  type LocalSpeechVoice
} from '@shared/ai/localVoice'

import type { SpeechModelDefinition } from '../voiceModelTypes'
import { checkAbort, VoiceRuntimeError } from '../VoiceRuntimeError'
import { withScratch } from './scratch'
import { completeSpeechOperation } from './sdkOperations'
import { sherpaBundleOperations, sherpaBundleStatus, sherpaResources, sherpaVoiceSupport } from './sherpaResources'

type SherpaSpeechId = typeof KOKORO_TTS_MODEL_ID | typeof CSS10_TTS_MODEL_ID
const KOKORO_LANGUAGES = ['zh-CN', 'en-US', 'en-GB'] as const
const KOKORO_VOICES: LocalSpeechVoice[] = [
  'af_maple',
  'af_sol',
  'bf_vale',
  ...Array.from({ length: 55 }, (_, index) => `zf_${String(index + 1).padStart(3, '0')}`),
  ...Array.from({ length: 45 }, (_, index) => `zm_${String(index + 1).padStart(3, '0')}`)
].map((id) => ({
  id,
  name: id,
  locale: id.startsWith('z') ? 'zh-CN' : id.startsWith('b') ? 'en-GB' : 'en-US',
  languages: KOKORO_LANGUAGES
}))

const CSS10_VOICES: LocalSpeechVoice[] = [{ id: 'de-css10', name: 'Neon CSS10', locale: 'de-DE', languages: ['de-DE'] }]

function voicesFor(id: SherpaSpeechId) {
  return id === CSS10_TTS_MODEL_ID ? CSS10_VOICES : KOKORO_VOICES
}

function normalizeFailure(error: unknown, signal?: AbortSignal): VoiceRuntimeError {
  if (signal?.aborted) return new VoiceRuntimeError('aborted')
  if (error instanceof VoiceRuntimeError) return error
  if (error instanceof UtilityProcessError) {
    if (error.code === 'PROCESS_BLOCKED') return new VoiceRuntimeError('busy')
    if (error.remote?.code === 'TTS_MODEL_LOAD_FAILED') return new VoiceRuntimeError('model_load_failed')
    if (
      ['PROCESS_START_FAILED', 'PROCESS_EXITED', 'PROCESS_PROTOCOL_ERROR', 'PROCESS_CIRCUIT_OPEN'].includes(error.code)
    )
      return new VoiceRuntimeError('worker_crashed')
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'TTS_MODEL_LOAD_FAILED')
    return new VoiceRuntimeError('model_load_failed')
  return new VoiceRuntimeError('operation_failed')
}

export function createSherpaSpeechModel(modelId: SherpaSpeechId, options: SpeechOptions): SpeechModelV3 {
  const voices = voicesFor(modelId)
  const bundleId = DOWNLOADABLE_SPEECH_BUNDLES[modelId]
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId,
    async doGenerate(input) {
      checkAbort(input.abortSignal)
      const speaker = voices.findIndex((voice) => voice.id === options.voice)
      const language = options.language ?? voices[speaker]?.locale
      const speed = options.speed ?? DEFAULT_SPEECH_SPEED
      if (
        speaker < 0 ||
        !language ||
        !voices[speaker]?.languages?.includes(language) ||
        !Number.isFinite(speed) ||
        speed < MIN_SPEECH_SPEED ||
        speed > MAX_SPEECH_SPEED ||
        (input.outputFormat !== undefined && input.outputFormat !== 'wav')
      )
        throw new VoiceRuntimeError('invalid_request')
      const status = sherpaBundleStatus(bundleId, input.abortSignal)
      if (status.status !== 'ready') throw new VoiceRuntimeError(status.reason ?? 'model_required')
      return withScratch(
        async (directory) => {
          const outputPath = join(directory, 'speech.wav')
          const timeout = AbortSignal.timeout(120_000)
          const signal = input.abortSignal ? AbortSignal.any([timeout, input.abortSignal]) : timeout
          try {
            await application
              .get('TtsInferenceService')
              .synthesize(bundleId, { text: input.text, voice: String(speaker), language, speed, outputPath }, signal)
          } catch (error) {
            if (timeout.aborted && !input.abortSignal?.aborted) throw new VoiceRuntimeError('timeout')
            throw error
          }
          checkAbort(input.abortSignal)
          const audio = new Uint8Array(await readFile(outputPath))
          checkAbort(input.abortSignal)
          return { audio, warnings: [], response: { timestamp: new Date(), modelId } }
        },
        input.abortSignal,
        normalizeFailure
      )
    }
  }
}

function speechDefinition(id: SherpaSpeechId): SpeechModelDefinition {
  const bundleId = DOWNLOADABLE_SPEECH_BUNDLES[id]
  const voices = voicesFor(id)
  return {
    id,
    adapterId: 'sherpa',
    support: sherpaVoiceSupport,
    describe: () => ({
      ...LOCAL_VOICE_MODELS.find((model) => model.id === id)!,
      localeSelection: null,
      resourceOperations: sherpaResources
    }),
    status: (_options, signal) => sherpaBundleStatus(bundleId, signal),
    speechOperations: [completeSpeechOperation((options) => createSherpaSpeechModel(id, options))],
    voices: async (signal) => {
      checkAbort(signal)
      return voices
    },
    getDefaultVoice: async (language, signal) => {
      checkAbort(signal)
      if (language && !voices.some((voice) => voice.languages?.includes(language))) return null
      return voices.find((voice) => voice.locale === language) ?? voices[0]
    },
    ...sherpaBundleOperations(bundleId)
  }
}

export const kokoroSpeechDefinition = speechDefinition(KOKORO_TTS_MODEL_ID)
export const css10SpeechDefinition = speechDefinition(CSS10_TTS_MODEL_ID)
