import { application } from '@application'
import { loggerService } from '@logger'
import { cherryInOAuthService } from '@main/services/oauth/CherryInOAuthService'
import type { ProviderQuotaReport } from '@shared/ipc/schemas/providerQuota'
import { supportsProviderQuota } from '@shared/utils/providerQuota'

import { getClaudeQuota } from './claudeQuota'
import { getCodexQuota } from './codexQuota'
import { unavailableQuota } from './normalizeQuota'

const logger = loggerService.withContext('ProviderQuota')
const pending = new Map<string, Promise<ProviderQuotaReport>>()

async function read(providerId: string): Promise<ProviderQuotaReport> {
  if (!supportsProviderQuota(providerId)) return unavailableQuota(providerId, 'unsupported')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  timeout.unref()
  try {
    if (providerId === 'cherryin') {
      if (!(await application.get('OAuthRuntimeService').hasToken(providerId)))
        return unavailableQuota(providerId, 'signed-out')
      const raw = await cherryInOAuthService.getQuotaSnapshot('https://open.cherryin.ai', controller.signal)
      return {
        status: 'available',
        providerId,
        source: 'cherryin-oauth',
        accountLabel: 'CherryIN',
        plan: null,
        fetchedAt: new Date().toISOString(),
        ordinaryUsageAllowed: null,
        windows: [],
        resetCredits: null,
        balances: [
          {
            id: 'cherryin-balance',
            kind: 'credits',
            label: null,
            balance: String(raw.quota),
            used: String(raw.used_quota),
            limit: null,
            currency: null,
            unlimited: null,
            enabled: null,
            remainingPercent: null,
            resetsAt: null
          }
        ]
      }
    }
    return await (providerId === 'openai-codex' ? getCodexQuota(controller.signal) : getClaudeQuota(controller))
  } catch {
    logger.warn('Provider quota request failed', { providerId })
    return unavailableQuota(providerId, 'failed')
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}

export function readProviderQuota(providerId: string): Promise<ProviderQuotaReport> {
  const existing = pending.get(providerId)
  if (existing) return existing
  const request = read(providerId).finally(() => pending.delete(providerId))
  pending.set(providerId, request)
  return request
}
