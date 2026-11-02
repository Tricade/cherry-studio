import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getCodexQuota, readCodexRateLimits } from '../codexQuota'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), kill: vi.fn(), shellEnv: vi.fn() }))
vi.mock('@main/utils/processRunner', () => ({ crossPlatformSpawn: mocks.spawn, killProcessTree: mocks.kill }))
vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: mocks.shellEnv }))

function processFixture() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    exitCode: null,
    signalCode: null
  })
}

describe('Codex read-only quota protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.shellEnv.mockResolvedValue({ PATH: '/test/bin' })
  })
  afterEach(() => {
    MockApplicationUtils.resetServices()
  })

  it('uses only initialize and quota read, disables telemetry, and closes its process after the response', async () => {
    const child = processFixture()
    mocks.spawn.mockReturnValue(child)
    const sent: { id?: number; method: string; params?: unknown }[] = []
    child.stdin.on('data', (chunk) => sent.push(JSON.parse(chunk.toString())))
    const result = readCodexRateLimits('/test/codex', {}, '/test/neutral', new AbortController().signal)
    expect(sent[0].method).toBe('initialize')
    expect(sent).toHaveLength(1)
    child.stdout.write('{"id":1,"result":{"userAgent":"codex/0.166.0-alpha.5.1"}}\n')
    expect(sent.map((request) => request.method)).toEqual(['initialize', 'initialized', 'account/rateLimits/read'])
    expect(sent[2].params).toEqual({})
    child.stdout.write('{"method":"account/updated","params":{}}\n')
    const response = { accountId: 'account-a', rateLimits: { limitName: 'Modèle partagé' } }
    const bytes = Buffer.from(JSON.stringify({ id: 2, result: response }) + '\n')
    const split = bytes.indexOf(Buffer.from('è')) + 1
    child.stdout.write(bytes.subarray(0, split))
    child.stdout.write(bytes.subarray(split))
    await expect(result).resolves.toEqual(response)
    expect(mocks.kill).toHaveBeenCalledWith(child)
    const args = mocks.spawn.mock.calls[0][1] as string[]
    expect(args).toEqual(
      expect.arrayContaining(['analytics.enabled=false', 'feedback.enabled=false', 'otel.metrics_exporter="none"'])
    )
    expect(sent.some((request) => /consume|redeem|thread\/|turn\//.test(request.method))).toBe(false)
  })

  it('terminates a stalled process on cancellation and rejects server-initiated actions', async () => {
    const first = processFixture()
    mocks.spawn.mockReturnValueOnce(first)
    const controller = new AbortController()
    const result = readCodexRateLimits('/test/codex', {}, '/test/neutral', controller.signal)
    controller.abort()
    await expect(result).rejects.toThrow('cancelled')
    expect(mocks.kill).toHaveBeenCalledWith(first)

    const second = processFixture()
    mocks.spawn.mockReturnValueOnce(second)
    const next = readCodexRateLimits('/test/codex', {}, '/test/neutral', new AbortController().signal)
    second.stdout.write('{"id":99,"method":"execCommandApproval","params":{}}\n')
    await expect(next).rejects.toThrow('Unexpected Codex server request')
    expect(mocks.kill).toHaveBeenCalledWith(second)
  })

  it('withholds a completed request when Cherry signs out during the read', async () => {
    const account = { accountId: 'account-a' as string | null }
    MockApplicationUtils.setService('OAuthRuntimeService', {
      getAccount: async () => account,
      hasToken: async () => account.accountId !== null
    })
    MockApplicationUtils.setService('BinaryManager', {
      getToolSnapshots: async () => ({ codex: { availability: { source: 'system', path: '/test/codex' } } })
    })
    const child = processFixture()
    mocks.spawn.mockReturnValue(child)
    const result = getCodexQuota(new AbortController().signal)
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled())
    child.stdout.write('{"id":1,"result":{}}\n')
    account.accountId = null
    child.stdout.write('{"id":2,"result":{"accountId":"account-a","rateLimits":{"primary":{"usedPercent":50}}}}\n')
    await expect(result).resolves.toEqual({
      providerId: 'openai-codex',
      status: 'unavailable',
      reason: 'account-mismatch'
    })
  })

  it('does not start or install a CLI when no matching Cherry login exists', async () => {
    MockApplicationUtils.setService('OAuthRuntimeService', { getAccount: async () => ({ accountId: null }) })
    await expect(getCodexQuota(new AbortController().signal)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'signed-out'
    })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})
