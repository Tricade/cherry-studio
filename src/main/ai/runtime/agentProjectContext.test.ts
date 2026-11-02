import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import {
  type AgentProjectContext,
  ensureSessionAgentDataDirectory,
  resolveAgentProjectKnowledgeScope
} from './agentProjectContext'

const project: AgentProjectContext = {
  id: 'project-one',
  name: 'One',
  instructions: 'Build one',
  knowledgeBaseIds: ['shared', 'second']
}

describe('project runtime context', () => {
  it('treats project knowledge as a strict ceiling, including empty projects and forged selections', () => {
    expect(resolveAgentProjectKnowledgeScope(project, ['private'], [])).toEqual(['second', 'shared'])
    expect(resolveAgentProjectKnowledgeScope(project, ['private'], ['shared', 'private'])).toEqual(['shared'])
    expect(resolveAgentProjectKnowledgeScope(project, ['private'], ['private'])).toEqual([])
    expect(resolveAgentProjectKnowledgeScope({ ...project, knowledgeBaseIds: [] }, ['private'], ['private'])).toEqual(
      []
    )
    expect(resolveAgentProjectKnowledgeScope(undefined, ['private'], [])).toEqual(['private'])
  })

  it('keeps identity and memory separate for the same agent in two projects and global chats', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'cherry-project-memory-'))
    const getPath = vi.mocked(application.getPath)
    const original = getPath.getMockImplementation()!
    getPath.mockImplementation((key) =>
      key === 'feature.projects.data'
        ? path.join(root, 'Projects')
        : key === 'feature.agents.data'
          ? path.join(root, 'Agents')
          : original(key)
    )
    try {
      const global = await ensureSessionAgentDataDirectory('coder')
      await writeFile(path.join(global, 'SOUL.md'), 'Global identity')
      await writeFile(path.join(global, 'memory', 'FACT.md'), 'Private global fact')
      const first = await ensureSessionAgentDataDirectory('coder', project)
      await writeFile(path.join(first, 'SOUL.md'), 'Project one identity')
      await writeFile(path.join(first, 'memory', 'FACT.md'), 'Project one fact')
      const second = await ensureSessionAgentDataDirectory('coder', { ...project, id: 'project-two' })
      expect(await readFile(path.join(second, 'SOUL.md'), 'utf8')).toBe('')
      await expect(readFile(path.join(second, 'memory', 'FACT.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await ensureSessionAgentDataDirectory('coder', project)).toBe(first)
      expect(await readFile(path.join(first, 'memory', 'FACT.md'), 'utf8')).toBe('Project one fact')
      expect(await readFile(path.join(global, 'SOUL.md'), 'utf8')).toBe('Global identity')
      await expect(ensureSessionAgentDataDirectory('coder', { ...project, id: '../escape' })).rejects.toThrow()
      await symlink(
        global,
        path.join(root, 'Projects', 'linked-project'),
        process.platform === 'win32' ? 'junction' : 'dir'
      )
      await expect(ensureSessionAgentDataDirectory('coder', { ...project, id: 'linked-project' })).rejects.toThrow(
        /symbolic link/
      )
    } finally {
      getPath.mockImplementation(original)
      await rm(root, { recursive: true, force: true })
    }
  })
})
