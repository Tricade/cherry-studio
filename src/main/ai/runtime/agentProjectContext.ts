import { application } from '@application'
import { agentProjectService } from '@data/services/AgentProjectService'
import {
  agentDataDirectoryPath,
  ensureAgentDataDirectory,
  ensureAgentStorageDirectory
} from '@main/ai/agents/agentDataDirectory'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import type { AgentProjectEntity } from '@shared/data/api/schemas/agentProjects'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

export type AgentProjectContext = Pick<AgentProjectEntity, 'id' | 'name' | 'instructions' | 'knowledgeBaseIds'>

export function getAgentProjectContext(session: AgentSessionEntity, agentId: string): AgentProjectContext | undefined {
  if (!session.projectId) return undefined
  const project = agentProjectService.assertSessionScopeTx(
    application.get('DbService').getDb(),
    session.projectId,
    agentId,
    session.workspaceId
  )
  return {
    id: project.id,
    name: project.name,
    instructions: project.instructions,
    knowledgeBaseIds: project.knowledgeBaseIds
  }
}

export function resolveAgentProjectKnowledgeScope(
  project: AgentProjectContext | undefined,
  configuredIds: readonly string[] | null | undefined,
  selectedIds?: readonly string[]
): string[] {
  if (!project) return resolveKnowledgeBaseScope(configuredIds, selectedIds)
  const allowed = new Set(project.knowledgeBaseIds)
  return [...new Set(selectedIds?.length ? selectedIds.filter((id) => allowed.has(id)) : allowed)].sort()
}

export async function ensureSessionAgentDataDirectory(agentId: string, project?: AgentProjectContext): Promise<string> {
  if (!project) return ensureAgentDataDirectory(application.getPath('feature.agents.data'), agentId)
  const root = application.getPath('feature.projects.data')
  const projectRoot = agentDataDirectoryPath(root, project.id)
  await ensureAgentStorageDirectory(root, projectRoot)
  return ensureAgentDataDirectory(projectRoot, agentId)
}
