import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getClaudeQuota } from '../claudeQuota'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  shellEnv: vi.fn(),
  close: vi.fn(),
  usage: vi.fn(),
  initialize: vi.fn()
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: mocks.shellEnv, refreshShellEnv: mocks.shellEnv }))
vi.mock(import('@main/services/proxy/proxyEnv'), async (importOriginal) => ({
  ...(await importOriginal()),
  getProxyEnvironment: () => ({})
}))

describe('Claude quota query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockApplicationUtils.setService('CodeCliService', { checkClaudeLogin: async () => true })
    MockApplicationUtils.setService('ClaudeCodeBinaryService', { requireExecutable: () => '/test/claude' })
    mocks.shellEnv.mockResolvedValue({
      CLAUDE_CONFIG_DIR: '/test/cli-profile',
      ANTHROPIC_API_KEY: 'unrelated-api-key',
      ANTHROPIC_BASE_URL: 'https://unrelated.invalid',
      CLAUDE_CODE_OAUTH_TOKEN: 'unrelated-token'
    })
    mocks.initialize.mockResolvedValue({ account: { apiProvider: 'firstParty', email: 'person@example.invalid' } })
    mocks.usage.mockResolvedValue({
      rate_limits_available: true,
      subscription_type: 'max',
      rate_limits: { five_hour: { utilization: 15, resets_at: null } }
    })
    mocks.query.mockReturnValue({
      initializationResult: mocks.initialize,
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: mocks.usage,
      close: mocks.close
    })
  })
  afterEach(() => MockApplicationUtils.resetServices())

  it('queries the CLI profile without yielding a prompt, scanning transcripts or enabling user tools/settings', async () => {
    const result = await getClaudeQuota(new AbortController())
    expect(result).toMatchObject({
      status: 'available',
      accountLabel: 'person@example.invalid',
      windows: [{ usedPercent: 15 }]
    })
    const { options, prompt } = mocks.query.mock.calls[0][0]
    expect(await prompt[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined })
    expect(options).toMatchObject({
      persistSession: false,
      settingSources: [],
      tools: [],
      plugins: [],
      hooks: {},
      settings: { disableAllHooks: true },
      mcpServers: {},
      strictMcpConfig: true
    })
    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(options.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(options.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(options.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
    expect(mocks.usage).toHaveBeenCalledWith({ skipBehaviors: true })
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('closes an unsuccessful query and never represents another backend as subscription usage', async () => {
    mocks.initialize.mockResolvedValueOnce({ account: { apiProvider: 'bedrock' } })
    await expect(getClaudeQuota(new AbortController())).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'no-data'
    })
    expect(mocks.usage).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalledOnce()
    mocks.usage.mockRejectedValueOnce(new Error('Quota transport failed'))
    await expect(getClaudeQuota(new AbortController())).rejects.toThrow('Quota transport failed')
    expect(mocks.close).toHaveBeenCalledTimes(2)
  })
})
