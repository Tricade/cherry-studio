import { createFileRoute } from '@tanstack/react-router'
import { useCallback } from 'react'

import { ProjectsPage } from '@renderer/pages/projects/ProjectsPage'

export const Route = createFileRoute('/app/projects')({
  validateSearch: (search: Record<string, unknown>): { projectId?: string } =>
    typeof search.projectId === 'string' && search.projectId.trim() ? { projectId: search.projectId.trim() } : {},
  component: ProjectsRoute
})

function ProjectsRoute() {
  const { projectId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const handleProjectIdChange = useCallback(
    (id?: string) => void navigate({ search: id ? { projectId: id } : {}, replace: true }),
    [navigate]
  )

  return <ProjectsPage projectId={projectId} onProjectIdChange={handleProjectIdChange} />
}
