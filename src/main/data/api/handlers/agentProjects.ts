import { agentProjectService } from '@data/services/AgentProjectService'
import {
  CreateAgentProjectSchema,
  type AgentProjectSchemas,
  UpdateAgentProjectSchema
} from '@shared/data/api/schemas/agentProjects'
import type { HandlersFor } from '@shared/data/api/types'

export const agentProjectHandlers: HandlersFor<AgentProjectSchemas> = {
  '/agent-projects': {
    GET: async () => agentProjectService.list(),
    POST: async ({ body }) => agentProjectService.create(CreateAgentProjectSchema.parse(body))
  },
  '/agent-projects/:projectId': {
    GET: async ({ params }) => agentProjectService.getById(params.projectId),
    PATCH: async ({ params, body }) =>
      agentProjectService.update(params.projectId, UpdateAgentProjectSchema.parse(body)),
    DELETE: async ({ params }) => agentProjectService.delete(params.projectId)
  }
}
