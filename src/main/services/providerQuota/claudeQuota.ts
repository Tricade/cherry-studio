import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'
import {
  applyClaudeCliLoginEnvironment,
  getClaudeCodeLoginShellEnvironment,
  resolveClaudeExecutablePath,
  spawnClaudeCodeProcess
} from '@main/ai/runtime/claudeCode'
import { getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import type { ProviderQuotaReport } from '@shared/ipc/schemas/providerQuota'

import { normalizeClaudeQuota, unavailableQuota } from './normalizeQuota'

export async function getClaudeQuota(controller: AbortController): Promise<ProviderQuotaReport> {
  const signal = controller.signal
  if (!(await application.get('CodeCliService').checkClaudeLogin(signal)))
    return unavailableQuota('claude-code', 'signed-out')
  let executable: string
  try {
    executable = resolveClaudeExecutablePath()
  } catch {
    return unavailableQuota('claude-code', 'cli-unavailable')
  }
  const proxy = getProxyEnvironment(process.env)
  const loginShellEnv = await getClaudeCodeLoginShellEnvironment(proxy)
  signal.throwIfAborted()
  const env = {
    ...loginShellEnv,
    ...proxy,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_USE_BEDROCK: '0',
    CLAUDE_CODE_USE_VERTEX: '0',
    ELECTRON_NO_ATTACH_CONSOLE: '1'
  }
  applyClaudeCliLoginEnvironment(env, loginShellEnv)
  let releaseInput!: () => void
  const heldInput = new Promise<void>((resolve) => {
    releaseInput = resolve
  })
  const prompt: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await heldInput
        return { done: true, value: undefined }
      }
    })
  }
  const connection = query({
    prompt,
    options: {
      pathToClaudeCodeExecutable: executable,
      spawnClaudeCodeProcess,
      abortController: controller,
      env,
      cwd: application.getPath('feature.cli.temp'),
      persistSession: false,
      settingSources: [],
      systemPrompt: '',
      tools: [],
      allowedTools: [],
      hooks: {},
      settings: { disableAllHooks: true },
      plugins: [],
      mcpServers: {},
      strictMcpConfig: true
    }
  })
  try {
    const initialization = await connection.initializationResult()
    if (initialization.account.apiProvider !== 'firstParty') return unavailableQuota('claude-code', 'no-data')
    const usage = await connection.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
    return normalizeClaudeQuota(
      usage,
      initialization.account.email ?? initialization.account.organization ?? 'Claude Code'
    )
  } finally {
    releaseInput()
    connection.close()
  }
}
