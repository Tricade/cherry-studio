import { Gauge, RefreshCw } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { ProviderQuotaDetails } from '@renderer/components/provider/ProviderQuotaDetails'
import { getProviderLabelKey } from '@renderer/i18n/label'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { requestProviderQuota } from '@renderer/services/providerQuota'
import type { ProviderQuotaReport } from '@shared/ipc/schemas/providerQuota'
import { supportsProviderQuota } from '@shared/utils/providerQuota'

export function ComposerQuotaButton({ providerId }: { providerId?: string }) {
  if (!providerId || !supportsProviderQuota(providerId)) return null
  return <ProviderQuotaPopover key={providerId} providerId={providerId} />
}

function ProviderQuotaPopover({ providerId }: { providerId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [report, setReport] = useState<ProviderQuotaReport>()
  const [loading, setLoading] = useState(false)
  const revision = useRef(0)

  const refresh = async () => {
    const request = ++revision.current
    setReport(undefined)
    setLoading(true)
    const result = await requestProviderQuota(providerId)
    if (request !== revision.current) return
    setReport(result)
    setLoading(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) {
      void refresh()
    } else {
      revision.current += 1
      setReport(undefined)
      setLoading(false)
    }
  }

  const label = t('settings.usage.quota.title')
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label}>
          <Gauge />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        aria-label={label}
        className="max-h-[60vh] w-80 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <h2 className="min-w-0 break-words font-medium text-sm">{t(getProviderLabelKey(providerId, providerId))}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
            disabled={loading}
            onClick={() => void refresh()}>
            <RefreshCw />
          </Button>
        </div>
        <ProviderQuotaDetails report={report} loading={loading} compact />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            handleOpenChange(false)
            openSettingsTab('/settings/usage')
          }}>
          {t('settings.usage.title')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
