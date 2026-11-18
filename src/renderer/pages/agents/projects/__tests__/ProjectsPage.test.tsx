import { MockUseDataApiUtils, mockUseMutation, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, useState } from 'react'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { AgentProjectEntity, CreateAgentProjectDto } from '@shared/data/api/schemas/agentProjects'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { KnowledgeBaseListItem } from '@shared/data/api/schemas/knowledges'

import type { AgentWorkspace } from '../../AgentPage'
import { type ProjectRouteSearch, ProjectsPage } from '../ProjectsPage'

vi.unmock('@cherrystudio/ui')

const projectSessions: AgentSessionEntity[] = []
vi.mock('@renderer/hooks/resourceViewSources', () => ({
  useAgentSessionsSource: () => ({ sessions: projectSessions })
}))
vi.mock('../../AgentPage', () => ({
  AgentWorkspace: ({ routeSearch, projectView }: ComponentProps<typeof AgentWorkspace>) => (
    <>
      {projectView?.renderSidebar({
        activeSessionId: routeSearch.sessionId,
        selectSession: (session) => projectView.onSessionChange(session.id),
        createSession: vi.fn(),
        requestNavigation: (transition) => transition()
      })}
      <output data-testid="open-project-session">{routeSearch.sessionId}</output>
    </>
  )
}))

function Page({ initialProjectId }: { initialProjectId?: string }) {
  const [selection, setSelection] = useState<ProjectRouteSearch>({ projectId: initialProjectId })
  return <ProjectsPage {...selection} onSelectionChange={setSelection} />
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
const remove = vi.fn(async () => {
  projects = []
})
const refetch = vi.fn(async () => projects)

beforeEach(async () => {
  MockUseDataApiUtils.resetMocks()
  vi.clearAllMocks()
  projects = []
  projectSessions.length = 0
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
  mockUseMutation.mockImplementation((method) => ({
    trigger: (method === 'DELETE' ? remove : save) as never,
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
  it('creates a project team and selects a coordinator in its settings', async () => {
    const user = userEvent.setup()
    render(<Page />)
    await user.click(screen.getByRole('button', { name: 'New project' }))
    await user.type(await screen.findByLabelText('Project name'), 'Website')
    await user.type(screen.getByLabelText('Shared project instructions'), 'Use primary sources.')
    await user.click(screen.getByRole('button', { name: 'Choose or add a folder' }))
    await user.click(await screen.findByText('Project folder', { exact: true }))
    await user.click(screen.getByRole('checkbox', { name: 'Planner' }))
    await user.click(screen.getByRole('checkbox', { name: 'Coder' }))
    await user.click(screen.getByRole('checkbox', { name: 'Shared research' }))
    screen.getByRole('combobox', { name: 'Coordinator' }).focus()
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('option', { name: 'Planner' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(projects[0]).toMatchObject({
        name: 'Website',
        instructions: 'Use primary sources.',
        agentIds: ['planner', 'coder'],
        coordinatorAgentId: 'planner',
        knowledgeBaseIds: ['shared']
      })
    )
    await user.click(await screen.findByRole('button', { name: 'Project settings for Website' }))
    expect(screen.getByRole('button', { name: 'Project folder' })).toBeDisabled()
  })

  it('shows only chats belonging to the selected project and its current team', async () => {
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
      },
      {
        id: 'other',
        name: 'Other',
        instructions: '',
        agentIds: ['coder'],
        knowledgeBaseIds: [],
        workspaceId: 'other-folder',
        workspace: { ...workspace, id: 'other-folder' },
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt
      }
    ]
    const session = {
      id: 'site-chat',
      name: 'Website chat',
      isNameManuallyEdited: true,
      agentId: 'coder',
      projectId: 'project',
      workspaceId: workspace.id,
      workspace,
      orderKey: 'a0',
      lastActivityAt: workspace.updatedAt,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt
    }
    projectSessions.push(
      session,
      { ...session, id: 'removed-chat', name: 'Removed member chat', agentId: 'planner' },
      { ...session, id: 'other-chat', name: 'Other project chat', projectId: 'other', workspaceId: 'other-folder' }
    )
    const user = userEvent.setup()
    render(<Page initialProjectId="project" />)
    expect(screen.queryByRole('button', { name: 'Removed member chat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Other project chat' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Website chat' }))
    expect(screen.getByTestId('open-project-session')).toHaveTextContent('site-chat')
    await user.click(screen.getByRole('button', { name: 'Other' }))
    expect(screen.queryByRole('button', { name: 'Website chat' })).not.toBeInTheDocument()
    expect(screen.getByTestId('open-project-session')).toBeEmptyDOMElement()
    await user.click(screen.getByRole('button', { name: 'Other project chat' }))
    expect(screen.getByTestId('open-project-session')).toHaveTextContent('other-chat')
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
    await user.click(screen.getByRole('button', { name: 'Project settings for Website' }))
    await user.click(await screen.findByRole('button', { name: 'Delete project' }))
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm project deletion' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('including trash')
    expect(projects).toHaveLength(1)
  })
})
