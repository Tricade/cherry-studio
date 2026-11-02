import { renderToString } from '@plantuml/core'
import '@plantuml/core/emoji.js'
import '@plantuml/core/openiconic.js'
import '@plantuml/core/themes.js'
import { instance } from '@viz-js/viz'

const environment = globalThis as typeof globalThis & {
  PLANTUML_VIZ: { instance: typeof instance }
  PLANTUML_STDLIB_LOADER: (name: string, success: () => void, fail: (message: string) => void) => void
  PLANTUML_FILE_LOADER: (
    name: string,
    from: string,
    success: (id: string, text: string) => void,
    fail: (message: string) => void
  ) => void
}
environment.PLANTUML_VIZ = { instance }
environment.PLANTUML_STDLIB_LOADER = (_name, _success, fail) => fail('External diagram resources are disabled')
environment.PLANTUML_FILE_LOADER = (_name, _from, _success, fail) => fail('External diagram resources are disabled')

let started = false
window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || started || !event.data || typeof event.data !== 'object') return
  const input = event.data as { type?: unknown; source?: unknown; id?: unknown }
  if (
    input.type !== 'plantuml-render' ||
    typeof input.id !== 'string' ||
    typeof input.source !== 'string' ||
    input.source.length > 100_000
  )
    return
  started = true
  const send = (result: { svg: string } | { error: string }) =>
    window.parent.postMessage({ type: 'plantuml-result', id: input.id, ...result }, '*')
  try {
    renderToString(
      input.source.split(/\r\n|\r|\n/),
      (svg: string) => send({ svg }),
      (error: string) => send({ error: String(error) }),
      { maxSvgSize: 8192 }
    )
  } catch {
    send({ error: 'Local diagram rendering failed' })
  }
})
window.parent.postMessage({ type: 'plantuml-ready' }, '*')
