import { describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'

import { DEFAULT_AGENT_CONTEXT_WINDOW, resolveAgentContextWindow } from '../agentContextWindow'

const modelWith = (contextWindow: unknown) => ({ id: 'p::m', contextWindow }) as unknown as Model

describe('resolveAgentContextWindow', () => {
  it('keeps a declared positive window', () => {
    expect(resolveAgentContextWindow(modelWith(128_000))).toBe(128_000)
  })

  it('uses an input-only limit conservatively without adding the output allowance', () => {
    const model = { ...modelWith(undefined), maxInputTokens: 32_768, maxOutputTokens: 16_384 }
    expect(resolveAgentContextWindow(model)).toBe(32_768)
    expect(resolveAgentContextWindow({ ...model, contextWindow: 65_536 })).toBe(32_768)
    expect(resolveAgentContextWindow({ ...model, contextWindow: 16_384 })).toBe(16_384)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '32768'])(
    'does not use an invalid input limit %p',
    (maxInputTokens) => {
      expect(resolveAgentContextWindow({ ...modelWith(undefined), maxInputTokens } as Model)).toBe(
        DEFAULT_AGENT_CONTEXT_WINDOW
      )
    }
  )

  // A non-positive or non-finite window would make Pi compact immediately or never.
  it.each([undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '200000'])(
    'falls back to the default for %p',
    (contextWindow) => {
      expect(resolveAgentContextWindow(modelWith(contextWindow))).toBe(DEFAULT_AGENT_CONTEXT_WINDOW)
    }
  )
})
