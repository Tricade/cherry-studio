import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, Textarea } from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { formatDiagnosticBytes } from '@renderer/utils/diagnosticSourceSummary'
import type { OutputFor } from '@shared/ipc/types'

export type PreparedDiagnosticBundle = Extract<OutputFor<'diagnostics.bundle.prepare_upload'>, { status: 'prepared' }>

export function DiagnosticBundlePreview({ bundle }: { readonly bundle: PreparedDiagnosticBundle }) {
  const { t } = useTranslation()
  const [name, setName] = useState(bundle.entries[0]?.name ?? '')
  const [offsets, setOffsets] = useState([0])
  const [page, setPage] = useState<OutputFor<'diagnostics.bundle.preview_entry'> | null>(null)
  const [failed, setFailed] = useState(false)
  const offset = offsets[offsets.length - 1]

  useEffect(() => {
    let active = true
    setPage(null)
    setFailed(false)
    if (name)
      void ipcApi
        .request('diagnostics.bundle.preview_entry', { bundleId: bundle.bundleId, name, offset })
        .then((result) => {
          if (active) setPage(result)
        })
        .catch(() => {
          if (active) setFailed(true)
        })
    return () => {
      active = false
    }
  }, [bundle.bundleId, name, offset])

  return (
    <section className="space-y-3" aria-label={t('settings.about.diagnostics.preview.title')}>
      <Alert
        type="info"
        description={t('settings.about.diagnostics.preview.destination', {
          destination: bundle.destination,
          size: formatDiagnosticBytes(bundle.archiveBytes)
        })}
      />
      <p className="text-sm">{t('settings.about.diagnostics.preview.exact_package')}</p>
      {bundle.hasWarnings && <Alert type="warning" description={t('settings.about.diagnostics.preview.incomplete')} />}
      <div
        className="flex max-h-40 flex-col gap-1 overflow-y-auto"
        role="group"
        aria-label={t('settings.about.diagnostics.preview.files')}>
        {bundle.entries.map((entry) => (
          <Button
            key={entry.name}
            type="button"
            variant={entry.name === name ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-start"
            aria-pressed={entry.name === name}
            onClick={() => {
              setName(entry.name)
              setOffsets([0])
            }}>
            {entry.name} ({formatDiagnosticBytes(entry.bytes)})
          </Button>
        ))}
      </div>
      {failed ? (
        <Alert type="error" description={t('settings.about.diagnostics.preview.failed')} />
      ) : (
        <Textarea.Input
          readOnly
          aria-label={t('settings.about.diagnostics.preview.content')}
          value={page?.text ?? t('common.loading')}
          className="h-64 font-mono text-xs"
        />
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={offsets.length <= 1 || !page}
          onClick={() => setOffsets((previous) => previous.slice(0, -1))}>
          {t('settings.about.diagnostics.preview.previous')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page?.nextOffset == null}
          onClick={() => {
            if (page?.nextOffset != null) setOffsets((previous) => [...previous, page.nextOffset!])
          }}>
          {t('settings.about.diagnostics.preview.next')}
        </Button>
      </div>
    </section>
  )
}
