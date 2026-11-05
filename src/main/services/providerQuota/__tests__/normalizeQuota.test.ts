import { describe, expect, it } from 'vitest'

import { normalizeClaudeQuota, normalizeCodexQuota } from '../normalizeQuota'

describe('provider quota normalization', () => {
  it('preserves distinct shared/model windows, credits, resets and backend blocking without inventing token counts', () => {
    const report = normalizeCodexQuota(
      {
        account_id: 'account-a',
        plan_type: 'plus',
        rate_limit: {
          allowed: false,
          primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1_800_000_000 },
          secondary_window: { used_percent: 42, limit_window_seconds: 604800, reset_at: null }
        },
        additional_rate_limits: [
          {
            metered_feature: 'model_bucket',
            normal_model_slug: 'reported-model',
            rate_limit: { primary_window: { used_percent: 7, limit_window_seconds: 18000 } }
          }
        ],
        credits: { balance: '17.25', has_credits: true, unlimited: false },
        spend_control: {
          individual_limit: { limit: '100', used: '8', remaining_percent: 92, reset_at: 1_800_000_000 }
        },
        rate_limit_reset_credits: {
          available_count: 3,
          credits: [
            {
              id: 'voucher-1',
              title: 'Courtesy reset',
              description: 'Provider description',
              status: 'available',
              expires_at: '2027-01-15T09:00:00+01:00'
            }
          ]
        },
        accessToken: 'must-not-leave-main'
      },
      'account-a'
    )
    expect(report.status).toBe('available')
    if (report.status !== 'available') throw new Error('Expected quota')
    expect(report.windows).toHaveLength(3)
    expect(report.windows[0]).toMatchObject({
      scope: 'shared',
      usedPercent: 12,
      model: null,
      resetsAt: '2027-01-15T08:00:00.000Z'
    })
    expect(report.windows[1].resetsAt).toBeNull()
    expect(report.windows[2]).toMatchObject({ scope: 'model', model: 'reported-model', usedPercent: 7 })
    expect(report.balances[0]).toMatchObject({ balance: '17.25', currency: null, unlimited: false })
    expect(report.balances[1]).toMatchObject({ used: '8', limit: '100', remainingPercent: 92 })
    expect(report.resetCredits).toMatchObject({ availableCount: 3, details: [{ title: 'Courtesy reset' }] })
    expect(report.ordinaryUsageAllowed).toBe(false)
    expect(JSON.stringify(report)).not.toMatch(/must-not-leave-main|totalTokens|inputTokens/)
  })

  it('rejects a mismatched account and accepts older payloads without an account id', () => {
    const rate_limit = { primary_window: { used_percent: 98 } }
    expect(normalizeCodexQuota({ account_id: 'other', rate_limit }, 'account-a')).toEqual({
      providerId: 'openai-codex',
      status: 'unavailable',
      reason: 'account-mismatch'
    })
    expect(normalizeCodexQuota({ rate_limit }, 'account-a')).toMatchObject({
      status: 'available',
      accountLabel: 'account-a',
      windows: [{ usedPercent: 98 }]
    })
  })

  it('keeps unknown utilization and reset-credit details distinct from zero', () => {
    const result = normalizeCodexQuota(
      {
        account_id: 'account-a',
        rate_limit: { primary_window: {} },
        rate_limit_reset_credits: { available_count: 2, credits: null }
      },
      'account-a'
    )
    expect(result).toMatchObject({
      status: 'available',
      ordinaryUsageAllowed: null,
      windows: [{ usedPercent: null, resetsAt: null, durationMinutes: null }],
      resetCredits: { availableCount: 2, details: null }
    })
  })

  it('preserves Claude model labels and extra usage as separate reported units', () => {
    const result = normalizeClaudeQuota(
      {
        subscription_type: 'max',
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 0, resets_at: '2026-11-03T13:00:00+01:00' },
          seven_day: { utilization: null, resets_at: null },
          seven_day_sonnet: { utilization: 18, resets_at: null },
          model_scoped: [{ display_name: 'Server model', utilization: 4.5, resets_at: null }],
          extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1250, utilization: 25, currency: 'USD' }
        },
        session: { total_cost_usd: 999 },
        behaviors: { private: 'not-returned' }
      },
      'person@example.invalid'
    )
    expect(result.status).toBe('available')
    if (result.status !== 'available') throw new Error('Expected quota')
    expect(result.windows[0]).toMatchObject({
      usedPercent: 0,
      resetsAt: '2026-11-03T12:00:00.000Z',
      durationMinutes: 300
    })
    expect(result.windows[1].usedPercent).toBeNull()
    expect(result.windows[2]).toMatchObject({ model: 'Sonnet', scope: 'model', usedPercent: 18 })
    expect(result.windows[3]).toMatchObject({ model: 'Server model', scope: 'model', usedPercent: 4.5 })
    expect(result.windows[4]).toMatchObject({ scope: 'extra', usedPercent: 25 })
    expect(result.balances).toMatchObject([{ used: '1250', limit: '5000', currency: 'USD', balance: null }])
    expect(JSON.stringify(result)).not.toMatch(/not-returned|total_cost_usd/)
  })

  it('does not substitute empty quota data for unsupported or malformed reports', () => {
    expect(
      normalizeClaudeQuota({ rate_limits_available: false, subscription_type: null, rate_limits: null }, 'CLI')
    ).toEqual({
      providerId: 'claude-code',
      status: 'unavailable',
      reason: 'no-data'
    })
    expect(() =>
      normalizeClaudeQuota({ rate_limits_available: true, rate_limits: { five_hour: { utilization: -1 } } }, 'CLI')
    ).toThrow()
    expect(() =>
      normalizeCodexQuota(
        { account_id: 'account-a', rate_limit: { primary_window: { used_percent: '12%' } } },
        'account-a'
      )
    ).toThrow()
  })
})
