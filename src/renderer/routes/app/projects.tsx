import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'

import { type ProjectRouteSearch, ProjectsPage } from '@renderer/pages/agents/projects/ProjectsPage'

function optionalId(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

export const Route = createFileRoute('/app/projects')({
  validateSearch: (search: Record<string, unknown>): ProjectRouteSearch => ({
    projectId: optionalId(search.projectId),
    sessionId: optionalId(search.sessionId),
    forkReturnSessionId: optionalId(search.forkReturnSessionId)
  }),
  component: ProjectsRoute
})

function ProjectsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const onSelectionChange = useCallback(
    (selection: ProjectRouteSearch) => void navigate({ search: selection, replace: true }),
    [navigate]
  )

  return <ProjectsPage {...search} onSelectionChange={onSelectionChange} />
}
