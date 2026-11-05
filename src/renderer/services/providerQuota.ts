import { ipcApi } from '@renderer/ipc'
import type { ProviderQuotaReport } from '@shared/ipc/schemas/providerQuota'

export async function requestProviderQuota(providerId: string): Promise<ProviderQuotaReport> {
  try {
    const report = await ipcApi.request('provider.quota.read', { providerId })
    if (report.providerId === providerId) return report
  } catch {
    // Surface the same unavailable state as a failed read in the main process.
  }
  return { providerId, status: 'unavailable', reason: 'failed' }
}
