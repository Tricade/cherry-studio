import type { WebviewTag } from 'electron'
import { useEffect, useRef, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { EventPayload, InputFor } from '@shared/ipc/types'
import { Sequencer } from '@shared/utils/async'

const logger = loggerService.withContext('useAgentBrowserGuest')

export function useAgentBrowserGuest(
  sessionId: string | undefined,
  guest: WebviewTag | null,
  revision: number,
  scope?: 'agent' | 'topic'
): string | undefined {
  const [binding, setBinding] = useState<{ guest: WebviewTag; sessionId: string; tabId: string }>()
  const operations = useRef(new Sequencer())
  useEffect(() => {
    if (!sessionId || !guest) return
    const queue = operations.current
    let cancelled = false
    let attaching = false
    let tabId: string | undefined
    const ownerDocument = guest.ownerDocument
    let savedFocus: { element: HTMLElement; requestId: string } | undefined
    const clearSavedFocus = () => {
      savedFocus = undefined
      ownerDocument.removeEventListener('focusin', onHostFocus)
    }
    const onHostFocus = (event: FocusEvent) => {
      if (event.target !== guest && event.target !== savedFocus?.element) clearSavedFocus()
    }
    const matches = (request: EventPayload<'browser.input.restore_requested'>) =>
      request.sessionId === sessionId && request.scope === (scope ?? 'agent') && request.tabId === tabId
    const unsubscribeFocus = ipcApi.on('browser.input.focus_requested', (request) => {
      if (!matches(request) || request.expiresAt <= Date.now()) return
      let status: InputFor<'browser.input.focused'>['status'] = 'unavailable'
      try {
        if (guest.isConnected) {
          const activeElement = ownerDocument.activeElement
          status = guest.closest('[inert]') || activeElement !== guest ? 'background' : 'focused'
          if (request.captureHostFocus) {
            clearSavedFocus()
            if (
              ownerDocument.hasFocus() &&
              activeElement instanceof HTMLElement &&
              (activeElement.isContentEditable ||
                activeElement instanceof HTMLInputElement ||
                activeElement instanceof HTMLTextAreaElement)
            ) {
              savedFocus = { element: activeElement, requestId: request.requestId }
              ownerDocument.addEventListener('focusin', onHostFocus)
            }
          }
        }
      } catch (error) {
        logger.debug('Browser guest could not receive input focus', { error })
      }
      void ipcApi
        .request('browser.input.focused', {
          sessionId: request.sessionId,
          scope: request.scope,
          tabId: request.tabId,
          requestId: request.requestId,
          status
        })
        .catch((error) => logger.debug('Browser input focus request ended', { error }))
    })
    const unsubscribeRestore = ipcApi.on('browser.input.restore_requested', (request) => {
      if (!matches(request) || savedFocus?.requestId !== request.requestId) return
      const { element } = savedFocus
      clearSavedFocus()
      if (ownerDocument.activeElement === guest && element.isConnected && !element.closest('[inert]')) {
        element.focus({ preventScroll: true })
      }
    })
    const detach = (id: string) =>
      ipcApi.request('browser.pane.detach', { sessionId, tabId: id, ...(scope ? { scope } : {}) })
    const attach = () => {
      if (attaching || tabId) return
      attaching = true
      void queue.queue(async () => {
        try {
          if (cancelled) return
          const webviewId = guest.getWebContentsId()
          if (!webviewId) return
          const result = await ipcApi.request('browser.pane.attach', {
            sessionId,
            webviewId,
            ...(scope ? { scope } : {})
          })
          if (cancelled) await detach(result.tabId)
          else {
            tabId = result.tabId
            setBinding({ guest, sessionId, tabId })
          }
        } catch (error) {
          logger.debug('Browser guest is not ready to attach', { error })
        } finally {
          attaching = false
        }
      })
    }
    guest.addEventListener('dom-ready', attach)
    attach()
    return () => {
      cancelled = true
      clearSavedFocus()
      unsubscribeFocus()
      unsubscribeRestore()
      guest.removeEventListener('dom-ready', attach)
      if (tabId) {
        const detachedId = tabId
        void queue
          .queue(() => detach(detachedId))
          .catch((error) => logger.debug('Browser guest already detached', { error }))
      }
    }
  }, [sessionId, guest, revision, scope])
  return binding?.guest === guest && binding?.sessionId === sessionId ? binding?.tabId : undefined
}
