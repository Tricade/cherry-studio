import '@data/services/AgentSessionMessageService'
import '@data/services/AgentTaskService'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, type Mock } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentProjectTable } from '@data/db/schemas/agentProject'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { agentProjectService } from '@data/services/AgentProjectService'
import { agentSessionForkService } from '@data/services/AgentSessionForkService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { getAgentProjectContext } from '@main/ai/runtime/agentProjectContext'

describe('project ownership and history', () => {
  const dbh = setupTestDatabase()
  let workspaceId: string

  beforeEach(() => {
    ;(application.get('DbService').withWriteTx as Mock).mockImplementation((fn) => dbh.db.transaction(fn as never))
    dbh.db
      .insert(agentTable)
      .values(
        ['planner', 'coder', 'outsider'].map((id, index) => ({
          id,
          name: id,
          type: 'claude-code',
          instructions: id,
          orderKey: `a${index}`
        }))
      )
      .run()
    dbh.db
      .insert(knowledgeBaseTable)
      .values(
        ['shared', 'private'].map((id, index) => ({
          id,
          name: id,
          orderKey: `a${index}`,
          status: 'completed' as const,
          chunkSize: 1024,
          chunkOverlap: 200
        }))
      )
      .run()
    workspaceId = agentWorkspaceService.findOrCreateByPath(path.resolve('/tmp/cherry-project-service/shared')).id
  })

  afterEach(() => {
    ;(application.get('DbService').withWriteTx as Mock).mockReset()
  })

  function createProject() {
    return agentProjectService.create({
      name: 'Website',
      instructions: 'Work together on the website.',
      workspaceId,
      agentIds: ['planner', 'coder', 'planner'],
      knowledgeBaseIds: ['shared', 'shared']
    })
  }

  function createSession(projectId: string, agentId = 'planner') {
    return agentSessionService.create({ agentId, projectId, name: '', workspace: { type: 'user', workspaceId } })
  }

  it('keeps the coordinator bound to the current project membership', () => {
    const project = createProject()
    expect(project.coordinatorAgentId).toBeNull()
    expect(() => agentProjectService.update(project.id, { coordinatorAgentId: 'outsider' })).toThrow(
      'Coordinator must belong to this project'
    )
    expect(agentProjectService.update(project.id, { coordinatorAgentId: 'planner' }).coordinatorAgentId).toBe('planner')
    expect(getAgentProjectContext(createSession(project.id), 'planner')?.coordinatorAgentId).toBe('planner')
    expect(agentProjectService.update(project.id, { instructions: 'Review reports' }).coordinatorAgentId).toBe(
      'planner'
    )
    expect(agentProjectService.update(project.id, { agentIds: ['coder'] }).coordinatorAgentId).toBeNull()
  })

  it('shares explicit resources without changing the reusable agent definitions', () => {
    const project = createProject()
    expect(project.agentIds).toEqual(['coder', 'planner'])
    expect(project.knowledgeBaseIds).toEqual(['shared'])
    expect(project.workspace.id).toBe(workspaceId)
    const session = createSession(project.id)
    expect(session.projectId).toBe(project.id)
    expect(agentSessionService.getById(session.id).workspaceId).toBe(workspaceId)
    expect(dbh.db.select().from(agentTable).where(eq(agentTable.id, 'planner')).get()?.instructions).toBe('planner')
    expect(agentWorkspaceService.getReferences(workspaceId).projects?.items).toEqual([
      { id: project.id, name: 'Website' }
    ])
  })

  it('rejects temporary session workspaces without leaving an unusable project', () => {
    const session = agentSessionService.create({ agentId: 'planner', name: '', workspace: { type: 'system' } })
    expect(() =>
      agentProjectService.create({
        name: 'Invalid',
        instructions: '',
        agentIds: ['planner'],
        knowledgeBaseIds: [],
        workspaceId: session.workspaceId
      })
    ).toThrow(/Workspace.*not found/)
    expect(agentProjectService.list()).toEqual([])
    expect(agentSessionService.getById(session.id).workspace.type).toBe('system')
  })

  it('rolls back invalid membership and KB edits together with the project fields', () => {
    const project = createProject()
    expect(() => agentProjectService.update(project.id, { name: 'Wrong', agentIds: ['missing'] })).toThrow()
    expect(() =>
      agentProjectService.update(project.id, { agentIds: ['coder'], knowledgeBaseIds: ['missing'] })
    ).toThrow()
    expect(agentProjectService.getById(project.id)).toMatchObject({
      name: 'Website',
      agentIds: ['coder', 'planner'],
      knowledgeBaseIds: ['shared']
    })
    dbh.db.update(agentTable).set({ deletedAt: Date.now() }).where(eq(agentTable.id, 'outsider')).run()
    expect(() => agentProjectService.update(project.id, { agentIds: ['outsider'] })).toThrow()
  })

  it('does not leave a partial project after invalid creation or reuse an owned workspace', () => {
    expect(() =>
      agentProjectService.create({
        name: 'Broken',
        instructions: '',
        workspaceId,
        agentIds: ['missing'],
        knowledgeBaseIds: []
      })
    ).toThrow()
    expect(agentProjectService.list()).toEqual([])
    createProject()
    expect(() => createProject()).toThrow()
    expect(agentProjectService.list()).toHaveLength(1)
  })

  it('rejects foreign agents, foreign workspaces and moving a project session out of its project', () => {
    const project = createProject()
    const foreign = agentWorkspaceService.findOrCreateByPath(path.resolve('/tmp/cherry-project-service/foreign'))
    expect(() => createSession(project.id, 'outsider')).toThrow()
    expect(() =>
      agentSessionService.create({
        name: '',
        agentId: 'planner',
        projectId: project.id,
        workspace: { type: 'user', workspaceId: foreign.id }
      })
    ).toThrow()
    expect(() =>
      agentSessionService.create({ name: '', agentId: 'planner', projectId: project.id, workspace: { type: 'system' } })
    ).toThrow()
    const session = createSession(project.id)
    expect(() => agentSessionService.update(session.id, { agentId: 'outsider' })).toThrow()
    expect(() =>
      dbh.db.transaction((tx) =>
        agentSessionService.setWorkspaceTx(tx, session.id, { type: 'user', workspaceId: foreign.id })
      )
    ).toThrow()
    expect(agentSessionService.getById(session.id)).toMatchObject({
      agentId: 'planner',
      workspaceId,
      projectId: project.id
    })
  })

  it('keeps project placeholders out of normal-chat reuse and filters project history', () => {
    const project = createProject()
    const projectSession = createSession(project.id)
    const normal = agentSessionService.reuseOrCreatePlaceholderWithImpact({
      agentId: 'planner',
      workspace: { type: 'user', workspaceId }
    })
    expect(normal.session.id).not.toBe(projectSession.id)
    expect(normal.session.projectId).toBeUndefined()
    expect(agentSessionService.listByCursor({ projectId: project.id }).items.map(({ id }) => id)).toEqual([
      projectSession.id
    ])
  })

  it('retains old chats after removing a member but prevents new project sessions for that agent', () => {
    const project = createProject()
    const session = createSession(project.id)
    agentProjectService.update(project.id, { agentIds: ['coder'], knowledgeBaseIds: [] })
    expect(agentSessionService.getById(session.id).projectId).toBe(project.id)
    expect(() => createSession(project.id)).toThrow()
    expect(() => getAgentProjectContext(session, 'planner')).toThrow()
    expect(agentProjectService.getById(project.id).knowledgeBaseIds).toEqual([])
  })

  it('blocks workspace and project deletion while history exists, including trash', () => {
    const project = createProject()
    const session = createSession(project.id)
    expect(() => agentSessionService.deleteWorkspaceCascade(workspaceId)).toThrow(/project/i)
    expect(agentSessionService.getById(session.id).projectId).toBe(project.id)
    agentSessionService.delete(session.id)
    expect(() => agentProjectService.delete(project.id)).toThrow(/sessions/i)
    expect(() => dbh.db.delete(agentProjectTable).where(eq(agentProjectTable.id, project.id)).run()).toThrow()
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id)).get()?.deletedAt
    ).not.toBeNull()
    agentSessionService.delete(session.id, { permanent: true })
    agentProjectService.delete(project.id)
    expect(agentProjectService.list()).toEqual([])
    expect(agentWorkspaceService.getById(workspaceId).id).toBe(workspaceId)
  })

  it('retains an empty project workspace during automatic cleanup', () => {
    createProject()
    expect(dbh.db.transaction((tx) => agentWorkspaceService.deleteIfUnreferencedTx(tx, workspaceId))).toBe(false)
    expect(agentWorkspaceService.list().map(({ id }) => id)).toContain(workspaceId)
  })

  it('keeps forked conversation history in the same project', () => {
    const project = createProject()
    const session = createSession(project.id)
    const sourceMessageId = '11111111-1111-4111-8111-111111111111'
    const childMessageId = '22222222-2222-4222-8222-222222222222'
    agentSessionMessageService.saveMessage({
      sessionId: session.id,
      message: {
        id: sourceMessageId,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Project answer' }] }
      }
    })
    const source = agentSessionForkService.read(session.id, sourceMessageId)
    dbh.db.transaction((tx) =>
      agentSessionForkService.commitTx(tx, {
        source,
        messageId: sourceMessageId,
        targetSessionId: 'fork-child',
        createdAt: Date.now(),
        excludedIds: [],
        messages: source.messages.map((row) => ({ ...row, id: childMessageId }))
      })
    )
    expect(agentSessionService.getById('fork-child')).toMatchObject({
      projectId: project.id,
      workspaceId,
      agentId: 'planner'
    })
    expect(agentSessionMessageService.getSessionMessage('fork-child', childMessageId).data.parts).toEqual([
      { type: 'text', text: 'Project answer' }
    ])
  })

  it('keeps agent-created sessions inside the team and refuses delegation to outsiders', () => {
    const project = createProject()
    const sender = createSession(project.id)
    const input = {
      senderAgentId: 'planner',
      senderSessionId: sender.id,
      targetAgentId: 'coder',
      sessionName: 'Implementation',
      workspace: { type: 'system' as const },
      content: 'Build this project'
    }
    const result = agentSessionMessageService.createSessionWithDelivery(input)
    expect(result.session).toMatchObject({ projectId: project.id, workspaceId, agentId: 'coder' })
    expect(() =>
      agentSessionMessageService.createSessionWithDelivery({ ...input, targetAgentId: 'outsider' })
    ).toThrow()
    expect(agentSessionService.listByCursor({ projectId: project.id }).items).toHaveLength(2)
  })
})
