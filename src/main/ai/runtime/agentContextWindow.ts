/**
 * Runtime-neutral context-window fallback for agent runtimes, which
 * need a compaction boundary even when Cherry's model row declares none. Model
 * filtering no longer gates on the window, so this stays main-side.
 */

import type { Model } from '@shared/data/types/model'

/** Decimal 256K: a model whose real window is 256K never overflows this boundary. */
export const DEFAULT_AGENT_CONTEXT_WINDOW = 256_000

/** Honor both declared limits conservatively at runtime without storing or summing an inferred window. */
export function resolveAgentContextWindow(model: Model): number {
  const limits = [model.contextWindow, model.maxInputTokens].filter(
    (limit): limit is number => typeof limit === 'number' && Number.isFinite(limit) && limit > 0
  )
  return limits.length > 0 ? Math.min(...limits) : DEFAULT_AGENT_CONTEXT_WINDOW
}
