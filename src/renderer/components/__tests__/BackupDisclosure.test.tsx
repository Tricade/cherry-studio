import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import { BackupDisclosure } from '../BackupDisclosure'

vi.unmock('@cherrystudio/ui')

beforeEach(async () => {
  MockUsePreferenceUtils.resetMocks()
  await i18n.changeLanguage('en-us')
})

describe('backup disclosure', () => {
  it('does not claim a transfer destination when remote storage is unconfigured', () => {
    MockUsePreferenceUtils.setPreferenceValue('data.backup.webdav.host', '')
    render(<BackupDisclosure target="webdav" />)
    expect(screen.getByRole('status')).toHaveTextContent('No destination configured')
    expect(screen.getByRole('status')).not.toHaveTextContent('Uploaded to')
  })

  it('discloses the remote destination and insecure transfer without displaying URL credentials', () => {
    MockUsePreferenceUtils.setPreferenceValue(
      'data.backup.webdav.host',
      'http://user:SECRET@example.com/dav?key=SECRET'
    )
    MockUsePreferenceUtils.setPreferenceValue('data.backup.webdav.path', 'backups')
    render(<BackupDisclosure target="webdav" />)

    const disclosure = screen.getByRole('status')
    expect(disclosure).toHaveTextContent('http://example.com/dav/backups')
    expect(disclosure).toHaveTextContent('The destination does not use HTTPS')
    expect(disclosure).toHaveTextContent('The ZIP archive is not encrypted')
    expect(disclosure).toHaveTextContent('stored API keys and sign-in credentials')
    expect(disclosure).not.toHaveTextContent('SECRET')
  })

  it('shows the selected slim contents and local destination, and respects a forced full export', () => {
    MockUsePreferenceUtils.setPreferenceValue('data.backup.local.dir', 'D:/private-backups')
    MockUsePreferenceUtils.setPreferenceValue('data.backup.local.skip_backup_file', true)
    MockUsePreferenceUtils.setPreferenceValue('data.backup.general.skip_backup_file', true)
    const { rerender } = render(<BackupDisclosure target="local" />)

    expect(screen.getByRole('status')).toHaveTextContent('Slim backup:')
    expect(screen.getByRole('status')).toHaveTextContent('D:/private-backups')
    expect(screen.getByRole('status')).toHaveTextContent('Cherry Studio does not upload this backup')
    rerender(<BackupDisclosure target="export" forceFull />)
    expect(screen.getByRole('status')).toHaveTextContent('Full backup:')
    expect(screen.getByRole('status')).toHaveTextContent('You choose the local destination in the next step')
  })

  it('distinguishes the Nutstore target from separately configured WebDAV storage', () => {
    MockUsePreferenceUtils.setPreferenceValue('data.backup.webdav.host', 'https://other.example.com')
    MockUsePreferenceUtils.setPreferenceValue('data.backup.nutstore.path', 'CherryBackup')
    render(<BackupDisclosure target="nutstore" />)

    expect(screen.getByRole('status')).toHaveTextContent('https://dav.jianguoyun.com/dav/CherryBackup')
    expect(screen.getByRole('status')).not.toHaveTextContent('other.example.com')
    expect(screen.getByRole('status')).not.toHaveTextContent('does not use HTTPS')
  })
})
