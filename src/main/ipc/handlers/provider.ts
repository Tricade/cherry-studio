import { setProviderLogo } from '@main/services/entityLogo'
import { readProviderQuota } from '@main/services/providerQuota/readProviderQuota'
import type { providerRequestSchemas } from '@shared/ipc/schemas/provider'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Provider imperative command handlers. Thin adapter: `provider.set_logo`
 * delegates the create→bind→compensate orchestration to `setProviderLogo`.
 */
export const providerHandlers: IpcHandlersFor<typeof providerRequestSchemas> = {
  'provider.quota.read': ({ providerId }) => readProviderQuota(providerId),
  'provider.set_logo': ({ providerId, image }) => setProviderLogo(providerId, image)
}
