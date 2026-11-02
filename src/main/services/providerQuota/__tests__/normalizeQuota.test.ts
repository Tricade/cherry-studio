import { describe, expect, it } from 'vitest'

import { normalizeClaudeQuota, normalizeCodexQuota } from '../normalizeQuota'

describe('provider quota normalization', () => {
  it('preserves distinct shared/model windows, credits, resets and backend blocking without inventing token counts', () => {
    const shared = {
      limitId: 'codex',
      limitName: 'Codex',
      planType: 'plus',
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_800_000_000 },
      secondary: { usedPercent: 42, windowDurationMins: 10080, resetsAt: null },
      credits: { balance: '17.25', hasCredits: true, unlimited: false },
      individualLimit: { limit: '100', used: '8', remainingPercent: 92, resetsAt: 1_800_000_000 }
    }
    const report = normalizeCodexQuota(
      {
        accountId: 'account-a',
        ordinaryUsageAllowed: false,
        rateLimits: shared,
        rateLimitsByLimitId: {
          codex: shared,
          model_bucket: { normalModelSlug: 'reported-model', primary: { usedPercent: 7, windowDurationMins: 300 } }
        },
        rateLimitResetCredits: {
          availableCount: 3,
          credits: [
            {
              id: 'voucher-1',
              title: 'Courtesy reset',
              description: 'Provider description',
              status: 'available',
              grantedAt: 1_700_000_000,
              expiresAt: 1_800_000_000
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

  it.each([
    ['different-account', 'account-mismatch'],
    [null, 'no-data']
  ])('withholds the complete report for an unverified account (%s)', (accountId, reason) => {
    expect(normalizeCodexQuota({ accountId, rateLimits: { primary: { usedPercent: 98 } } }, 'account-a')).toEqual({
      providerId: 'openai-codex',
      status: 'unavailable',
      reason
    })
  })

  it('keeps unknown utilization and reset-credit details distinct from zero', () => {
    const result = normalizeCodexQuota(
      {
        accountId: 'account-a',
        rateLimits: { primary: {} },
        rateLimitResetCredits: { availableCount: 2, credits: null }
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
      normalizeCodexQuota({ accountId: 'account-a', rateLimits: { primary: { usedPercent: '12%' } } }, 'account-a')
    ).toThrow()
  })
})
