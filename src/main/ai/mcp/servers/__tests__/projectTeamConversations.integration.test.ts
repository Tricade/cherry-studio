import path from 'node:path'

import { McpServer } from '@modelcontextprotocol/server'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentProjectService } from '@data/services/AgentProjectService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { registerAutonomyTools } from '../cherryAutonomyTools'
import { callBuiltinTool, toolText } from './builtinMcpClient'

describe('project team conversations over the in-process MCP transport', () => {
  const dbh = setupTestDatabase()
  const interaction = vi.fn()

  beforeEach(() => {
    interaction.mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
    vi.mocked(application.get('DbService').withWriteTx).mockImplementation((fn) => dbh.db.transaction(fn))
    MockApplicationUtils.setService('AgentSessionRuntimeService', { getInteractionState: interaction })
    // Control the two model turns while using the production persistence, routing and MCP tools.
    MockApplicationUtils.setService('AgentSessionDeliveryService', {
      accept: messages.acceptSessionDelivery.bind(messages),
      acceptWithNewSession: messages.createSessionWithDelivery.bind(messages)
    })
    dbh.db.insert(userProviderTable).values({ providerId: 'fixture', name: 'Offline', orderKey: 'a0' }).run()
    for (const [index, role] of ['planner', 'coder', 'reviewer'].entries()) {
      const model = 'fixture::' + role
      dbh.db
        .insert(userModelTable)
        .values({
          id: model,
          providerId: 'fixture',
          modelId: role,
          name: role,
          capabilities: [],
          supportsStreaming: true,
          orderKey: 'a' + index
        })
        .run()
      dbh.db
        .insert(agentTable)
        .values({
          id: role,
          name: role,
          model,
          instructions: role,
          type: 'pi',
          configuration: { permission_mode: 'auto' },
          orderKey: 'a' + index
        })
        .run()
    }
  })

  afterEach(() => {
    vi.mocked(application.get('DbService').withWriteTx).mockReset()
    MockApplicationUtils.resetServices()
  })

  function project(name: string, agentIds: string[]) {
    const folder = agentWorkspaceService.findOrCreateByPath(path.resolve('/tmp/cherry-team-conversations', name))
    return agentProjectService.create({
      name,
      instructions: '',
      workspaceId: folder.id,
      agentIds,
      knowledgeBaseIds: []
    })
  }

  function session(agentId: string, workspaceId: string, projectId?: string) {
    return agentSessionService.create({
      name: 'evidence',
      agentId,
      projectId,
      workspace: { type: 'user', workspaceId }
    })
  }

  function tool(caller: AgentSessionEntity, name: string, args: Record<string, unknown> = {}) {
    return callBuiltinTool(
      () => {
        const server = new McpServer({ name: 'cherry-tools', version: '1' })
        registerAutonomyTools(server, {
          agentId: caller.agentId!,
          sessionId: caller.id,
          workspacePath: caller.workspace.path,
          workspaceSource: { type: 'user', workspaceId: caller.workspaceId },
          trustedNotifyChannels: [],
          allowAnyOwnedNotifyChannel: false
        })
        return server
      },
      name,
      args
    )
  }

  async function result(caller: AgentSessionEntity, name: string, args?: Record<string, unknown>) {
    const response = await tool(caller, name, args)
    expect(response.isError, toolText(response)).not.toBe(true)
    return JSON.parse(toolText(response))
  }

  function assistantReply(sessionId: string, text: string) {
    const id = uuidv7()
    messages.saveMessage({
      sessionId,
      message: { id, role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text }] } }
    })
    return id
  }

  it('assigns work to the selected teammate, reads the frozen reply, verifies evidence and sends a correction', async () => {
    const team = project('website', ['planner', 'coder'])
    const lead = session('planner', team.workspaceId, team.id)
    expect((await result(lead, 'agent_list')).agents.map((a: { model: string }) => a.model)).toEqual([
      'fixture::planner',
      'fixture::coder'
    ])
    const task = await result(lead, 'session_create', { target_agent_id: 'coder', message: 'Check the header' })
    expect(agentSessionService.getById(task.sessionId)).toMatchObject({
      projectId: team.id,
      agentId: 'coder',
      workspaceId: team.workspaceId
    })
    const assistant = assistantReply(task.sessionId, 'Header contrast measured 3:1')
    expect(messages.claimSessionDeliveryTx(dbh.db, task.sessionId, task.requestId, assistant)?.delivery?.status).toBe(
      'delivering'
    )
    const permitsRead = () => messages.allowsProjectDeliveryRead(task.sessionId, task.requestId, assistant)
    expect(permitsRead()).toBe(true)
    expect(messages.allowsProjectDeliveryRead(task.sessionId, task.requestId, uuidv7())).toBe(false)
    dbh.db
      .update(agentTable)
      .set({ configuration: { permission_mode: 'default' } })
      .where(eq(agentTable.id, 'coder'))
      .run()
    expect(permitsRead()).toBe(false)
    dbh.db
      .update(agentTable)
      .set({ configuration: { permission_mode: 'bypassPermissions' } })
      .where(eq(agentTable.id, 'coder'))
      .run()
    interaction.mockImplementation(() => ({
      currentTurn: 'headless',
      userResponse: 'unavailable',
      projectDeliveryRead: permitsRead()
    }))
    const worker = agentSessionService.getById(task.sessionId)
    expect((await result(worker, 'session_read', { session_id: lead.id })).sessionId).toBe(lead.id)
    expect(
      (await tool(worker, 'session_send', { target_session_id: lead.id, message: 'Start another task' })).isError
    ).toBe(true)
    interaction.mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
    const listening = vi.spyOn(messages, 'waitForProjectDelivery')
    const review = result(lead, 'session_deliveries', { request_id: task.requestId, wait_for_result: true })
    await vi.waitFor(() => expect(listening).toHaveBeenCalled())
    listening.mockRestore()
    const completion = messages.finalizeSessionDelivery({
      requestSessionId: worker.id,
      requestMessageId: task.requestId,
      assistantMessageId: assistant,
      outcome: 'success'
    })
    expect(completion?.sessionId).toBe(lead.id)
    expect(permitsRead()).toBe(false)
    expect((await review).deliveries).toContainEqual(
      expect.objectContaining({ content: expect.stringContaining('3:1') })
    )
    expect(toolText(await tool(lead, 'session_read', { session_id: worker.id, message_id: assistant }))).toContain(
      'Header contrast measured 3:1'
    )
    expect(
      (
        await result(lead, 'session_send', {
          target_session_id: worker.id,
          message: 'Raise contrast and remeasure',
          reply: 'completion'
        })
      ).ok
    ).toBe(true)
  })

  it('filters metadata, both message searches and known IDs before returning any other project or personal evidence', async () => {
    const team = project('first', ['planner', 'coder'])
    const second = project('second', ['coder', 'reviewer'])
    const lead = session('planner', team.workspaceId, team.id)
    const worker = session('coder', team.workspaceId, team.id)
    const other = session('coder', second.workspaceId, second.id)
    const personal = session('coder', team.workspaceId)
    for (const [target, content] of [
      [worker, 'team'],
      [other, 'foreign'],
      [personal, 'personal']
    ] as const) {
      assistantReply(target.id, 'evidence xy ' + content)
    }
    for (const query of ['evidence', 'xy']) {
      const hits = await result(lead, 'session_search', { query, agent_id: 'coder', limit: 1 })
      expect(hits.sessions.map((hit: { sessionId: string }) => hit.sessionId)).toEqual([worker.id])
      expect(JSON.stringify(hits)).not.toMatch(/foreign|personal/)
    }
    expect((await result(lead, 'session_list', { agent_id: 'coder', limit: 1 })).sessions).toHaveLength(1)
    expect((await result(lead, 'session_list', { agent_id: 'coder', limit: 1 })).nextCursor).toBeUndefined()
    for (const target of [other, personal]) {
      expect((await tool(lead, 'session_read', { session_id: target.id })).isError).toBe(true)
      expect((await tool(target, 'session_read', { session_id: lead.id })).isError).toBe(true)
      expect((await tool(lead, 'session_rename', { session_id: target.id, title: 'Changed' })).isError).toBe(true)
      expect((await tool(lead, 'session_send', { target_session_id: target.id, message: 'Secret' })).isError).toBe(true)
      expect(agentSessionService.getById(target.id).name).toBe('evidence')
      expect(messages.listSessionDeliveries(target.id)).toHaveLength(0)
    }
    expect((await tool(lead, 'session_create', { target_agent_id: 'reviewer', message: 'Secret' })).isError).toBe(true)
    agentProjectService.update(team.id, { agentIds: ['planner'] })
    expect((await result(lead, 'session_list', { agent_id: 'coder' })).sessions).toEqual([])
    expect((await tool(worker, 'session_list')).isError).toBe(true)
    expect((await tool(lead, 'session_read', { session_id: worker.id })).isError).toBe(true)
  })

  it('limits waiting to an owned request and returns pending work at the deadline or cancels with the caller', async () => {
    const team = project('wait', ['planner', 'coder'])
    const lead = session('planner', team.workspaceId, team.id)
    const worker = session('coder', team.workspaceId, team.id)
    const task = await result(lead, 'session_send', {
      target_session_id: worker.id,
      message: 'Check',
      reply: 'completion'
    })
    const control = new AbortController()
    await messages.waitForProjectDelivery(worker.id, team.id, task.requestId, control.signal)
    const cancel = messages.waitForProjectDelivery(lead.id, team.id, task.requestId, control.signal)
    control.abort()
    await expect(cancel).rejects.toMatchObject({ name: 'AbortError' })
    vi.useFakeTimers()
    try {
      const deadline = messages.waitForProjectDelivery(lead.id, team.id, task.requestId, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(20_000)
      await deadline
      expect(messages.getSessionMessage(worker.id, task.requestId).delivery?.status).toBe('accepted')
    } finally {
      vi.useRealTimers()
    }
  })

  it('revokes pending and in-flight deliveries without returning any further data', async () => {
    const team = project('revoked', ['planner', 'coder'])
    const lead = session('planner', team.workspaceId, team.id)
    const worker = session('coder', team.workspaceId, team.id)
    const args = { target_session_id: worker.id, message: 'Initial task', reply: 'completion' }
    const queued = await result(lead, 'session_send', args)
    const running = await result(lead, 'session_send', args)
    const assistant = assistantReply(worker.id, 'Private after revocation')
    messages.claimSessionDeliveryTx(dbh.db, worker.id, running.requestId, assistant)
    agentProjectService.update(team.id, { agentIds: ['planner'] })
    expect(() => messages.claimSessionDeliveryTx(dbh.db, worker.id, queued.requestId, uuidv7())).toThrowError(
      expect.objectContaining({ code: 'SESSION_TOOL_FORBIDDEN' })
    )
    expect(
      messages.failSessionDelivery(messages.getSessionMessage(worker.id, queued.requestId), {
        code: 'SESSION_TOOL_FORBIDDEN',
        message: 'Access revoked'
      })
    ).toBeNull()
    expect(messages.allowsProjectDeliveryRead(worker.id, running.requestId, assistant)).toBe(false)
    expect(
      messages.finalizeSessionDelivery({
        requestSessionId: worker.id,
        requestMessageId: running.requestId,
        assistantMessageId: assistant,
        outcome: 'success'
      })
    ).toBeNull()
    expect(messages.getSessionMessage(worker.id, running.requestId).delivery?.status).toBe('failed')
    expect(messages.listSessionDeliveries(lead.id)).toHaveLength(0)
    expect((await result(lead, 'session_deliveries', { direction: 'outgoing' })).deliveries).toEqual([])
  })
})
