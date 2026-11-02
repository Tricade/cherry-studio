import { StringDecoder } from 'node:string_decoder'

import { app } from 'electron'

import { application } from '@application'
import { mergeBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { crossPlatformSpawn, killProcessTree } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import type { ProviderQuotaReport } from '@shared/ipc/schemas/providerQuota'

import { normalizeCodexQuota, unavailableQuota } from './normalizeQuota'

export function readCodexRateLimits(
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  signal: AbortSignal
): Promise<unknown> {
  signal.throwIfAborted()
  const child = crossPlatformSpawn(
    command,
    [
      '-c',
      'analytics.enabled=false',
      '-c',
      'feedback.enabled=false',
      '-c',
      'otel.exporter="none"',
      '-c',
      'otel.trace_exporter="none"',
      '-c',
      'otel.metrics_exporter="none"',
      'app-server',
      '--stdio'
    ],
    { env, cwd, stdio: ['pipe', 'pipe', 'ignore'], detached: process.platform !== 'win32' }
  )

  return new Promise<unknown>((resolve, reject) => {
    let settled = false
    let initialized = false
    let buffered = ''
    let received = 0
    const decoder = new StringDecoder('utf8')
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (child.exitCode === null && child.signalCode === null) killProcessTree(child)
      if (error) reject(error)
      else resolve(result)
    }
    const abort = () => finish(new Error('Quota request cancelled'))
    const send = (message: unknown) => child.stdin?.write(JSON.stringify(message) + '\n')
    child.on('error', () => finish(new Error('Codex quota process failed')))
    child.on('close', () => finish(new Error('Codex quota process closed without a result')))
    child.stdin?.on('error', () => finish(new Error('Codex quota input failed')))
    signal.addEventListener('abort', abort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return
      received += chunk.length
      if (received > 4 * 1024 * 1024) {
        finish(new Error('Codex quota response is too large'))
        return
      }
      buffered += decoder.write(chunk)
      let boundary: number
      while (!settled && (boundary = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, boundary).trim()
        buffered = buffered.slice(boundary + 1)
        if (!line) continue
        let message: { id?: unknown; method?: unknown; result?: unknown; error?: unknown }
        try {
          message = JSON.parse(line)
        } catch {
          finish(new Error('Invalid Codex quota response'))
          return
        }
        if (!message || typeof message !== 'object') {
          finish(new Error('Invalid Codex quota response'))
          return
        }
        if (message.method && message.id !== undefined) {
          send({ id: message.id, error: { code: -32601, message: 'Read-only quota client' } })
          finish(new Error('Unexpected Codex server request'))
          return
        }
        if (message.id === 1 && !initialized) {
          if (message.error || !message.result) {
            finish(new Error('Codex initialization failed'))
            return
          }
          initialized = true
          send({ method: 'initialized', params: {} })
          send({ id: 2, method: 'account/rateLimits/read', params: {} })
        } else if (message.id === 2 && initialized) {
          if (message.error) finish(new Error('Codex quota is unavailable'))
          else finish(undefined, message.result)
        }
      }
    })
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'cherry_studio_usage', title: 'Cherry Studio Usage', version: app.getVersion() },
        capabilities: { experimentalApi: false }
      }
    })
  })
}

export async function getCodexQuota(signal: AbortSignal): Promise<ProviderQuotaReport> {
  const oauth = application.get('OAuthRuntimeService')
  const accountId = (await oauth.getAccount('openai-codex')).accountId
  if (!accountId || !(await oauth.hasToken('openai-codex'))) return unavailableQuota('openai-codex', 'signed-out')
  const snapshot = (await application.get('BinaryManager').getToolSnapshots(['codex'])).codex
  if (!snapshot || snapshot.availability.source === 'none') return unavailableQuota('openai-codex', 'cli-unavailable')
  const shellEnv = await getShellEnv(signal)
  const env =
    snapshot.availability.source === 'system'
      ? shellEnv
      : mergeBinaryExecutionEnv(shellEnv, [application.getPath('cherry.bin')])
  const response = await readCodexRateLimits(
    snapshot.availability.path,
    env,
    application.getPath('feature.cli.temp'),
    signal
  )
  if ((await oauth.getAccount('openai-codex')).accountId !== accountId || !(await oauth.hasToken('openai-codex'))) {
    return unavailableQuota('openai-codex', 'account-mismatch')
  }
  return normalizeCodexQuota(response, accountId)
}
