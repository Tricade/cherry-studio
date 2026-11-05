import '@data/services/AgentSessionMessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

import { CherryAssistantSeeder } from '@data/db/seeding/seeders/cherryAssistantSeeder'
import { CherrySupportSeeder } from '@data/db/seeding/seeders/cherrySupportSeeder'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { BuiltinAgentRole } from '@shared/ai/builtinAgent'

import { createBuiltinAssistantSession } from '../createBuiltinAssistantSession'
import { createBuiltinSupportSession } from '../createBuiltinSupportSession'

vi.mock('../ensureBuiltinAgent', () => ({
  loadBuiltinAgentEnsureInput: (builtinRole: BuiltinAgentRole) => ({
    builtinRole,
    configuration: {},
    name: builtinRole === 'assistant' ? 'Cherry Assistant' : 'Cherry Support',
    preferredModelId: null,
    type: 'claude-code'
  })
}))

describe('removing built-in agents', () => {
  const dbh = setupTestDatabase()

  it.each([
    { role: 'assistant', seeder: new CherryAssistantSeeder(), createSession: createBuiltinAssistantSession },
    { role: 'support', seeder: new CherrySupportSeeder(), createSession: createBuiltinSupportSession }
  ])(
    'keeps $role deleted through seeding and explicit session launches until restored',
    ({ role, seeder, createSession }) => {
      seeder.run(dbh.db)
      const { agentId, id: sessionId } = createSession()
      if (!agentId) throw new Error('Missing seeded agent')

      expect(agentService.deleteAgent(agentId, { deleteSessions: true }).deleted).toBe(true)
      expect(() => agentSessionService.getById(sessionId)).toThrow()
      seeder.run(dbh.db)
      expect(agentService.findBuiltinAgentByRoleTx(dbh.db, role)).toBeNull()
      expect(createSession).toThrow(/deleted/i)

      expect(agentService.restoreAgent(agentId).id).toBe(agentId)
      expect(agentSessionService.getById(sessionId).agentId).toBe(agentId)
      expect(createSession().agentId).toBe(agentId)

      expect(agentService.deleteAgent(agentId, { deleteSessions: true }).deleted).toBe(true)
      expect(agentService.deleteAgent(agentId, { permanent: true }).deleted).toBe(true)
      seeder.run(dbh.db)
      expect(agentService.findBuiltinAgentByRoleTx(dbh.db, role, { includeDeleted: true })).toBeNull()
      expect(createSession).toThrow(/deleted/i)
    }
  )
})
