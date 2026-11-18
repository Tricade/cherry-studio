import * as z from 'zod'

import type { AvailableProviderQuota, ProviderQuotaReport } from '@shared/ipc/schemas/providerQuota'
import { ProviderQuotaReportSchema } from '@shared/ipc/schemas/providerQuota'

const text = z.string().max(2000).nullish()
const percent = z.number().nonnegative().nullish()
const unixTime = z.number().int().nonnegative().max(8_640_000_000_000).nullish()
const codexWindow = z.object({
  used_percent: percent,
  reset_at: unixTime,
  limit_window_seconds: z.number().int().nonnegative().nullish()
})
const codexRateLimit = z.object({
  allowed: z.boolean().nullish(),
  primary_window: codexWindow.nullish(),
  secondary_window: codexWindow.nullish()
})
const codexResetCredits = z.object({
  available_count: z.number().int().nonnegative(),
  credits: z
    .array(
      z.object({
        id: z.string(),
        title: text,
        description: text,
        status: z.string(),
        expires_at: z.iso.datetime({ offset: true }).nullish()
      })
    )
    .max(256)
    .nullish()
})
const codexResponse = z.object({
  account_id: text,
  plan_type: text,
  rate_limit: codexRateLimit.nullish(),
  additional_rate_limits: z
    .array(
      z.object({
        metered_feature: z.string().min(1),
        limit_name: text,
        normal_model_slug: text,
        rate_limit: codexRateLimit.nullish()
      })
    )
    .max(127)
    .nullish(),
  credits: z.object({ balance: text, has_credits: z.boolean(), unlimited: z.boolean() }).nullish(),
  spend_control: z
    .object({
      individual_limit: z
        .object({ limit: z.string(), used: z.string(), remaining_percent: percent, reset_at: unixTime })
        .nullish()
    })
    .nullish(),
  rate_limit_reset_credits: codexResetCredits.nullish()
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

export function normalizeCodexResetCredits(input: unknown): AvailableProviderQuota['resetCredits'] {
  const result = codexResetCredits.safeParse(input)
  if (!result.success) return null
  return {
    availableCount: result.data.available_count,
    details:
      result.data.credits?.map((credit) => ({
        id: credit.id,
        title: credit.title ?? null,
        description: credit.description ?? null,
        status: credit.status,
        expiresAt: credit.expires_at ? new Date(credit.expires_at).toISOString() : null
      })) ?? null
  }
}

export function normalizeCodexQuota(input: unknown, expectedAccountId: string): ProviderQuotaReport {
  const data = codexResponse.parse(input)
  if (data.account_id != null && data.account_id !== expectedAccountId)
    return unavailableQuota('openai-codex', 'account-mismatch')

  const buckets = new Map([
    ['codex', { metered_feature: 'codex', limit_name: null, normal_model_slug: null, rate_limit: data.rate_limit }],
    ...(data.additional_rate_limits ?? []).map((bucket) => [bucket.metered_feature, bucket] as const)
  ])
  const windows: AvailableProviderQuota['windows'] = []
  for (const [key, bucket] of buckets) {
    for (const period of ['primary', 'secondary'] as const) {
      const window = bucket.rate_limit?.[`${period}_window`]
      if (window)
        windows.push({
          id: `${key}:${period}`,
          label: bucket.limit_name ?? key,
          scope: bucket.normal_model_slug ? 'model' : 'shared',
          model: bucket.normal_model_slug ?? null,
          usedPercent: window.used_percent ?? null,
          durationMinutes: window.limit_window_seconds ? Math.ceil(window.limit_window_seconds / 60) : null,
          resetsAt: iso(window.reset_at)
        })
    }
  }

  const balances: AvailableProviderQuota['balances'] = []
  if (data.credits)
    balances.push({
      ...emptyBalance,
      id: 'codex:credits',
      kind: 'credits',
      label: 'codex',
      balance: data.credits.balance ?? null,
      enabled: data.credits.has_credits,
      unlimited: data.credits.unlimited
    })
  const spendLimit = data.spend_control?.individual_limit
  if (spendLimit)
    balances.push({
      ...emptyBalance,
      id: 'codex:spend',
      kind: 'spend-control',
      label: 'codex',
      used: spendLimit.used,
      limit: spendLimit.limit,
      remainingPercent: spendLimit.remaining_percent ?? null,
      resetsAt: iso(spendLimit.reset_at)
    })

  const resetCredits = normalizeCodexResetCredits(data.rate_limit_reset_credits)
  if (!windows.length && !balances.length && !resetCredits && data.rate_limit?.allowed == null)
    return unavailableQuota('openai-codex', 'no-data')
  return ProviderQuotaReportSchema.parse({
    status: 'available',
    providerId: 'openai-codex',
    source: 'codex-oauth',
    accountLabel: expectedAccountId,
    plan: data.plan_type ?? null,
    fetchedAt: new Date().toISOString(),
    ordinaryUsageAllowed: data.rate_limit?.allowed ?? null,
    windows,
    balances,
    resetCredits
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
