import { application } from '@application'
import { customFetch } from '@main/ai/utils/customFetch'
import { OPENAI_CODEX_PROVIDER_ID } from '@shared/data/presets/codex'
import type { ProviderQuotaReport } from '@shared/ipc/schemas/providerQuota'

import { normalizeCodexQuota, normalizeCodexResetCredits, unavailableQuota } from './normalizeQuota'

const CODEX_USAGE_BASE = 'https://chatgpt.com/backend-api/wham'
const MAX_QUOTA_RESPONSE_BYTES = 1024 * 1024

async function readQuotaResponse(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error('Codex quota response is unavailable')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let json = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_QUOTA_RESPONSE_BYTES) throw new Error('Codex quota response is too large')
      json += decoder.decode(value, { stream: true })
    }
    return JSON.parse(json + decoder.decode())
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export async function getCodexQuota(signal: AbortSignal): Promise<ProviderQuotaReport> {
  const providerId = OPENAI_CODEX_PROVIDER_ID
  const oauth = application.get('OAuthRuntimeService')
  const { accountId } = await oauth.getAccount(providerId)
  if (!accountId || !(await oauth.hasToken(providerId))) return unavailableQuota(providerId, 'signed-out')

  // These read endpoints are used by the legacy Codex account client. Keep the
  // credential on the same origin as Cherry's existing Codex OAuth transport.
  const read = async (endpoint: 'usage' | 'rate-limit-reset-credits', requestSignal: AbortSignal) => {
    const response = await oauth.authenticatedFetch(
      providerId,
      (credentials) => {
        requestSignal.throwIfAborted()
        if (credentials.accountId !== accountId) throw new Error('Codex account changed')
        return {
          input: `${CODEX_USAGE_BASE}/${endpoint}`,
          init: {
            method: 'GET',
            credentials: 'omit',
            cache: 'no-store',
            redirect: 'error',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${credentials.accessToken}`,
              'ChatGPT-Account-Id': accountId
            },
            signal: requestSignal
          }
        }
      },
      customFetch
    )
    return readQuotaResponse(response)
  }

  const accountChanged = async () =>
    (await oauth.getAccount(providerId)).accountId !== accountId || !(await oauth.hasToken(providerId))
  try {
    const report = normalizeCodexQuota(await read('usage', signal), accountId)
    if (report.status === 'available' && report.resetCredits?.availableCount !== 0) {
      const details = await read('rate-limit-reset-credits', AbortSignal.any([signal, AbortSignal.timeout(5000)]))
        .then(normalizeCodexResetCredits)
        .catch(() => null)
      if (details) report.resetCredits = details
    }
    signal.throwIfAborted()
    return (await accountChanged()) ? unavailableQuota(providerId, 'account-mismatch') : report
  } catch (error) {
    if (await accountChanged()) return unavailableQuota(providerId, 'account-mismatch')
    throw error
  }
}
