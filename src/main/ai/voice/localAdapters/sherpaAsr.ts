import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { TranscriptionModelV3 } from '@ai-sdk/provider'

import { application } from '@application'
import type { TranscriptionOptions } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { UtilityProcessError } from '@main/core/utilityProcess/UtilityProcessError'
import {
  DOWNLOADABLE_TRANSCRIPTION_BUNDLES,
  FUNASR_MODEL_ID,
  LOCAL_VOICE_MODELS,
  WHISPER_ASR_MODEL_ID
} from '@shared/ai/localVoice'

import type { TranscriptionModelDefinition } from '../voiceModelTypes'
import { checkAbort, VoiceRuntimeError } from '../VoiceRuntimeError'
import { inspectCanonicalWav } from './inspectCanonicalWav'
import { decodeVoiceRecording } from './recordingDecoder'
import { withScratch } from './scratch'
import { completeTranscriptionOperation } from './sdkOperations'
import { sherpaBundleOperations, sherpaBundleStatus, sherpaResources, sherpaVoiceSupport } from './sherpaResources'

type SherpaAsrId = typeof FUNASR_MODEL_ID | typeof WHISPER_ASR_MODEL_ID

function supportsLanguage(modelId: SherpaAsrId, language?: string) {
  return !language || (modelId === WHISPER_ASR_MODEL_ID && /^de(?:-|$)/i.test(language))
}

const ASR_INFERENCE_TIMEOUT_MS = 120_000
// Deadline ceiling for recordings longer than the fixed floor: twice the audio
// duration, so a slow machine still finishes instead of failing with a retry
// that can never succeed.
const ASR_INFERENCE_REALTIME_FACTOR = 2
const logger = loggerService.withContext('FunAsrAdapter')

function normalizeFailure(error: unknown, signal?: AbortSignal): VoiceRuntimeError {
  if (signal?.aborted) return new VoiceRuntimeError('aborted')
  if (error instanceof VoiceRuntimeError) return error
  if (error instanceof UtilityProcessError && error.code === 'PROCESS_BLOCKED') return new VoiceRuntimeError('busy')
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ASR_MODEL_LOAD_FAILED')
    return new VoiceRuntimeError('model_load_failed')
  if (
    error instanceof UtilityProcessError &&
    typeof error.remote?.code === 'string' &&
    ['VOICE_AUDIO_INVALID', 'VOICE_AUDIO_UNSUPPORTED', 'VOICE_AUDIO_LIMIT'].includes(error.remote.code)
  )
    return new VoiceRuntimeError('invalid_audio')
  if (error instanceof UtilityProcessError && error.remote?.code === 'ASR_MODEL_LOAD_FAILED')
    return new VoiceRuntimeError('model_load_failed')
  if (
    error instanceof UtilityProcessError &&
    ['PROCESS_START_FAILED', 'PROCESS_EXITED', 'PROCESS_PROTOCOL_ERROR', 'PROCESS_CIRCUIT_OPEN'].includes(error.code)
  )
    return new VoiceRuntimeError('worker_crashed')
  return new VoiceRuntimeError('operation_failed')
}

export function createSherpaTranscriptionModel(
  modelId: SherpaAsrId,
  options: TranscriptionOptions
): TranscriptionModelV3 {
  const bundleId = DOWNLOADABLE_TRANSCRIPTION_BUNDLES[modelId]
  return {
    specificationVersion: 'v3',
    provider: 'local-voice',
    modelId,
    async doGenerate(input) {
      if (!supportsLanguage(modelId, options.language)) throw new VoiceRuntimeError('invalid_request')
      if (!(input.audio instanceof Uint8Array)) throw new VoiceRuntimeError('invalid_audio')
      const audio = input.audio
      const isWebm = ['audio/webm', 'audio/webm;codecs=opus'].includes(input.mediaType)
      const wavMetadata = input.mediaType === 'audio/wav' ? inspectCanonicalWav(audio) : undefined
      if (!isWebm && !wavMetadata) throw new VoiceRuntimeError('invalid_audio')
      const status = sherpaBundleStatus(bundleId, input.abortSignal)
      if (status.status !== 'ready') throw new VoiceRuntimeError(status.reason ?? 'operation_failed')
      return withScratch(
        async (directory) => {
          let wavBytes: Uint8Array
          let durationSeconds: number
          if (wavMetadata) {
            wavBytes = audio
            durationSeconds = wavMetadata.durationSeconds
          } else {
            const decoded = await decodeVoiceRecording(audio, input.abortSignal)
            wavBytes = decoded.wav
            durationSeconds = decoded.durationSeconds
          }
          checkAbort(input.abortSignal)
          const inputPath = join(directory, 'input.wav')
          await writeFile(inputPath, wavBytes, { mode: 0o600 })
          // Inference is chunked CPU work whose cost scales with the recording;
          // the fixed floor only covers short clips, so longer recordings get
          // realtime-factor headroom instead of a deadline they cannot meet.
          // AbortSignal.timeout rejects fractional milliseconds.
          const inferenceTimeout = AbortSignal.timeout(
            Math.max(ASR_INFERENCE_TIMEOUT_MS, Math.ceil(durationSeconds * 1_000 * ASR_INFERENCE_REALTIME_FACTOR))
          )
          const inferenceSignal = input.abortSignal
            ? AbortSignal.any([input.abortSignal, inferenceTimeout])
            : inferenceTimeout
          const transcript = await application
            .get('AsrInferenceService')
            .transcribe(bundleId, { kind: 'wav', filePath: inputPath }, inferenceSignal)
            .catch((error: unknown) => {
              if (inferenceTimeout.aborted && !input.abortSignal?.aborted) throw new VoiceRuntimeError('timeout')
              throw error
            })
          checkAbort(input.abortSignal)
          logger.debug('Local transcription completed', {
            modelId,
            status: 'completed',
            durationSeconds,
            segmentCount: transcript.segments.length,
            transcriptNonEmpty: transcript.text.length > 0
          })
          return {
            text: transcript.text,
            segments: transcript.segments.map((segment) => ({
              text: segment.text,
              startSecond: segment.start,
              endSecond: segment.end
            })),
            language: modelId === WHISPER_ASR_MODEL_ID ? 'de' : undefined,
            durationInSeconds: durationSeconds,
            warnings: [],
            response: { timestamp: new Date(), modelId }
          }
        },
        input.abortSignal,
        normalizeFailure
      )
    }
  }
}

function transcriptionDefinition(id: SherpaAsrId): TranscriptionModelDefinition {
  const bundleId = DOWNLOADABLE_TRANSCRIPTION_BUNDLES[id]
  return {
    id,
    adapterId: id === FUNASR_MODEL_ID ? 'funasr' : 'whisper',
    support: sherpaVoiceSupport,
    describe: () => ({
      ...LOCAL_VOICE_MODELS.find((model) => model.id === id)!,
      localeSelection: id === WHISPER_ASR_MODEL_ID ? { defaultLocale: 'de-DE' } : null,
      resourceOperations: sherpaResources
    }),
    status: ({ language }, signal) =>
      supportsLanguage(id, language)
        ? sherpaBundleStatus(bundleId, signal)
        : { status: 'unsupported', reason: 'unsupported' },
    locales: async (signal) => {
      checkAbort(signal)
      if (id !== WHISPER_ASR_MODEL_ID) return { supported: [], installed: [] }
      return {
        supported: ['de-DE'],
        installed: sherpaBundleStatus(bundleId, signal).status === 'ready' ? ['de-DE'] : []
      }
    },
    transcriptionOperations: [completeTranscriptionOperation((options) => createSherpaTranscriptionModel(id, options))],
    ...sherpaBundleOperations(bundleId)
  }
}

export const funAsrTranscriptionDefinition = transcriptionDefinition(FUNASR_MODEL_ID)
export const whisperTranscriptionDefinition = transcriptionDefinition(WHISPER_ASR_MODEL_ID)
