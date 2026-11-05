import { useTranslation } from 'react-i18next'

import { CircularProgress } from '@cherrystudio/ui'
import type { ProviderQuotaReport } from '@shared/ipc/schemas/providerQuota'

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

export function ProviderQuotaDetails({
  report,
  loading = false,
  compact = false
}: {
  report?: ProviderQuotaReport
  loading?: boolean
  compact?: boolean
}) {
  const { t, i18n } = useTranslation()
  if (report?.status !== 'available') {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t(report ? reasonKeys[report.reason] : loading ? 'common.loading' : 'settings.usage.quota.not_loaded')}
      </p>
    )
  }

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
        {t(sourceKeys[report.source])}
        {!compact ? ' · ' + report.accountLabel : ''}
        {report.plan ? ` · ${report.plan}` : ''} · {t('settings.usage.quota.updated', { date: date(report.fetchedAt) })}
      </p>
      {!compact && report.source !== 'cherryin-oauth' && (
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
        const displayedPercent =
          compact && window.usedPercent !== null ? Math.max(0, 100 - window.usedPercent) : window.usedPercent
        return (
          <div key={window.id} className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-words">{label}</span>
              <span className="inline-flex items-center gap-2">
                {!compact && displayedPercent !== null && (
                  <span aria-hidden="true">
                    <CircularProgress value={displayedPercent} size={24} strokeWidth={3} />
                  </span>
                )}
                {t(compact ? 'settings.usage.quota.remaining' : 'settings.usage.quota.used', {
                  value: displayedPercent === null ? unknown : percent(displayedPercent)
                })}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {t('settings.usage.quota.reset', { date: date(window.resetsAt) })}
            </p>
          </div>
        )
      })}
      {report.balances.length > 0 && (
        <div
          className={
            compact ? 'space-y-2 border-border border-t pt-2' : 'space-y-2 rounded-md border border-border p-3'
          }>
          {!compact && <p className="text-muted-foreground text-xs">{t('settings.usage.quota.reported_units')}</p>}
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
