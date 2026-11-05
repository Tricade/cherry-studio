import { randomUUID } from 'node:crypto'

import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentTable } from '@data/db/schemas/agent'
import {
  agentProjectKnowledgeBaseTable,
  agentProjectMemberTable,
  agentProjectTable,
  type AgentProjectRow
} from '@data/db/schemas/agentProject'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import {
  CreateAgentProjectSchema,
  type AgentProjectEntity,
  type CreateAgentProjectDto,
  type UpdateAgentProjectDto,
  UpdateAgentProjectSchema
} from '@shared/data/api/schemas/agentProjects'

import { agentWorkspaceService } from './AgentWorkspaceService'
import { timestampToISO } from './utils/rowMappers'

export class AgentProjectService {
  private notify(id: string): void {
    notifyDataApiDataChange([
      { endpoint: '/agent-projects', kind: 'membership', entityIds: [id] },
      { endpoint: '/agent-projects/:projectId', entityIds: [id] },
      { endpoint: '/agent-workspaces', kind: 'membership' }
    ])
  }

  private toEntity(tx: DbOrTx, row: AgentProjectRow): AgentProjectEntity {
    const agentIds = tx
      .select({ id: agentProjectMemberTable.agentId })
      .from(agentProjectMemberTable)
      .where(eq(agentProjectMemberTable.projectId, row.id))
      .orderBy(asc(agentProjectMemberTable.agentId))
      .all()
      .map(({ id }) => id)
    return {
      ...row,
      workspace: agentWorkspaceService.getByIdTx(tx, row.workspaceId),
      agentIds,
      coordinatorAgentId:
        row.coordinatorAgentId && agentIds.includes(row.coordinatorAgentId) ? row.coordinatorAgentId : null,
      knowledgeBaseIds: tx
        .select({ id: agentProjectKnowledgeBaseTable.knowledgeBaseId })
        .from(agentProjectKnowledgeBaseTable)
        .where(eq(agentProjectKnowledgeBaseTable.projectId, row.id))
        .orderBy(asc(agentProjectKnowledgeBaseTable.knowledgeBaseId))
        .all()
        .map(({ id }) => id),
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    }
  }

  list(): AgentProjectEntity[] {
    const db = application.get('DbService').getDb()
    return db
      .select()
      .from(agentProjectTable)
      .orderBy(asc(agentProjectTable.name), asc(agentProjectTable.id))
      .all()
      .map((row) => this.toEntity(db, row))
  }

  getById(id: string): AgentProjectEntity {
    return this.getByIdTx(application.get('DbService').getDb(), id)
  }

  getByIdTx(tx: DbOrTx, id: string): AgentProjectEntity {
    const row = tx.select().from(agentProjectTable).where(eq(agentProjectTable.id, id)).get()
    if (!row) throw DataApiErrorFactory.notFound('Project', id)
    return this.toEntity(tx, row)
  }

  assertSessionScopeTx(tx: DbOrTx, projectId: string, agentId: string, workspaceId: string): AgentProjectEntity {
    const project = this.getByIdTx(tx, projectId)
    if (project.workspaceId !== workspaceId || !project.agentIds.includes(agentId)) {
      throw DataApiErrorFactory.invalidOperation(
        'use project session',
        'Agent and workspace must belong to this project'
      )
    }
    return project
  }

  private replaceBindings(
    tx: DbOrTx,
    id: string,
    dto: Pick<UpdateAgentProjectDto, 'agentIds' | 'knowledgeBaseIds'>
  ): void {
    if (dto.agentIds !== undefined) {
      const ids = [...new Set(dto.agentIds)]
      const existing = ids.length
        ? tx
            .select({ id: agentTable.id })
            .from(agentTable)
            .where(and(inArray(agentTable.id, ids), isNull(agentTable.deletedAt)))
            .all()
        : []
      if (existing.length !== ids.length) throw DataApiErrorFactory.notFound('Agent')
      tx.delete(agentProjectMemberTable).where(eq(agentProjectMemberTable.projectId, id)).run()
      if (ids.length)
        tx.insert(agentProjectMemberTable)
          .values(ids.map((agentId) => ({ projectId: id, agentId })))
          .run()
    }
    if (dto.knowledgeBaseIds !== undefined) {
      const ids = [...new Set(dto.knowledgeBaseIds)]
      const existing = ids.length
        ? tx
            .select({ id: knowledgeBaseTable.id })
            .from(knowledgeBaseTable)
            .where(inArray(knowledgeBaseTable.id, ids))
            .all()
        : []
      if (existing.length !== ids.length) throw DataApiErrorFactory.notFound('Knowledge base')
      tx.delete(agentProjectKnowledgeBaseTable).where(eq(agentProjectKnowledgeBaseTable.projectId, id)).run()
      if (ids.length)
        tx.insert(agentProjectKnowledgeBaseTable)
          .values(ids.map((knowledgeBaseId) => ({ projectId: id, knowledgeBaseId })))
          .run()
    }
  }

  private assertCoordinatorIsMember(coordinator: string | null | undefined, agentIds: readonly string[]): void {
    if (coordinator && !agentIds.includes(coordinator)) {
      throw DataApiErrorFactory.invalidOperation('set project coordinator', 'Coordinator must belong to this project')
    }
  }

  create(input: CreateAgentProjectDto): AgentProjectEntity {
    const dto = CreateAgentProjectSchema.parse(input)
    this.assertCoordinatorIsMember(dto.coordinatorAgentId, dto.agentIds)
    const id = randomUUID()
    withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          agentWorkspaceService.getByIdTx(tx, dto.workspaceId)
          tx.insert(agentProjectTable)
            .values({
              id,
              name: dto.name,
              instructions: dto.instructions,
              workspaceId: dto.workspaceId,
              coordinatorAgentId: dto.coordinatorAgentId
            })
            .run()
          this.replaceBindings(tx, id, dto)
        }),
      defaultHandlersFor('Project', id)
    )
    this.notify(id)
    return this.getById(id)
  }

  update(id: string, input: UpdateAgentProjectDto): AgentProjectEntity {
    const dto = UpdateAgentProjectSchema.parse(input)
    withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const project = this.getByIdTx(tx, id)
          const agentIds = dto.agentIds ?? project.agentIds
          this.assertCoordinatorIsMember(dto.coordinatorAgentId, agentIds)
          const coordinator = dto.coordinatorAgentId === undefined ? project.coordinatorAgentId : dto.coordinatorAgentId
          tx.update(agentProjectTable)
            .set({
              name: dto.name,
              instructions: dto.instructions,
              coordinatorAgentId: coordinator && agentIds.includes(coordinator) ? coordinator : null,
              updatedAt: Date.now()
            })
            .where(eq(agentProjectTable.id, id))
            .run()
          this.replaceBindings(tx, id, dto)
        }),
      defaultHandlersFor('Project', id)
    )
    this.notify(id)
    return this.getById(id)
  }

  delete(id: string): void {
    application.get('DbService').withWriteTx((tx) => {
      this.getByIdTx(tx, id)
      if (
        tx.select({ id: agentSessionTable.id }).from(agentSessionTable).where(eq(agentSessionTable.projectId, id)).get()
      ) {
        throw DataApiErrorFactory.invalidOperation(
          'delete project',
          'Remove the project sessions, including trash, first'
        )
      }
      tx.delete(agentProjectTable).where(eq(agentProjectTable.id, id)).run()
    })
    this.notify(id)
  }
}

export const agentProjectService = new AgentProjectService()
