import DOMPurify from 'dompurify'
import sandboxUrl from 'virtual:plantuml-sandbox-url'

const MAX_SOURCE_CHARACTERS = 100_000
const MAX_SVG_CHARACTERS = 8 * 1024 * 1024
const LOCAL_PAINT = /^url\(\s*['"]?#[\w:.-]+['"]?\s*\)$/i
const STYLE_PROPERTIES = new Set([
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'text-decoration',
  'text-anchor',
  'dominant-baseline',
  'color'
])

function safePaintValue(value: string): boolean {
  if (/[\\@]/.test(value)) return false
  return !/url\s*\(/i.test(value) || LOCAL_PAINT.test(value)
}

function safeStyleValue(value: string): boolean {
  return (
    safePaintValue(value) &&
    (!value.includes('(') || LOCAL_PAINT.test(value) || /^(?:rgba?|hsla?)\([\d.,%+\-\s/]+\)$/i.test(value))
  )
}

export function sanitizeOfflineDiagramSvg(svg: string): string {
  const clean = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'],
    FORBID_TAGS: [
      'script',
      'style',
      'foreignObject',
      'image',
      'feImage',
      'animate',
      'animateMotion',
      'animateTransform',
      'set',
      'a'
    ]
  })
  const document = new DOMParser().parseFromString(clean, 'image/svg+xml')
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg')
    throw new Error('Invalid local diagram')
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (['href', 'src', 'base'].includes(attribute.localName) && !/^#[\w:.-]+$/.test(attribute.value)) {
        element.removeAttribute(attribute.name)
      } else if (attribute.name === 'style') {
        const style = (element as SVGElement).style
        if (!style) {
          element.removeAttribute('style')
          continue
        }
        for (const property of Array.from({ length: style.length }, (_, index) => style.item(index))) {
          if (!STYLE_PROPERTIES.has(property) || !safeStyleValue(style.getPropertyValue(property)))
            style.removeProperty(property)
        }
      } else if (
        !safePaintValue(attribute.value) ||
        (STYLE_PROPERTIES.has(attribute.name) && !safeStyleValue(attribute.value))
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return new XMLSerializer().serializeToString(document.documentElement)
}

export function renderLocalPlantuml(source: string, signal?: AbortSignal): Promise<string> {
  if (source.length > MAX_SOURCE_CHARACTERS) return Promise.reject(new Error('Diagram is too large'))
  if (signal?.aborted) return Promise.reject(new DOMException('Rendering cancelled', 'AbortError'))

  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    const id = crypto.randomUUID()
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    frame.style.cssText = 'position:absolute;left:-10000px;width:1px;height:1px;border:0;pointer-events:none'
    frame.src = new URL(sandboxUrl, document.baseURI).href

    const cleanup = () => {
      clearTimeout(timeout)
      window.removeEventListener('message', receive)
      signal?.removeEventListener('abort', abort)
      frame.remove()
    }
    const abort = () => {
      cleanup()
      reject(new DOMException('Rendering cancelled', 'AbortError'))
    }
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return
      const message = event.data as { type?: unknown; id?: unknown; svg?: unknown; error?: unknown }
      if (message.type === 'plantuml-ready') {
        frame.contentWindow?.postMessage({ type: 'plantuml-render', id, source }, '*')
        return
      }
      if (message.type !== 'plantuml-result' || message.id !== id) return
      cleanup()
      if (typeof message.svg !== 'string' || message.svg.length > MAX_SVG_CHARACTERS) {
        reject(
          new Error(typeof message.error === 'string' ? message.error.slice(0, 1000) : 'Invalid local diagram result')
        )
        return
      }
      try {
        resolve(sanitizeOfflineDiagramSvg(message.svg))
      } catch (error) {
        reject(error)
      }
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Local diagram rendering timed out'))
    }, 20_000)
    window.addEventListener('message', receive)
    signal?.addEventListener('abort', abort, { once: true })
    document.body.appendChild(frame)
  })
}
