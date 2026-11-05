import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { AgentProjectEntity, CreateAgentProjectDto } from '@shared/data/api/schemas/agentProjects'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'

import { ProjectsPage } from '../ProjectsPage'

vi.unmock('@cherrystudio/ui')

const openRoute = vi.hoisted(() => vi.fn())
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openRoute }))

function Page({ initialProjectId }: { initialProjectId?: string }) {
  const [projectId, setProjectId] = useState(initialProjectId)
  return <ProjectsPage projectId={projectId} onProjectIdChange={setProjectId} />
}

const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }))
afterAll(() => {
  if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

const workspace = {
  id: 'folder',
  name: 'Project folder',
  path: '/fixture/project',
  type: 'user' as const,
  orderKey: 'a0',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
}
let projects: AgentProjectEntity[]
const save = vi.fn(async ({ body }: { body: CreateAgentProjectDto }) => {
  const project: AgentProjectEntity = {
    ...body,
    id: 'project',
    workspace,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z'
  }
  projects = [project]
  return project
})
const createSession = vi.fn(async () => ({ id: 'project-session' }))
const remove = vi.fn(async () => {
  projects = []
})
const refetch = vi.fn(async () => projects)

beforeEach(async () => {
  MockUseDataApiUtils.resetMocks()
  vi.clearAllMocks()
  projects = []
  await i18n.changeLanguage('en-us')
  mockUseQuery.mockImplementation((route) => ({
    data: (route === '/agent-projects'
      ? projects
      : route === '/agents'
        ? {
            items: [
              { id: 'planner', name: 'Planner' },
              { id: 'coder', name: 'Coder' }
            ]
          }
        : route === '/agent-workspaces'
          ? [workspace]
          : undefined) as never,
    isLoading: false,
    isRefreshing: false,
    error: undefined,
    refetch,
    mutate: vi.fn() as never
  }))
  mockUseMutation.mockImplementation((method, path) => ({
    trigger: (path === '/agent-sessions' ? createSession : method === 'DELETE' ? remove : save) as never,
    isLoading: false,
    error: undefined
  }))
  MockUseDataApiUtils.seedInfiniteQuery(
    '/knowledge-bases',
    [
      {
        items: [{ id: 'shared', name: 'Shared research', itemCount: 0 } as KnowledgeBaseListItem],
        nextCursor: undefined,
        total: 1
      }
    ],
    { query: { sortBy: 'orderKey', sortOrder: 'asc' }, limit: 100 }
  )
})

describe('ProjectsPage', () => {
  it('creates an explicit team and starts the selected member in that project workspace', async () => {
    const user = userEvent.setup()
    render(<Page />)
    await user.type(await screen.findByLabelText('Project name'), 'Website')
    await user.type(screen.getByLabelText('Shared project instructions'), 'Use primary sources.')
    await user.click(screen.getByRole('button', { name: 'Choose or add a folder' }))
    await user.click(await screen.findByText('Project folder', { exact: true }))
    await user.click(screen.getByRole('checkbox', { name: 'Planner' }))
    await user.click(screen.getByRole('checkbox', { name: 'Coder' }))
    await user.click(screen.getByRole('checkbox', { name: 'Shared research' }))
    await user.click(screen.getByRole('button', { name: 'Save and chat with Coder' }))
    await waitFor(() => expect(openRoute).toHaveBeenCalledWith('/app/agents', { sessionId: 'project-session' }))
    expect(createSession).toHaveBeenCalledWith({
      body: {
        name: '',
        projectId: 'project',
        agentId: 'coder',
        workspace: { type: 'user', workspaceId: 'folder' }
      }
    })
    expect(projects[0]).toMatchObject({
      name: 'Website',
      instructions: 'Use primary sources.',
      agentIds: ['planner', 'coder'],
      knowledgeBaseIds: ['shared']
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Project folder' })).toBeDisabled())
  })

  it('requires an explicit deletion confirmation and retains the project when deletion is refused', async () => {
    projects = [
      {
        id: 'project',
        name: 'Website',
        instructions: '',
        agentIds: ['coder'],
        knowledgeBaseIds: [],
        workspaceId: workspace.id,
        workspace,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt
      }
    ]
    remove.mockRejectedValueOnce(new Error('Remove the project sessions, including trash, first'))
    const user = userEvent.setup()
    render(<Page initialProjectId="project" />)
    await user.click(await screen.findByRole('button', { name: 'Delete project' }))
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm project deletion' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('including trash')
    expect(screen.getByRole('button', { name: 'Website' })).toBeInTheDocument()
  })
})
