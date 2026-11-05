import * as z from 'zod'

import { AgentWorkspaceEntitySchema } from './agentWorkspaces'

export const AgentProjectEntitySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  instructions: z.string().max(100_000),
  workspaceId: z.string().min(1),
  workspace: AgentWorkspaceEntitySchema,
  agentIds: z.array(z.string().min(1)).max(200),
  coordinatorAgentId: z.string().min(1).nullable().optional(),
  knowledgeBaseIds: z.array(z.string().min(1)).max(200),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
})
export type AgentProjectEntity = z.infer<typeof AgentProjectEntitySchema>

export const CreateAgentProjectSchema = AgentProjectEntitySchema.pick({
  name: true,
  instructions: true,
  workspaceId: true,
  agentIds: true,
  coordinatorAgentId: true,
  knowledgeBaseIds: true
})
export const UpdateAgentProjectSchema = CreateAgentProjectSchema.omit({ workspaceId: true }).partial()
export type CreateAgentProjectDto = z.infer<typeof CreateAgentProjectSchema>
export type UpdateAgentProjectDto = z.infer<typeof UpdateAgentProjectSchema>

export type AgentProjectSchemas = {
  '/agent-projects': {
    GET: { response: AgentProjectEntity[] }
    POST: { body: CreateAgentProjectDto; response: AgentProjectEntity }
  }
  '/agent-projects/:projectId': {
    GET: { params: { projectId: string }; response: AgentProjectEntity }
    PATCH: { params: { projectId: string }; body: UpdateAgentProjectDto; response: AgentProjectEntity }
    DELETE: { params: { projectId: string }; response: void }
  }
}
