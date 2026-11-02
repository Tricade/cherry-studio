import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, CircularProgress } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { Provider } from '@shared/data/types/provider'
import type { AvailableProviderQuota, ProviderQuotaReport } from '@shared/ipc/schemas/providerQuota'

import { UsagePanel, UsagePanelHeader, UsageSection, UsageSectionTitle } from './UsageSettingsPrimitives'

const sourceKeys = {
  'codex-cli': 'settings.usage.quota.source.codex-cli',
  'claude-cli': 'settings.usage.quota.source.claude-cli',
  'cherryin-oauth': 'settings.usage.quota.source.cherryin-oauth'
} as const
const scopeKeys = {
  shared: 'settings.usage.quota.scope.shared',
  'oauth-apps': 'settings.usage.quota.scope.oauth-apps',
  extra: 'settings.usage.quota.scope.extra'
} as const
const balanceKeys = {
  credits: 'settings.usage.quota.balance_kind.credits',
  'spend-control': 'settings.usage.quota.balance_kind.spend-control',
  'extra-usage': 'settings.usage.quota.balance_kind.extra-usage'
} as const
const reasonKeys = {
  unsupported: 'settings.usage.quota.reason.unsupported',
  'signed-out': 'settings.usage.quota.reason.signed-out',
  'cli-unavailable': 'settings.usage.quota.reason.cli-unavailable',
  'account-mismatch': 'settings.usage.quota.reason.account-mismatch',
  'no-data': 'settings.usage.quota.reason.no-data',
  failed: 'settings.usage.quota.reason.failed'
} as const

function QuotaDetails({ report }: { report: AvailableProviderQuota }) {
  const { t, i18n } = useTranslation()
  const unknown = t('settings.usage.quota.not_reported')
  const percent = (value: number | null) =>
    value === null
      ? unknown
      : new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 2 }).format(value / 100)
  const date = (value: string | null) =>
    value === null
      ? unknown
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  const duration = (minutes: number | null) => {
    if (minutes === null) return unknown
    const unit = minutes % 1440 === 0 ? 'day' : minutes % 60 === 0 ? 'hour' : 'minute'
    return new Intl.NumberFormat(i18n.language, { style: 'unit', unit, unitDisplay: 'long' }).format(
      minutes / (unit === 'day' ? 1440 : unit === 'hour' ? 60 : 1)
    )
  }

  return (
    <div className="space-y-3">
      <p className="break-words text-muted-foreground text-xs">
        {t(sourceKeys[report.source])} · {report.accountLabel}
        {report.plan ? ` · ${report.plan}` : ''} · {t('settings.usage.quota.updated', { date: date(report.fetchedAt) })}
      </p>
      {report.source !== 'cherryin-oauth' && (
        <p className="text-sm">
          {t('settings.usage.quota.included_cost', {
            amount: new Intl.NumberFormat(i18n.language, { style: 'currency', currency: 'EUR' }).format(0)
          })}
        </p>
      )}
      {report.ordinaryUsageAllowed === false && (
        <p className="text-sm text-warning">{t('settings.usage.quota.restricted')}</p>
      )}
      {report.windows.map((window) => {
        const scope = window.scope === 'model' ? (window.model ?? window.label ?? unknown) : t(scopeKeys[window.scope])
        const label = [
          scope,
          window.label && window.label !== scope ? window.label : null,
          duration(window.durationMinutes)
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <div key={window.id} className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-words">{label}</span>
              <span className="inline-flex items-center gap-2">
                {window.usedPercent !== null && (
                  <span aria-hidden="true">
                    <CircularProgress value={window.usedPercent} size={24} strokeWidth={3} />
                  </span>
                )}
                {t('settings.usage.quota.used', { value: percent(window.usedPercent) })}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {t('settings.usage.quota.reset', { date: date(window.resetsAt) })}
            </p>
          </div>
        )
      })}
      {report.balances.length > 0 && (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-muted-foreground text-xs">{t('settings.usage.quota.reported_units')}</p>
          {report.balances.map((balance) => (
            <div key={balance.id} className="space-y-1 text-sm">
              <p className="font-medium">
                {t(balanceKeys[balance.kind])}
                {balance.label ? ` · ${balance.label}` : ''}
              </p>
              {balance.enabled !== null && <span>{t(balance.enabled ? 'common.enabled' : 'common.disabled')} · </span>}
              {balance.unlimited === true ? (
                <span>{t('settings.usage.quota.unlimited')}</span>
              ) : (
                <span>{t('settings.usage.quota.balance', { value: balance.balance ?? unknown })}</span>
              )}
              {balance.used !== null && <p>{t('settings.usage.quota.used', { value: balance.used })}</p>}
              {balance.limit !== null && <p>{t('settings.usage.quota.limit', { value: balance.limit })}</p>}
              {balance.currency !== null && <p>{t('settings.usage.quota.currency', { value: balance.currency })}</p>}
              {balance.remainingPercent !== null && (
                <p>{t('settings.usage.quota.remaining', { value: percent(balance.remainingPercent) })}</p>
              )}
              {balance.resetsAt !== null && <p>{t('settings.usage.quota.reset', { date: date(balance.resetsAt) })}</p>}
            </div>
          ))}
        </div>
      )}
      {report.resetCredits !== null && (
        <div className="space-y-1 text-sm">
          <p>{t('settings.usage.quota.reset_credits', { value: report.resetCredits.availableCount })}</p>
          {report.resetCredits.details?.map((credit) => (
            <div key={credit.id} className="rounded-md border border-border p-2">
              <p>
                {credit.title ?? t('settings.usage.quota.reset_credit')} · {credit.status}
              </p>
              {credit.description && <p>{credit.description}</p>}
              <p className="text-muted-foreground text-xs">
                {t('settings.usage.quota.expires', { date: date(credit.expiresAt) })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProviderQuotaPanel({
  providers
}: {
  providers: Pick<Provider, 'id' | 'name' | 'isEnabled' | 'authMethods'>[]
}) {
  const { t } = useTranslation()
  const candidates = providers.filter(
    (provider) =>
      provider.isEnabled && provider.authMethods?.some((method) => method === 'oauth' || method === 'external-cli')
  )
  const signature = candidates
    .map((provider) => provider.id)
    .sort()
    .join('\0')
  const revision = useRef(0)
  const [reports, setReports] = useState<Record<string, ProviderQuotaReport>>({})
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    revision.current += 1
    setReports({})
    setLoading(false)
    return () => {
      revision.current += 1
    }
  }, [signature])

  const refresh = async () => {
    const request = ++revision.current
    setLoading(true)
    setReports({})
    await Promise.all(
      candidates.map(async (provider) => {
        let report: ProviderQuotaReport
        try {
          report = await ipcApi.request('provider.quota.read', { providerId: provider.id })
        } catch {
          report = { providerId: provider.id, status: 'unavailable', reason: 'failed' }
        }
        if (request === revision.current) setReports((current) => ({ ...current, [provider.id]: report }))
      })
    )
    if (request === revision.current) setLoading(false)
  }

  return (
    <UsageSection>
      <UsagePanel>
        <UsagePanelHeader className="flex flex-wrap items-center justify-between gap-3">
          <UsageSectionTitle>{t('settings.usage.quota.title')}</UsageSectionTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || candidates.length === 0}
            onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" size={14} />
            {t(loading ? 'common.loading' : 'common.refresh')}
          </Button>
        </UsagePanelHeader>
        <div className="space-y-4 p-4">
          <p className="text-muted-foreground text-sm">{t('settings.usage.quota.description')}</p>
          <p className="text-muted-foreground text-xs">{t('settings.usage.quota.estimates')}</p>
          {candidates.length === 0 && (
            <p className="text-muted-foreground text-sm">{t('settings.usage.quota.no_accounts')}</p>
          )}
          {candidates.map((provider) => {
            const report = reports[provider.id]
            return (
              <section key={provider.id} aria-label={provider.name} className="space-y-2 border-border border-t pt-3">
                <h3 className="font-medium text-sm">{provider.name}</h3>
                {report?.status === 'available' ? (
                  <QuotaDetails report={report} />
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t(
                      report
                        ? reasonKeys[report.reason]
                        : loading
                          ? 'common.loading'
                          : 'settings.usage.quota.not_loaded'
                    )}
                  </p>
                )}
              </section>
            )
          })}
        </div>
      </UsagePanel>
    </UsageSection>
  )
}
