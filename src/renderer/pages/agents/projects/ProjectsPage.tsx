import { ChevronDown, ChevronRight, Folder, MessageSquare, Plus, Settings2 } from 'lucide-react'
import { lazy, Suspense, useCallback, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { AgentCreateDialog } from '@renderer/components/resourceCatalog/dialogs/create'
import { WorkspaceSelector } from '@renderer/components/resourceCatalog/selectors'
import { useDataChange, useMutation, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useAgentSessionsSource } from '@renderer/hooks/resourceViewSources'
import { useCreateKnowledgeBase, useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { formatErrorMessage } from '@renderer/utils/error'
import type { AgentProjectEntity, CreateAgentProjectDto } from '@shared/data/api/schemas/agentProjects'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { AgentWorkspace } from '../AgentPage'

const CreateKnowledgeBaseDialog = lazy(() => import('@renderer/components/knowledge/CreateKnowledgeBaseDialog'))
const logger = loggerService.withContext('ProjectsPage')

export type ProjectRouteSearch = {
  projectId?: string
  sessionId?: string
  forkReturnSessionId?: string
}

type ProjectsPageProps = ProjectRouteSearch & {
  onSelectionChange: (search: ProjectRouteSearch) => void
}

export function ProjectsPage({ projectId, sessionId, forkReturnSessionId, onSelectionChange }: ProjectsPageProps) {
  const { t } = useTranslation()
  const [editorId, setEditorId] = useState<string | null>(null)
  const { data: projects, isLoading, error, refetch } = useQuery('/agent-projects')
  useDataChange('/agent-projects', () => void refetch())
  const { agents } = useAgents()
  const sessionsSource = useAgentSessionsSource()
  const selected = projectId ? projects?.find((project) => project.id === projectId) : projects?.[0]
  const selectedId = selected?.id
  const editing = projects?.find((project) => project.id === editorId)
  const onSessionChange = useCallback(
    (id?: string) => onSelectionChange({ projectId: selectedId, sessionId: id }),
    [onSelectionChange, selectedId]
  )

  return (
    <>
      <AgentWorkspace
        key={selectedId}
        routeSearch={{ sessionId: selectedId ? sessionId : undefined, forkReturnSessionId }}
        projectView={{
          project: selected,
          onSessionChange,
          renderSidebar: ({ activeSessionId, selectSession, createSession, requestNavigation }) => (
            <nav aria-label={t('project.title')} className="flex h-full min-h-0 flex-col gap-2 px-2 py-2">
              <Button variant="outline" onClick={() => setEditorId('new')}>
                <Plus />
                {t('project.new')}
              </Button>
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                {error ? (
                  <div className="space-y-1 px-2">
                    <p role="alert" className="text-destructive text-sm">
                      {formatErrorMessage(error)}
                    </p>
                    <Button variant="outline" size="sm" onClick={() => void refetch()}>
                      {t('common.retry')}
                    </Button>
                  </div>
                ) : isLoading ? (
                  <p role="status" className="px-2 text-muted-foreground text-sm">
                    {t('common.loading')}
                  </p>
                ) : projectId && !selected ? (
                  <p className="px-2 text-muted-foreground text-sm">{t('project.not_found')}</p>
                ) : null}
                {projects?.map((project) => {
                  const active = project.id === selectedId
                  const Chevron = active ? ChevronDown : ChevronRight
                  return (
                    <section key={project.id}>
                      <div className="flex min-w-0 items-center gap-1">
                        <Button
                          variant={active ? 'secondary' : 'ghost'}
                          className="min-w-0 flex-1 justify-start"
                          aria-expanded={active}
                          onClick={() => {
                            if (!active) requestNavigation(() => onSelectionChange({ projectId: project.id }))
                          }}>
                          <Chevron />
                          <Folder />
                          <span className="truncate">{project.name}</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('project.settings_for', { name: project.name })}
                          onClick={() => setEditorId(project.id)}>
                          <Settings2 />
                        </Button>
                      </div>
                      {active ? (
                        <ProjectTeam
                          project={project}
                          agents={agents}
                          sessionsSource={sessionsSource}
                          activeSessionId={activeSessionId}
                          onSelectSession={selectSession}
                          onCreateSession={createSession}
                        />
                      ) : null}
                    </section>
                  )
                })}
              </div>
            </nav>
          )
        }}
      />
      {editorId === 'new' || editing ? (
        <ProjectSettingsDialog
          key={editorId}
          project={editing}
          projects={projects ?? []}
          onClose={() => setEditorId(null)}
          onSaved={(project) => {
            setEditorId(null)
            if (!editing) onSelectionChange({ projectId: project.id })
          }}
          onDeleted={() => {
            setEditorId(null)
            if (editorId === selectedId) onSelectionChange({})
          }}
        />
      ) : null}
    </>
  )
}

function ProjectTeam({
  project,
  agents,
  sessionsSource,
  activeSessionId,
  onSelectSession,
  onCreateSession
}: {
  project: AgentProjectEntity
  agents: readonly AgentEntity[]
  sessionsSource: ReturnType<typeof useAgentSessionsSource>
  activeSessionId?: string
  onSelectSession: (session: AgentSessionEntity) => void
  onCreateSession: (agentId: string) => void
}) {
  const { t } = useTranslation()
  const members = agents.filter((agent) => project.agentIds.includes(agent.id))
  const sessions = Map.groupBy(
    sessionsSource.sessions.filter(
      (session) => session.projectId === project.id && session.workspaceId === project.workspaceId
    ),
    (session) => session.agentId
  )
  const error = sessionsSource.error ?? sessionsSource.refreshError

  return (
    <div className="ml-3 space-y-1 border-border border-l py-1 pl-2">
      {error ? (
        <>
          <p role="alert" className="px-2 text-destructive text-sm">
            {formatErrorMessage(error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void sessionsSource.reload()}>
            {t('common.retry')}
          </Button>
        </>
      ) : sessionsSource.isLoading ? (
        <p role="status" className="px-2 text-muted-foreground text-sm">
          {t('common.loading')}
        </p>
      ) : members.length === 0 ? (
        <p className="px-2 text-muted-foreground text-sm">{t('project.no_team')}</p>
      ) : null}
      {members.map((agent) => (
        <section key={agent.id}>
          <div className="flex min-w-0 items-center gap-1 pl-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-medium text-sm">{agent.name}</h2>
              {project.coordinatorAgentId === agent.id ? (
                <span className="text-muted-foreground text-xs">{t('project.coordinator')}</span>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('project.new_chat_for', { name: agent.name })}
              onClick={() => onCreateSession(agent.id)}>
              <Plus />
            </Button>
          </div>
          {sessions.get(agent.id)?.map((session) => (
            <Button
              key={session.id}
              variant={session.id === activeSessionId ? 'secondary' : 'ghost'}
              className="flex w-full justify-start pl-4"
              aria-pressed={session.id === activeSessionId}
              onClick={() => onSelectSession(session)}>
              <MessageSquare />
              <span className="truncate">{session.name || t('agent.session.new')}</span>
            </Button>
          ))}
        </section>
      ))}
    </div>
  )
}

function ProjectSettingsDialog({
  project,
  projects,
  onClose,
  onSaved,
  onDeleted
}: {
  project?: AgentProjectEntity
  projects: readonly AgentProjectEntity[]
  onClose: () => void
  onSaved: (project: AgentProjectEntity) => void
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { agents, isLoading: agentsLoading, error: agentsError, refetch: refetchAgents } = useAgents()
  const { bases, isLoading: basesLoading, error: basesError, refetch: refetchBases } = useKnowledgeBases()
  const { trigger: create } = useMutation('POST', '/agent-projects', { refresh: ['/agent-projects'] })
  const { trigger: update } = useMutation('PATCH', '/agent-projects/:projectId', { refresh: ['/agent-projects'] })
  const { trigger: remove } = useMutation('DELETE', '/agent-projects/:projectId', {
    refresh: ['/agent-projects', '/agent-workspaces']
  })
  const resourceError = agentsError ?? basesError

  const save = async (body: CreateAgentProjectDto) => {
    if (busyRef.current) return
    if (projects.some((other) => other.id !== project?.id && other.workspaceId === body.workspaceId)) {
      setError(t('project.workspace_in_use'))
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const { workspaceId, ...updateBody } = body
      const saved = project
        ? await update({ params: { projectId: project.id }, body: updateBody })
        : await create({ body: { ...updateBody, workspaceId } })
      onSaved(saved)
    } catch (err) {
      logger.error('Failed to save project', { error: err, projectId: project?.id })
      setError(formatErrorMessage(err))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const deleteProject = async () => {
    if (!project || !confirmDelete || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await remove({ params: { projectId: project.id } })
      onDeleted()
    } catch (err) {
      logger.error('Failed to delete project', { error: err, projectId: project.id })
      setError(formatErrorMessage(err))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busyRef.current && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{project ? t('project.settings_for', { name: project.name }) : t('project.new')}</DialogTitle>
          <DialogDescription>{t('project.description')}</DialogDescription>
        </DialogHeader>
        {resourceError || error ? (
          <p role="alert" className="text-destructive text-sm">
            {error ?? formatErrorMessage(resourceError)}
          </p>
        ) : null}
        {resourceError ? (
          <Button variant="outline" onClick={() => void Promise.all([refetchAgents(), refetchBases()])}>
            {t('common.retry')}
          </Button>
        ) : null}
        {agentsLoading || basesLoading ? <p role="status">{t('common.loading')}</p> : null}
        <ProjectEditor
          project={project}
          agents={agents}
          bases={bases}
          busy={busy || agentsLoading || basesLoading || !!resourceError}
          onSave={save}
        />
        {project ? (
          <div className="space-y-2 border-border border-t pt-3">
            <p className="text-muted-foreground text-xs">{t('project.delete_hint')}</p>
            {confirmDelete ? (
              <div className="flex gap-2">
                <Button variant="destructive" disabled={busy} onClick={() => void deleteProject()}>
                  {t('project.delete_confirm')}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            ) : (
              <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)}>
                {t('project.delete')}
              </Button>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ProjectEditor({
  project,
  agents,
  bases,
  busy,
  onSave
}: {
  project?: AgentProjectEntity
  agents: readonly AgentEntity[]
  bases: readonly { id: string; name: string }[]
  busy: boolean
  onSave: (body: CreateAgentProjectDto) => Promise<void>
}) {
  const { t } = useTranslation()
  const id = useId()
  const [name, setName] = useState(project?.name ?? '')
  const [instructions, setInstructions] = useState(project?.instructions ?? '')
  const [workspaceId, setWorkspaceId] = useState<string | null>(project?.workspaceId ?? null)
  const [resourceDialog, setResourceDialog] = useState<'agent' | 'knowledge' | null>(null)
  const { createBase, isCreating } = useCreateKnowledgeBase()
  const [agentIds, setAgentIds] = useState(project?.agentIds ?? [])
  const [coordinator, setCoordinator] = useState(project?.coordinatorAgentId ?? null)
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState(project?.knowledgeBaseIds ?? [])
  const { data: workspaces } = useQuery('/agent-workspaces')
  const workspace = workspaces?.find((item) => item.id === workspaceId) ?? project?.workspace
  const canSave = !!name.trim() && !!workspaceId && !busy
  const toggle = (ids: string[], item: string, checked: boolean) =>
    checked ? [...new Set([...ids, item])] : ids.filter((value) => value !== item)
  const team = agents.filter((agent) => agentIds.includes(agent.id))
  const coordinatorAgentId = team.some((agent) => agent.id === coordinator) ? coordinator : null
  const submit = () => {
    if (canSave && workspaceId)
      void onSave({ name: name.trim(), instructions, workspaceId, agentIds, knowledgeBaseIds, coordinatorAgentId })
  }
  const unavailableAgents = agentIds.filter((agentId) => !agents.some((agent) => agent.id === agentId))

  return (
    <>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}>
        <fieldset disabled={busy} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-name`}>{t('project.name')}</Label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-instructions`}>{t('project.instructions')}</Label>
            <Textarea.Input
              id={`${id}-instructions`}
              value={instructions}
              onValueChange={setInstructions}
              maxLength={100000}
              rows={4}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('project.workspace')}</Label>
            <WorkspaceSelector
              value={workspaceId}
              onChange={setWorkspaceId}
              disabled={!!project || busy}
              trigger={
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start truncate"
                  disabled={!!project || busy}>
                  {workspace?.name ?? t('project.choose_workspace')}
                </Button>
              }
            />
            {workspace ? <p className="break-all text-muted-foreground text-xs">{workspace.path}</p> : null}
            <p className="text-muted-foreground text-xs">{t('project.workspace_hint')}</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 font-medium text-sm">{t('project.agents')}</legend>
            <p className="text-muted-foreground text-xs">{t('project.agents_hint')}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setResourceDialog('agent')}>
              <Plus />
              {t('agent.add.title')}
            </Button>
            {[
              ...agents,
              ...unavailableAgents.map((agentId) => ({
                id: agentId,
                name: t('project.unavailable_agent', { id: agentId })
              }))
            ].map((agent) => (
              <Label key={agent.id} className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={agentIds.includes(agent.id)}
                  onCheckedChange={(checked) => {
                    setAgentIds(toggle(agentIds, agent.id, checked === true))
                    if (checked !== true && coordinator === agent.id) setCoordinator(null)
                  }}
                />
                {agent.name}
              </Label>
            ))}
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor={id + '-coordinator'}>{t('project.coordinator')}</Label>
            <Select
              value={coordinatorAgentId ?? 'none'}
              onValueChange={(value) => setCoordinator(value === 'none' ? null : value)}>
              <SelectTrigger id={id + '-coordinator'} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('project.no_coordinator')}</SelectItem>
                {team.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{t('project.coordinator_hint')}</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 font-medium text-sm">{t('project.knowledge')}</legend>
            <p className="text-muted-foreground text-xs">{t('project.knowledge_hint')}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setResourceDialog('knowledge')}>
              <Plus />
              {t('knowledge.add.title')}
            </Button>
            {bases.map((base) => (
              <Label key={base.id} className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={knowledgeBaseIds.includes(base.id)}
                  onCheckedChange={(checked) =>
                    setKnowledgeBaseIds(toggle(knowledgeBaseIds, base.id, checked === true))
                  }
                />
                {base.name}
              </Label>
            ))}
          </fieldset>
          <p className="text-muted-foreground text-xs">{t('project.resources_hint')}</p>
          <p className="text-muted-foreground text-xs">{t('project.memory_hint')}</p>
          <Button type="submit" disabled={!canSave}>
            {t('common.save')}
          </Button>
        </fieldset>
      </form>
      {resourceDialog === 'agent' ? (
        <AgentCreateDialog
          open
          includeKnowledge={false}
          onOpenChange={(open) => {
            if (!open) setResourceDialog(null)
          }}
          onCreated={(agentId) => setAgentIds((ids) => toggle(ids, agentId, true))}
        />
      ) : resourceDialog === 'knowledge' ? (
        <Suspense fallback={null}>
          <CreateKnowledgeBaseDialog
            open
            groups={[]}
            isCreating={isCreating}
            createBase={createBase}
            onOpenChange={(open) => {
              if (!open) setResourceDialog(null)
            }}
            onCreated={(base) => setKnowledgeBaseIds((ids) => toggle(ids, base.id, true))}
          />
        </Suspense>
      ) : null}
    </>
  )
}
