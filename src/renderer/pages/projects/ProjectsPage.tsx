import { MessageSquare, Plus } from 'lucide-react'
import { lazy, Suspense, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Checkbox, Input, Label, Textarea } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { AgentCreateDialog } from '@renderer/components/resourceCatalog/dialogs/create'
import { WorkspaceSelector } from '@renderer/components/resourceCatalog/selectors'
import {
  useDataChange,
  useInfiniteFlatItems,
  useInfiniteQuery,
  useMutation,
  useQuery
} from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useCreateKnowledgeBase, useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { openRoute } from '@renderer/services/mainWindowNavigation'
import { formatErrorMessage } from '@renderer/utils/error'
import type { AgentProjectEntity, CreateAgentProjectDto } from '@shared/data/api/schemas/agentProjects'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

const CreateKnowledgeBaseDialog = lazy(() => import('@renderer/components/knowledge/CreateKnowledgeBaseDialog'))
const logger = loggerService.withContext('ProjectsPage')

type ProjectsPageProps = {
  projectId?: string
  onProjectIdChange: (id?: string) => void
}

export function ProjectsPage({ projectId, onProjectIdChange }: ProjectsPageProps) {
  const { t } = useTranslation()
  const selectedId = projectId ?? 'new'
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { data: projects, isLoading, error: loadError, refetch } = useQuery('/agent-projects')
  useDataChange('/agent-projects', () => void refetch())
  const { agents, isLoading: agentsLoading, error: agentsError, refetch: refetchAgents } = useAgents()
  const { bases, isLoading: basesLoading, error: basesError, refetch: refetchBases } = useKnowledgeBases()
  const { trigger: create } = useMutation('POST', '/agent-projects', { refresh: ['/agent-projects'] })
  const { trigger: update } = useMutation('PATCH', '/agent-projects/:projectId', { refresh: ['/agent-projects'] })
  const { trigger: remove } = useMutation('DELETE', '/agent-projects/:projectId', {
    refresh: ['/agent-projects', '/agent-workspaces']
  })
  const { trigger: createSession } = useMutation('POST', '/agent-sessions', { refresh: ['/agent-sessions'] })
  const [, setSessionDisplayMode] = usePreference('agent.session.display_mode')
  const selected = projects?.find((project) => project.id === selectedId)
  const resourceError = loadError ?? agentsError ?? basesError

  const select = (id: string) => {
    onProjectIdChange(id === 'new' ? undefined : id)
    setError(null)
    setConfirmDelete(false)
  }

  const save = async (body: CreateAgentProjectDto, agentId?: string) => {
    if (busyRef.current) return
    if (projects?.some((project) => project.id !== selectedId && project.workspaceId === body.workspaceId)) {
      setError(t('project.workspace_in_use'))
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const project = selected
        ? await update({
            params: { projectId: selected.id },
            body: {
              name: body.name,
              instructions: body.instructions,
              agentIds: body.agentIds,
              knowledgeBaseIds: body.knowledgeBaseIds
            }
          })
        : await create({ body })
      select(project.id)
      if (agentId) {
        const session = await createSession({
          body: {
            name: '',
            projectId: project.id,
            agentId,
            workspace: { type: 'user', workspaceId: project.workspaceId }
          }
        })
        await setSessionDisplayMode('project')
        openRoute('/app/agents', { sessionId: session.id })
      }
    } catch (err) {
      logger.error('Failed to save or start project', { error: err, projectId: selected?.id })
      setError(formatErrorMessage(err))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const deleteProject = async () => {
    if (!selected || !confirmDelete || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await remove({ params: { projectId: selected.id } })
      select('new')
      await refetch()
    } catch (err) {
      logger.error('Failed to delete project', { error: err, projectId: selected.id })
      setError(formatErrorMessage(err))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
        <header className="space-y-1">
          <h1 className="font-semibold text-lg">{t('project.title')}</h1>
          <p className="text-muted-foreground text-sm">{t('project.description')}</p>
        </header>
        <div className="grid min-h-0 gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label={t('project.title')} className="flex flex-col gap-1">
            <Button variant="outline" disabled={busy} onClick={() => select('new')}>
              <Plus />
              {t('project.new')}
            </Button>
            {projects?.map((project) => (
              <Button
                key={project.id}
                variant={selectedId === project.id ? 'secondary' : 'ghost'}
                className="justify-start truncate"
                disabled={busy}
                aria-pressed={selectedId === project.id}
                onClick={() => select(project.id)}>
                {project.name}
              </Button>
            ))}
          </nav>
          <div className="min-w-0 space-y-4">
            {resourceError || error ? (
              <p role="alert" className="text-destructive text-sm">
                {error ?? formatErrorMessage(resourceError)}
              </p>
            ) : null}
            {resourceError ? (
              <Button variant="outline" onClick={() => void Promise.all([refetch(), refetchAgents(), refetchBases()])}>
                {t('common.retry')}
              </Button>
            ) : null}
            {isLoading || agentsLoading || basesLoading ? <p role="status">{t('common.loading')}</p> : null}
            {selectedId === 'new' || selected ? (
              <ProjectEditor
                key={selectedId}
                project={selected}
                agents={agents}
                bases={bases}
                busy={busy || isLoading || agentsLoading || basesLoading || !!resourceError}
                onSave={save}
              />
            ) : !isLoading && !resourceError ? (
              <p className="text-muted-foreground text-sm">{t('project.not_found')}</p>
            ) : null}
            {selected ? <ProjectSessions key={'sessions:' + selected.id} projectId={selected.id} /> : null}
            {selected ? (
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
          </div>
        </div>
      </div>
    </main>
  )
}

function ProjectSessions({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const { pages, isLoading, error, hasNext, isRefreshing, loadNext, refresh } = useInfiniteQuery('/agent-sessions', {
    query: { projectId },
    limit: 20
  })
  useDataChange('/agent-sessions', () => void refresh())
  const sessions = useInfiniteFlatItems(pages)

  return (
    <section className="space-y-2 border-border border-t pt-4">
      <h2 className="font-medium text-sm">{t('agent.session.group.conversation')}</h2>
      {error ? (
        <div className="space-y-2">
          <p role="alert" className="text-destructive text-sm">
            {formatErrorMessage(error)}
          </p>
          <Button variant="outline" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : isLoading ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t('common.loading')}
        </p>
      ) : sessions.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('project.conversations_empty')}</p>
      ) : null}
      {sessions.map((session) => (
        <Button
          key={session.id}
          variant="ghost"
          className="flex w-full justify-start"
          onClick={() => openRoute('/app/agents', { sessionId: session.id })}>
          <MessageSquare />
          <span className="truncate">{session.name || t('common.unnamed')}</span>
        </Button>
      ))}
      {hasNext ? (
        <Button variant="outline" disabled={isRefreshing} onClick={() => loadNext()}>
          {t('agent.session.group.show_more')}
        </Button>
      ) : null}
    </section>
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
  onSave: (body: CreateAgentProjectDto, agentId?: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const id = useId()
  const [name, setName] = useState(project?.name ?? '')
  const [instructions, setInstructions] = useState(project?.instructions ?? '')
  const [workspaceId, setWorkspaceId] = useState<string | null>(project?.workspaceId ?? null)
  const [resourceDialog, setResourceDialog] = useState<'agent' | 'knowledge' | null>(null)
  const { createBase, isCreating } = useCreateKnowledgeBase()
  const [agentIds, setAgentIds] = useState(project?.agentIds ?? [])
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState(project?.knowledgeBaseIds ?? [])
  const { data: workspaces } = useQuery('/agent-workspaces')
  const workspace = workspaces?.find((item) => item.id === workspaceId) ?? project?.workspace
  const canSave = !!name.trim() && !!workspaceId && !busy
  const toggle = (ids: string[], item: string, checked: boolean) =>
    checked ? [...new Set([...ids, item])] : ids.filter((value) => value !== item)
  const submit = (agentId?: string) => {
    if (canSave && workspaceId)
      void onSave({ name: name.trim(), instructions, workspaceId, agentIds, knowledgeBaseIds }, agentId)
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
                  onCheckedChange={(checked) => setAgentIds(toggle(agentIds, agent.id, checked === true))}
                />
                {agent.name}
              </Label>
            ))}
          </fieldset>
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
          <div className="flex flex-wrap gap-2">
            {agents
              .filter((agent) => agentIds.includes(agent.id))
              .map((agent) => (
                <Button
                  key={agent.id}
                  type="button"
                  variant="outline"
                  disabled={!canSave}
                  onClick={() => submit(agent.id)}>
                  {t('project.save_and_start', { name: agent.name })}
                </Button>
              ))}
          </div>
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
