import * as z from 'zod'

import type { AvailableProviderQuota, ProviderQuotaReport } from '@shared/ipc/schemas/providerQuota'
import { ProviderQuotaReportSchema } from '@shared/ipc/schemas/providerQuota'

const text = z.string().max(2000).nullish()
const percent = z.number().nonnegative().nullish()
const unixTime = z.number().int().nonnegative().max(8_640_000_000_000).nullish()
const codexWindow = z.object({
  usedPercent: percent,
  resetsAt: unixTime,
  windowDurationMins: z.number().positive().nullish()
})
const codexBucket = z.object({
  limitId: text,
  limitName: text,
  normalModelSlug: text,
  planType: text,
  primary: codexWindow.nullish(),
  secondary: codexWindow.nullish(),
  credits: z.object({ balance: text, hasCredits: z.boolean(), unlimited: z.boolean() }).nullish(),
  individualLimit: z
    .object({ limit: z.string(), used: z.string(), remainingPercent: percent, resetsAt: unixTime })
    .nullish()
})
const codexResponse = z.object({
  accountId: text,
  ordinaryUsageAllowed: z.boolean().nullish(),
  rateLimits: codexBucket,
  rateLimitsByLimitId: z.record(z.string(), codexBucket).nullish(),
  rateLimitResetCredits: z
    .object({
      availableCount: z.number().int().nonnegative(),
      credits: z
        .array(z.object({ id: z.string(), title: text, description: text, status: z.string(), expiresAt: unixTime }))
        .max(256)
        .nullish()
    })
    .nullish()
})

const iso = (seconds: number | null | undefined) => (seconds == null ? null : new Date(seconds * 1000).toISOString())
const emptyBalance = {
  label: null,
  balance: null,
  used: null,
  limit: null,
  currency: null,
  unlimited: null,
  enabled: null,
  remainingPercent: null,
  resetsAt: null
}

export function unavailableQuota(
  providerId: string,
  reason: Extract<ProviderQuotaReport, { status: 'unavailable' }>['reason']
): ProviderQuotaReport {
  return { status: 'unavailable', providerId, reason }
}

export function normalizeCodexQuota(input: unknown, expectedAccountId: string): ProviderQuotaReport {
  const data = codexResponse.parse(input)
  if (!data.accountId) return unavailableQuota('openai-codex', 'no-data')
  if (data.accountId !== expectedAccountId) return unavailableQuota('openai-codex', 'account-mismatch')
  const buckets = Object.entries(data.rateLimitsByLimitId ?? {})
  const primaryId = data.rateLimits.limitId ?? 'codex'
  if (!buckets.some(([id, bucket]) => id === primaryId || bucket.limitId === primaryId))
    buckets.unshift([primaryId, data.rateLimits])
  const windows: AvailableProviderQuota['windows'] = []
  const balances: AvailableProviderQuota['balances'] = []
  for (const [key, bucket] of buckets) {
    const label = bucket.limitName ?? key
    for (const period of ['primary', 'secondary'] as const) {
      const window = bucket[period]
      if (window)
        windows.push({
          id: `${key}:${period}`,
          label,
          scope: bucket.normalModelSlug ? 'model' : 'shared',
          model: bucket.normalModelSlug ?? null,
          usedPercent: window.usedPercent ?? null,
          durationMinutes: window.windowDurationMins ?? null,
          resetsAt: iso(window.resetsAt)
        })
    }
    if (bucket.credits)
      balances.push({
        ...emptyBalance,
        id: `${key}:credits`,
        kind: 'credits',
        label,
        balance: bucket.credits.balance ?? null,
        enabled: bucket.credits.hasCredits,
        unlimited: bucket.credits.unlimited
      })
    if (bucket.individualLimit)
      balances.push({
        ...emptyBalance,
        id: `${key}:spend`,
        kind: 'spend-control',
        label,
        used: bucket.individualLimit.used,
        limit: bucket.individualLimit.limit,
        remainingPercent: bucket.individualLimit.remainingPercent ?? null,
        resetsAt: iso(bucket.individualLimit.resetsAt)
      })
  }
  return ProviderQuotaReportSchema.parse({
    status: 'available',
    providerId: 'openai-codex',
    source: 'codex-cli',
    accountLabel: expectedAccountId,
    plan: data.rateLimits.planType ?? null,
    fetchedAt: new Date().toISOString(),
    ordinaryUsageAllowed: data.ordinaryUsageAllowed ?? null,
    windows,
    balances,
    resetCredits: data.rateLimitResetCredits
      ? {
          availableCount: data.rateLimitResetCredits.availableCount,
          details:
            data.rateLimitResetCredits.credits?.map((credit) => ({
              id: credit.id,
              title: credit.title ?? null,
              description: credit.description ?? null,
              status: credit.status,
              expiresAt: iso(credit.expiresAt)
            })) ?? null
        }
      : null
  })
}

const claudeWindow = z.object({ utilization: percent, resets_at: z.iso.datetime({ offset: true }).nullish() })
const claudeResponse = z.object({
  subscription_type: text,
  rate_limits_available: z.boolean(),
  rate_limits: z
    .object({
      five_hour: claudeWindow.nullish(),
      seven_day: claudeWindow.nullish(),
      seven_day_oauth_apps: claudeWindow.nullish(),
      seven_day_opus: claudeWindow.nullish(),
      seven_day_sonnet: claudeWindow.nullish(),
      model_scoped: z
        .array(claudeWindow.extend({ display_name: z.string().max(2000) }))
        .max(128)
        .nullish(),
      extra_usage: z
        .object({
          is_enabled: z.boolean(),
          monthly_limit: z.number().nonnegative().nullish(),
          used_credits: z.number().nonnegative().nullish(),
          utilization: percent,
          currency: text
        })
        .nullish()
    })
    .nullable()
})

export function normalizeClaudeQuota(input: unknown, accountLabel: string): ProviderQuotaReport {
  const data = claudeResponse.parse(input)
  if (!data.rate_limits_available || !data.rate_limits) return unavailableQuota('claude-code', 'no-data')
  const limits = data.rate_limits
  const windows: AvailableProviderQuota['windows'] = []
  for (const key of ['five_hour', 'seven_day', 'seven_day_oauth_apps', 'seven_day_opus', 'seven_day_sonnet'] as const) {
    const window = limits[key]
    if (!window) continue
    const model = key === 'seven_day_opus' ? 'Opus' : key === 'seven_day_sonnet' ? 'Sonnet' : null
    windows.push({
      id: key,
      label: null,
      model,
      scope: model ? 'model' : key === 'seven_day_oauth_apps' ? 'oauth-apps' : 'shared',
      usedPercent: window.utilization ?? null,
      durationMinutes: key === 'five_hour' ? 300 : 10080,
      resetsAt: window.resets_at ? new Date(window.resets_at).toISOString() : null
    })
  }
  for (const [index, window] of (limits.model_scoped ?? []).entries())
    windows.push({
      id: `model:${index}`,
      label: window.display_name,
      model: window.display_name,
      scope: 'model',
      usedPercent: window.utilization ?? null,
      durationMinutes: 10080,
      resetsAt: window.resets_at ? new Date(window.resets_at).toISOString() : null
    })
  const balances: AvailableProviderQuota['balances'] = []
  if (limits.extra_usage) {
    const extra = limits.extra_usage
    windows.push({
      id: 'extra_usage',
      label: null,
      model: null,
      scope: 'extra',
      usedPercent: extra.utilization ?? null,
      durationMinutes: null,
      resetsAt: null
    })
    balances.push({
      ...emptyBalance,
      id: 'extra_usage',
      kind: 'extra-usage',
      enabled: extra.is_enabled,
      used: extra.used_credits == null ? null : String(extra.used_credits),
      limit: extra.monthly_limit == null ? null : String(extra.monthly_limit),
      currency: extra.currency ?? null
    })
  }
  return ProviderQuotaReportSchema.parse({
    status: 'available',
    providerId: 'claude-code',
    source: 'claude-cli',
    accountLabel,
    plan: data.subscription_type ?? null,
    fetchedAt: new Date().toISOString(),
    ordinaryUsageAllowed: null,
    windows,
    balances,
    resetCredits: null
  })
}
