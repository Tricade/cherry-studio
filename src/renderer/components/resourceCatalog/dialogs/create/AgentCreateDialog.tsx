import { useCallback } from 'react'

import { loggerService } from '@logger'
import { useAgentMutations } from '@renderer/hooks/resourceCatalog'
import { buildCreateAgentCommand } from '@renderer/utils/resourceCatalog'

import { ResourceCreateWizard, type ResourceCreateWizardValues } from './ResourceCreateWizard'

const logger = loggerService.withContext('AgentCreateDialog')

type AgentCreateDialogProps = {
  open: boolean
  includeKnowledge?: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (agentId: string) => void | Promise<void>
}

export function AgentCreateDialog({ open, includeKnowledge, onOpenChange, onCreated }: AgentCreateDialogProps) {
  const { createAgent, isCreatingAgent } = useAgentMutations()

  const handleSubmitCreate = useCallback(
    async (values: ResourceCreateWizardValues) => {
      try {
        const created = await createAgent(buildCreateAgentCommand(values))
        onOpenChange(false)
        await onCreated(created.id)
      } catch (error) {
        logger.error('Failed to create agent', error as Error)
        throw error
      }
    },
    [createAgent, onCreated, onOpenChange]
  )

  return (
    <ResourceCreateWizard
      kind="agent"
      open={open}
      includeKnowledge={includeKnowledge}
      isSubmitting={isCreatingAgent}
      onOpenChange={onOpenChange}
      onSubmit={handleSubmitCreate}
    />
  )
}
