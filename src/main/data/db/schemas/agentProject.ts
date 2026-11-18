import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey } from './_columnHelpers'
import { agentTable } from './agent'
import { agentWorkspaceTable } from './agentWorkspace'
import { knowledgeBaseTable } from './knowledge'

export const agentProjectTable = sqliteTable('agent_project', {
  id: uuidPrimaryKey(),
  name: text().notNull(),
  instructions: text().notNull().default(''),
  coordinatorAgentId: text(),
  workspaceId: text()
    .notNull()
    .unique()
    .references(() => agentWorkspaceTable.id, { onDelete: 'restrict' }),
  ...createUpdateTimestamps
})

export const agentProjectMemberTable = sqliteTable(
  'agent_project_member',
  {
    projectId: text()
      .notNull()
      .references(() => agentProjectTable.id, { onDelete: 'cascade' }),
    agentId: text()
      .notNull()
      .references(() => agentTable.id, { onDelete: 'cascade' })
  },
  (t) => [primaryKey({ columns: [t.projectId, t.agentId] })]
)

export const agentProjectKnowledgeBaseTable = sqliteTable(
  'agent_project_knowledge_base',
  {
    projectId: text()
      .notNull()
      .references(() => agentProjectTable.id, { onDelete: 'cascade' }),
    knowledgeBaseId: text()
      .notNull()
      .references(() => knowledgeBaseTable.id, { onDelete: 'cascade' })
  },
  (t) => [primaryKey({ columns: [t.projectId, t.knowledgeBaseId] })]
)

export type AgentProjectRow = typeof agentProjectTable.$inferSelect
