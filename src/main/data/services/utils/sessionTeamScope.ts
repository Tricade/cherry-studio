import { and, eq, isNull, sql, type SQLWrapper } from 'drizzle-orm'

import { agentTable } from '@data/db/schemas/agent'
import { agentProjectMemberTable, agentProjectTable } from '@data/db/schemas/agentProject'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import type { DbOrTx } from '@data/db/types'

/** null addresses personal conversations. Only trusted, unscoped data callers omit the argument. */
export type SessionTeamScope = string | null

export function sessionTeamFilter(
  projectId: SessionTeamScope | undefined,
  columns: { projectId: SQLWrapper; workspaceId: SQLWrapper; agentId: SQLWrapper } = agentSessionTable
) {
  if (projectId === undefined) return undefined
  if (projectId === null) return isNull(columns.projectId)
  return and(
    eq(columns.projectId, projectId),
    sql`EXISTS (
      SELECT 1 FROM ${agentProjectMemberTable}
      JOIN ${agentProjectTable} ON ${agentProjectTable.id} = ${agentProjectMemberTable.projectId}
      WHERE ${agentProjectMemberTable.projectId} = ${columns.projectId}
        AND ${agentProjectMemberTable.agentId} = ${columns.agentId}
        AND ${agentProjectTable.workspaceId} = ${columns.workspaceId}
    )`
  )
}

export function isAddressableSessionInTeam(
  tx: DbOrTx,
  sessionId: string,
  projectId: SessionTeamScope,
  agentId?: string
): boolean {
  return !!tx
    .select({ id: agentSessionTable.id })
    .from(agentSessionTable)
    .innerJoin(agentTable, eq(agentTable.id, agentSessionTable.agentId))
    .where(
      and(
        eq(agentSessionTable.id, sessionId),
        eq(agentSessionTable.type, 'conversation'),
        isNull(agentSessionTable.deletedAt),
        isNull(agentTable.deletedAt),
        agentId === undefined ? undefined : eq(agentTable.id, agentId),
        sessionTeamFilter(projectId)
      )
    )
    .get()
}
