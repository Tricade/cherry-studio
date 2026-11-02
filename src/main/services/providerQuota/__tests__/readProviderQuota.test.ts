import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProviderQuotaReport } from '@shared/ipc/schemas/providerQuota'

import { readProviderQuota } from '../readProviderQuota'

const transport = vi.hoisted(() => ({ codex: vi.fn(), claude: vi.fn() }))
vi.mock('../codexQuota', () => ({ getCodexQuota: transport.codex }))
vi.mock('../claudeQuota', () => ({ getClaudeQuota: transport.claude }))

describe('quota request ownership', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.useRealTimers())

  it('does not start external transports for unsupported sign-ins', async () => {
    await expect(readProviderQuota('github-copilot')).resolves.toEqual({
      providerId: 'github-copilot',
      status: 'unavailable',
      reason: 'unsupported'
    })
    expect(transport.codex).not.toHaveBeenCalled()
    expect(transport.claude).not.toHaveBeenCalled()
  })

  it('coalesces concurrent reads but lets a subsequent refresh recover after a failure', async () => {
    let fail!: (error: Error) => void
    transport.codex.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject
      })
    )
    const first = readProviderQuota('openai-codex')
    const second = readProviderQuota('openai-codex')
    fail(new Error('transport unavailable'))
    expect(await Promise.all([first, second])).toEqual([
      { providerId: 'openai-codex', status: 'unavailable', reason: 'failed' },
      { providerId: 'openai-codex', status: 'unavailable', reason: 'failed' }
    ])
    expect(transport.codex).toHaveBeenCalledTimes(1)
    transport.codex.mockResolvedValueOnce({
      providerId: 'openai-codex',
      status: 'unavailable',
      reason: 'signed-out'
    } satisfies ProviderQuotaReport)
    await expect(readProviderQuota('openai-codex')).resolves.toMatchObject({ reason: 'signed-out' })
    expect(transport.codex).toHaveBeenCalledTimes(2)
  })

  it('cancels a stalled transport after the request deadline', async () => {
    vi.useFakeTimers()
    let aborted = false
    transport.codex.mockImplementationOnce(
      (signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(new Error('cancelled'))
            },
            { once: true }
          )
        })
    )
    const request = readProviderQuota('openai-codex')
    await vi.advanceTimersByTimeAsync(30_000)
    await expect(request).resolves.toMatchObject({ status: 'unavailable', reason: 'failed' })
    expect(aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
