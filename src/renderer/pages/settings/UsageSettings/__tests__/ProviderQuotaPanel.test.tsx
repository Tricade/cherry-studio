import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import type { AvailableProviderQuota } from '@shared/ipc/schemas/providerQuota'

import { ProviderQuotaPanel } from '../ProviderQuotaPanel'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const provider = { id: 'openai-codex', name: 'Codex', isEnabled: true, authMethods: ['oauth' as const] }
const snapshot: AvailableProviderQuota = {
  status: 'available',
  providerId: provider.id,
  source: 'codex-oauth',
  accountLabel: 'test-account',
  plan: 'plus',
  fetchedAt: '2026-11-02T12:00:00.000Z',
  ordinaryUsageAllowed: false,
  windows: [
    {
      id: 'shared',
      label: null,
      scope: 'shared',
      model: null,
      usedPercent: 37.5,
      durationMinutes: 300,
      resetsAt: '2026-11-02T15:00:00.000Z'
    },
    {
      id: 'model',
      label: null,
      scope: 'model',
      model: 'test-model',
      usedPercent: 0,
      durationMinutes: 10080,
      resetsAt: null
    },
    {
      id: 'unknown',
      label: null,
      scope: 'shared',
      model: null,
      usedPercent: null,
      durationMinutes: null,
      resetsAt: null
    }
  ],
  balances: [
    {
      id: 'credits',
      kind: 'credits',
      label: null,
      balance: '12.75',
      used: null,
      limit: null,
      currency: null,
      unlimited: false,
      enabled: true,
      remainingPercent: null,
      resetsAt: null
    }
  ],
  resetCredits: {
    availableCount: 3,
    details: [{ id: 'credit1', title: 'Test reset credit', description: null, status: 'available', expiresAt: null }]
  }
}

describe('ProviderQuotaPanel', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    await i18n.changeLanguage('en-US')
  })

  it('contacts providers only on refresh and distinguishes reported model/shared/unknown quotas from token estimates', async () => {
    const request = vi.spyOn(ipcApi, 'request').mockResolvedValue(snapshot)
    render(<ProviderQuotaPanel providers={[provider]} />)
    expect(request).not.toHaveBeenCalled()
    expect(screen.getByText('Not refreshed yet.')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }))
    const account = within(screen.getByRole('region', { name: 'Codex' }))
    expect(await account.findByText('Used: 37.5%')).toBeInTheDocument()
    expect(account.getByText('Used: 0%')).toBeInTheDocument()
    expect(account.getByText('Used: Not reported')).toBeInTheDocument()
    expect(account.getByText('Shared quota · 5 hours')).toBeInTheDocument()
    expect(account.getByText('test-model · 7 days')).toBeInTheDocument()
    expect(account.getByText('Additional charge for usage included in the plan: €0.00')).toBeInTheDocument()
    expect(account.getByText('Balance: 12.75')).toBeInTheDocument()
    expect(account.getByText('Available reset credits: 3')).toBeInTheDocument()
    expect(
      account.getByText('The provider reports that ordinary included usage is currently blocked.')
    ).toBeInTheDocument()
    expect(screen.getByText(/estimated API-equivalent costs/)).toBeInTheDocument()
  })

  it('keeps unsupported accounts and failed reads distinct from a zero balance', async () => {
    vi.spyOn(ipcApi, 'request')
      .mockResolvedValueOnce({ status: 'unavailable', providerId: 'github-copilot', reason: 'unsupported' })
      .mockRejectedValueOnce(new Error('offline'))
    render(<ProviderQuotaPanel providers={[{ ...provider, id: 'github-copilot', name: 'Copilot' }, provider]} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }))
    expect(
      await screen.findByText('No verified quota interface is available for this sign-in method.')
    ).toBeInTheDocument()
    expect(await screen.findByText('Could not retrieve account data. Refresh to try again.')).toBeInTheDocument()
    expect(screen.queryByText(/Balance:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/€0.00/)).not.toBeInTheDocument()
  })

  it('discards a response after its provider was disabled, even when re-enabled before the response arrives', async () => {
    let finish!: (report: AvailableProviderQuota) => void
    vi.spyOn(ipcApi, 'request').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const view = render(<ProviderQuotaPanel providers={[provider]} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }))
    view.rerender(<ProviderQuotaPanel providers={[{ ...provider, isEnabled: false }]} />)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    view.rerender(<ProviderQuotaPanel providers={[provider]} />)
    await act(async () => {
      finish(snapshot)
    })
    expect(screen.getByText('Not refreshed yet.')).toBeInTheDocument()
    expect(screen.queryByText('Used: 37.5%')).not.toBeInTheDocument()
  })

  it('shows paid extra usage in provider units without treating it as included or converting its amount', async () => {
    vi.spyOn(ipcApi, 'request').mockResolvedValue({
      ...snapshot,
      source: 'claude-cli',
      windows: [],
      resetCredits: null,
      balances: [
        {
          id: 'extra',
          kind: 'extra-usage',
          label: null,
          balance: null,
          used: '1250',
          limit: '5000',
          currency: 'USD',
          enabled: true,
          unlimited: null,
          remainingPercent: null,
          resetsAt: null
        }
      ]
    })
    render(<ProviderQuotaPanel providers={[provider]} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Used: 1250')).toBeInTheDocument()
    expect(screen.getByText('Limit: 5000')).toBeInTheDocument()
    expect(screen.getByText('Balance: Not reported')).toBeInTheDocument()
    expect(screen.getByText('Reported currency: USD')).toBeInTheDocument()
    expect(screen.getByText(/provider's reported units/)).toBeInTheDocument()
    expect(screen.queryByText('$12.50')).not.toBeInTheDocument()
  })
})
