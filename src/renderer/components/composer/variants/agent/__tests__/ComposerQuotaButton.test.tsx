import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderQuotaDetails } from '@renderer/components/provider/ProviderQuotaDetails'
import i18n from '@renderer/i18n/resolver'
import type { AvailableProviderQuota } from '@shared/ipc/schemas/providerQuota'

import { ComposerQuotaButton } from '../ComposerQuotaButton'

vi.unmock('@cherrystudio/ui')
const request = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))

const report: AvailableProviderQuota = {
  status: 'available',
  providerId: 'openai-codex',
  source: 'codex-cli',
  accountLabel: 'test account',
  plan: null,
  fetchedAt: '2030-06-13T12:00:00Z',
  ordinaryUsageAllowed: true,
  windows: [
    {
      id: 'model-window',
      label: null,
      scope: 'model',
      model: 'GPT example',
      usedPercent: 64,
      durationMinutes: 300,
      resetsAt: '2030-06-14T12:00:00Z'
    }
  ],
  balances: [
    {
      id: 'credits',
      kind: 'credits',
      label: null,
      balance: '12.5',
      used: null,
      limit: null,
      currency: null,
      enabled: null,
      unlimited: null,
      remainingPercent: null,
      resetsAt: null
    }
  ],
  resetCredits: { availableCount: 2, details: null }
}

beforeEach(async () => {
  request.mockReset()
  await i18n.changeLanguage('en-us')
})

describe('ComposerQuotaButton', () => {
  it('reads on open and shows the reported window, remaining quota and reset credits', async () => {
    const user = userEvent.setup()
    request.mockResolvedValue(report)
    render(<ComposerQuotaButton providerId="openai-codex" />)

    expect(request).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Account quotas and balances' }))

    expect(await screen.findByText('Remaining: 36%')).toBeVisible()
    expect(screen.getByText('GPT example · 5 hours')).toBeVisible()
    expect(screen.getByText(/Reset:.*Jun 14, 2030/)).toBeVisible()
    expect(screen.getByText('Balance: 12.5')).toBeVisible()
    expect(screen.getByText('Available reset credits: 2')).toBeVisible()
    expect(request).toHaveBeenCalledExactlyOnceWith('provider.quota.read', { providerId: 'openai-codex' })
  })

  it('discards an outstanding report when the effective provider changes', async () => {
    const user = userEvent.setup()
    const pending = Promise.withResolvers<AvailableProviderQuota>()
    request.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
      providerId: 'claude-code',
      status: 'unavailable',
      reason: 'signed-out'
    })
    const view = render(<ComposerQuotaButton providerId="openai-codex" />)
    await user.click(screen.getByRole('button', { name: 'Account quotas and balances' }))
    view.rerender(<ComposerQuotaButton providerId="claude-code" />)
    await user.click(screen.getByRole('button', { name: 'Account quotas and balances' }))
    expect(await screen.findByText('Sign in to this provider first.')).toBeVisible()

    await act(async () => pending.resolve(report))
    expect(screen.queryByText('Balance: 12.5')).not.toBeInTheDocument()

    view.rerender(<ComposerQuotaButton providerId="openai" />)
    expect(screen.queryByRole('button', { name: 'Account quotas and balances' })).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('keeps consumed percentages in the full Usage view', () => {
    render(<ProviderQuotaDetails report={report} />)
    expect(screen.getByText('Used: 64%')).toBeVisible()
  })
})
