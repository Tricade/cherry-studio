import { diagnosticBundleService } from '@main/services/diagnostics'
import type { diagnosticsRequestSchemas } from '@shared/ipc/schemas/diagnostics'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const diagnosticsHandlers: IpcHandlersFor<typeof diagnosticsRequestSchemas> = {
  'diagnostics.bundle.inspect': async ({ range }) => diagnosticBundleService.inspect(range),
  'diagnostics.bundle.export': async (input, { senderId }) => diagnosticBundleService.exportBundle(input, senderId),
  'diagnostics.bundle.prepare_upload': async (input, { senderId }) =>
    diagnosticBundleService.prepareUpload(input, senderId),
  'diagnostics.bundle.preview_entry': async (input, { senderId }) =>
    diagnosticBundleService.previewEntry(input, senderId),
  'diagnostics.bundle.upload': async (input, { senderId }) => diagnosticBundleService.uploadBundle(input, senderId),
  'diagnostics.bundle.retry_upload': async (input, { senderId }) =>
    diagnosticBundleService.retryUpload(input, senderId),
  'diagnostics.report.refresh': async ({ reportId }) => diagnosticBundleService.refreshReport(reportId),
  'diagnostics.bundle.save_upload': async (input, { senderId }) =>
    diagnosticBundleService.saveUploadBundle(input, senderId),
  'diagnostics.bundle.discard_upload': async (input, { senderId }) =>
    diagnosticBundleService.discardUpload(input, senderId)
}
