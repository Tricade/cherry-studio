import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { ProviderQuotaDetails } from '@renderer/components/provider/ProviderQuotaDetails'
import { requestProviderQuota } from '@renderer/services/providerQuota'
import type { Provider } from '@shared/data/types/provider'
import type { ProviderQuotaReport } from '@shared/ipc/schemas/providerQuota'

import { UsagePanel, UsagePanelHeader, UsageSection, UsageSectionTitle } from './UsageSettingsPrimitives'

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
        const report = await requestProviderQuota(provider.id)
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
                <ProviderQuotaDetails report={report} loading={loading} />
              </section>
            )
          })}
        </div>
      </UsagePanel>
    </UsageSection>
  )
}
