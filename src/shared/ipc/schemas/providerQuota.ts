import * as z from 'zod'

const nullableText = z.string().max(2000).nullable()
const percentage = z.number().nonnegative().nullable()
const timestamp = z.iso.datetime().nullable()

const quotaWindowSchema = z.object({
  id: z.string(),
  label: nullableText,
  scope: z.enum(['shared', 'model', 'oauth-apps', 'extra']),
  model: nullableText,
  usedPercent: percentage,
  durationMinutes: z.number().positive().nullable(),
  resetsAt: timestamp
})

const quotaBalanceSchema = z.object({
  id: z.string(),
  kind: z.enum(['credits', 'spend-control', 'extra-usage']),
  label: nullableText,
  balance: nullableText,
  used: nullableText,
  limit: nullableText,
  currency: nullableText,
  unlimited: z.boolean().nullable(),
  enabled: z.boolean().nullable(),
  remainingPercent: percentage,
  resetsAt: timestamp
})

export const ProviderQuotaReportSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    providerId: z.string(),
    source: z.enum(['codex-oauth', 'claude-cli', 'cherryin-oauth']),
    accountLabel: z.string(),
    plan: nullableText,
    fetchedAt: z.iso.datetime(),
    ordinaryUsageAllowed: z.boolean().nullable(),
    windows: z.array(quotaWindowSchema).max(256),
    balances: z.array(quotaBalanceSchema).max(256),
    resetCredits: z
      .object({
        availableCount: z.number().int().nonnegative(),
        details: z
          .array(
            z.object({
              id: z.string(),
              title: nullableText,
              description: nullableText,
              status: z.string(),
              expiresAt: timestamp
            })
          )
          .max(256)
          .nullable()
      })
      .nullable()
  }),
  z.object({
    status: z.literal('unavailable'),
    providerId: z.string(),
    reason: z.enum(['unsupported', 'signed-out', 'cli-unavailable', 'account-mismatch', 'no-data', 'failed'])
  })
])

export type ProviderQuotaReport = z.infer<typeof ProviderQuotaReportSchema>
export type AvailableProviderQuota = Extract<ProviderQuotaReport, { status: 'available' }>
