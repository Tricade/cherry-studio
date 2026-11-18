import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getCodexQuota } from '../codexQuota'

const fetchQuota = vi.hoisted(() => vi.fn())
vi.mock('@main/ai/utils/customFetch', () => ({ customFetch: fetchQuota }))

const usageUrl = 'https://chatgpt.com/backend-api/wham/usage'
const creditsUrl = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'
const providerId = 'openai-codex'
const getAccount = vi.fn()
const hasToken = vi.fn()
type BuildRequest = (credentials: { accountId: string; accessToken: string }) => { input: string; init: RequestInit }
const authenticatedFetch = vi.fn(async (_provider: string, buildRequest: BuildRequest, send: typeof fetchQuota) => {
  const request = buildRequest({ accountId: 'account-a', accessToken: 'fixture-token' })
  return send(request.input, request.init)
})

describe('Codex account quota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAccount.mockResolvedValue({ accountId: 'account-a' })
    hasToken.mockResolvedValue(true)
    MockApplicationUtils.setService('OAuthRuntimeService', { getAccount, hasToken, authenticatedFetch })
  })
  afterEach(() => MockApplicationUtils.resetServices())

  it('reads usage and earned resets with the app account on fixed read-only URLs', async () => {
    const signal = new AbortController().signal
    fetchQuota
      .mockResolvedValueOnce(
        Response.json({
          account_id: 'account-a',
          rate_limit: { allowed: true, primary_window: { used_percent: 24, limit_window_seconds: 18000 } },
          rate_limit_reset_credits: { available_count: 1 }
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          available_count: 1,
          credits: [{ id: 'reset', status: 'available', expires_at: '2026-12-01T00:00:00Z' }]
        })
      )
    await expect(getCodexQuota(signal)).resolves.toMatchObject({
      status: 'available',
      source: 'codex-oauth',
      windows: [{ usedPercent: 24, durationMinutes: 300 }],
      resetCredits: { availableCount: 1, details: [{ id: 'reset', expiresAt: '2026-12-01T00:00:00.000Z' }] }
    })
    expect(fetchQuota.mock.calls.map(([url]) => url)).toEqual([usageUrl, creditsUrl])
    for (const [, init] of fetchQuota.mock.calls) {
      expect(init).toMatchObject({
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { Authorization: 'Bearer fixture-token', 'ChatGPT-Account-Id': 'account-a' }
      })
      expect(init.body).toBeUndefined()
    }
  })

  it('discards results if the app account changes while reading', async () => {
    getAccount.mockResolvedValueOnce({ accountId: 'account-a' }).mockResolvedValue({ accountId: 'account-b' })
    fetchQuota.mockResolvedValueOnce(
      Response.json({
        rate_limit: { primary_window: { used_percent: 50 } },
        rate_limit_reset_credits: { available_count: 0 }
      })
    )
    await expect(getCodexQuota(new AbortController().signal)).resolves.toEqual({
      status: 'unavailable',
      providerId,
      reason: 'account-mismatch'
    })
    expect(fetchQuota).toHaveBeenCalledTimes(1)
  })

  it('preserves usage when reset-credit details are unavailable', async () => {
    fetchQuota
      .mockResolvedValueOnce(
        Response.json({
          rate_limit: { primary_window: { used_percent: 0 } },
          rate_limit_reset_credits: { available_count: 1 }
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(getCodexQuota(new AbortController().signal)).resolves.toMatchObject({
      status: 'available',
      windows: [{ usedPercent: 0 }],
      resetCredits: { availableCount: 1, details: null }
    })
  })

  it('does not contact the provider while signed out', async () => {
    getAccount.mockResolvedValue({ accountId: null })
    await expect(getCodexQuota(new AbortController().signal)).resolves.toEqual({
      status: 'unavailable',
      providerId,
      reason: 'signed-out'
    })
    expect(authenticatedFetch).not.toHaveBeenCalled()
  })

  it('stops reading a body above the response size limit', async () => {
    const cancel = vi.fn()
    fetchQuota.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024 + 1))
          },
          cancel
        })
      )
    )
    await expect(getCodexQuota(new AbortController().signal)).rejects.toThrow('too large')
    expect(cancel).toHaveBeenCalledOnce()
  })
})
