import { useTranslation } from 'react-i18next'

import { Alert } from '@cherrystudio/ui'
import { useMultiplePreferences } from '@data/hooks/usePreference'
import { NUTSTORE_HOST } from '@shared/utils/nutstore'

type BackupTarget = 'export' | 'local' | 'webdav' | 's3' | 'nutstore'

function remoteDestination(endpoint: string, ...parts: string[]) {
  try {
    const url = new URL(endpoint)
    if (!['http:', 'https:'].includes(url.protocol)) return undefined
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return {
      label: [url.href.replace(/\/$/, ''), ...parts.filter(Boolean)].join('/'),
      insecure: url.protocol !== 'https:'
    }
  } catch {
    return undefined
  }
}

export function BackupDisclosure({ target, forceFull = false }: { target: BackupTarget; forceFull?: boolean }) {
  const { t } = useTranslation()
  const [settings] = useMultiplePreferences({
    exportSlim: 'data.backup.general.skip_backup_file',
    localDir: 'data.backup.local.dir',
    localSlim: 'data.backup.local.skip_backup_file',
    webdavHost: 'data.backup.webdav.host',
    webdavPath: 'data.backup.webdav.path',
    webdavSlim: 'data.backup.webdav.skip_backup_file',
    s3Endpoint: 'data.backup.s3.endpoint',
    s3Bucket: 'data.backup.s3.bucket',
    s3Root: 'data.backup.s3.root',
    s3Slim: 'data.backup.s3.skip_backup_file',
    nutstorePath: 'data.backup.nutstore.path',
    nutstoreSlim: 'data.backup.nutstore.skip_backup_file'
  })
  const slim = !forceFull && settings[`${target}Slim`]
  const remote = {
    webdav: remoteDestination(settings.webdavHost, settings.webdavPath),
    s3: remoteDestination(settings.s3Endpoint, settings.s3Bucket, settings.s3Root),
    nutstore: remoteDestination(NUTSTORE_HOST, settings.nutstorePath)
  }
  const isRemote = target !== 'local' && target !== 'export'
  const destination = isRemote ? remote[target] : undefined
  const destinationLabel = isRemote ? destination?.label : settings.localDir

  return (
    <Alert
      type="warning"
      className="my-3"
      message={t('backup.disclosure.title')}
      description={
        <div className="space-y-2 break-words">
          <p>{t(slim ? 'backup.disclosure.slim' : 'backup.disclosure.full')}</p>
          <p>{t('backup.disclosure.project_memory')}</p>
          <p>{t('backup.disclosure.credentials')}</p>
          <p>{t('backup.disclosure.external')}</p>
          <p>
            {target === 'export'
              ? t('backup.disclosure.choose_destination')
              : destinationLabel
                ? t(isRemote ? 'backup.disclosure.remote' : 'backup.disclosure.local', {
                    destination: destinationLabel
                  })
                : t('backup.disclosure.no_destination')}
          </p>
          {destination?.insecure && <p>{t('backup.disclosure.insecure_transport')}</p>}
        </div>
      }
    />
  )
}
