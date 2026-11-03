import { application } from '@application'
import { regionService } from '@main/services/RegionService'
import { SHERPA_VOICE_SUPPORTED_PLATFORM_KEYS, VoiceModelSupport, VoiceResourceOperation } from '@shared/ai/localVoice'
import { LOCAL_MODEL_STATUS_CACHE_KEY, type LocalModelBundleId } from '@shared/data/presets/localModel'

import type { LocalVoiceStatus } from '../voiceModelTypes'
import type { VoiceEnvironment } from '../voicePlatform'
import { checkAbort, VoiceRuntimeError } from '../VoiceRuntimeError'

export function sherpaVoiceSupport({ platform, arch }: VoiceEnvironment) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) return VoiceModelSupport.UnsupportedPlatform
  return SHERPA_VOICE_SUPPORTED_PLATFORM_KEYS.some((key) => key === platform + '-' + arch)
    ? VoiceModelSupport.Supported
    : VoiceModelSupport.UnsupportedArchitecture
}

export const sherpaResources = [
  VoiceResourceOperation.Download,
  VoiceResourceOperation.CancelDownload,
  VoiceResourceOperation.Remove
]

export function sherpaBundleStatus(bundleId: LocalModelBundleId, signal?: AbortSignal): LocalVoiceStatus {
  checkAbort(signal)
  const { status } = application.get('LocalModelService').refreshStatus(bundleId)
  switch (status) {
    case 'not_downloaded':
      return { status: 'not_installed', reason: 'model_required' }
    case 'downloading':
      return {
        status: 'installing',
        reason: 'model_required',
        percent: application.get('CacheService').getShared(LOCAL_MODEL_STATUS_CACHE_KEY)?.[bundleId]?.percent ?? 0
      }
    case 'ready':
      return { status: 'ready' }
    case 'error':
      return { status: 'failed', reason: 'download_failed' }
    case 'unsupported':
      return { status: 'unsupported', reason: 'unsupported' }
  }
}

export function sherpaBundleOperations(bundleId: LocalModelBundleId) {
  return {
    download: () =>
      application
        .get('LocalModelService')
        .download(bundleId, async () => ((await regionService.isInChina()) ? 'china-first' : 'global-first'))
        .catch(() => {
          throw new VoiceRuntimeError('download_failed')
        }),
    cancelDownload: () => application.get('LocalModelService').cancel(bundleId),
    remove: () => application.get('LocalModelService').remove(bundleId)
  }
}
