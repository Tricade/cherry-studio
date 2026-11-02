import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderLocalPlantuml, sanitizeOfflineDiagramSvg } from '../localPlantuml'

const svg = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`

describe('offline diagram SVG', () => {
  it('keeps diagram geometry, labels and local gradients while removing executable or network-bearing content', () => {
    const result = sanitizeOfflineDiagramSvg(
      svg(`
      <defs><linearGradient id="local"><stop stop-color="red"/></linearGradient><path id="shape" d="M0 0 L2 2"/></defs>
      <rect id="safe" width="100" height="80" fill="url(#local)" style="stroke:rgb(1,2,3);stroke-width:2"/>
      <text>Offline label</text><use href="#shape"/>
      <script>alert(1)</script><style>@import 'https://example.invalid/style';</style>
      <image href="https://example.invalid/image"/><feImage href="https://example.invalid/filter"/>
      <foreignObject><iframe src="https://example.invalid/frame"/></foreignObject>
      <a href="https://example.invalid/link"><text>Link label</text></a>
      <use href="https://example.invalid/use#shape"/>
      <rect id="unsafe" fill="url(https://example.invalid/paint)" filter="url(https://example.invalid/filter)"
        onload="alert(2)" style="fill:var(--remote);stroke:url(https://example.invalid/stroke);background-image:url(https://example.invalid/background)"/>
      <set attributeName="href" to="https://example.invalid/later"/>
      <animate attributeName="fill" values="url(https://example.invalid/animated)"/>
    `)
    )
    const document = new DOMParser().parseFromString(result, 'image/svg+xml')
    expect(document.querySelector('text')?.textContent).toBe('Offline label')
    expect(document.querySelector('#safe')?.getAttribute('fill')).toBe('url(#local)')
    expect(document.querySelector('#safe')?.getAttribute('width')).toBe('100')
    expect(document.querySelector('use')?.getAttribute('href')).toBe('#shape')
    expect(document.querySelector('script,style,image,feImage,foreignObject,a,set,animate')).toBeNull()
    expect(result).not.toMatch(/example\.invalid|onload|var\(/)
  })

  it('rejects escaped CSS resource functions and non-SVG results', () => {
    const result = sanitizeOfflineDiagramSvg(
      svg(String.raw`<rect fill="u\72l(https://example.invalid/a)" style="fill:u\72l(https://example.invalid/b)"/>`)
    )
    expect(result).not.toContain('example.invalid')
    expect(() => sanitizeOfflineDiagramSvg('<html>not a diagram</html>')).toThrow('Invalid local diagram')
  })
})

describe('local renderer isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('accepts results only from its own frame and matching request, sanitizes output and removes the frame', async () => {
    const controller = new AbortController()
    const result = renderLocalPlantuml('@startuml\nAlice -> Bob: private\n@enduml', controller.signal)
    const frame = document.querySelector('iframe')!
    const child = frame.contentWindow!
    const post = vi.spyOn(child, 'postMessage').mockImplementation(() => {})
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.src).not.toContain('private')
    window.dispatchEvent(new MessageEvent('message', { source: child, data: { type: 'plantuml-ready' } }))
    const input = post.mock.calls[0][0] as { id: string; source: string }
    expect(input.source).toContain('Alice -> Bob: private')
    const message = {
      type: 'plantuml-result',
      id: input.id,
      svg: svg('<text>Trusted diagram</text><image href="https://example.invalid"/>')
    }
    window.dispatchEvent(new MessageEvent('message', { source: window, data: message }))
    window.dispatchEvent(new MessageEvent('message', { source: child, data: { ...message, id: 'another-render' } }))
    expect(frame.isConnected).toBe(true)
    window.dispatchEvent(new MessageEvent('message', { source: child, data: message }))
    await expect(result).resolves.toContain('Trusted diagram')
    expect(await result).not.toContain('example.invalid')
    expect(frame.isConnected).toBe(false)
  })

  it('removes an abandoned renderer and rejects overlarge source before starting one', async () => {
    const controller = new AbortController()
    const result = renderLocalPlantuml('pending', controller.signal)
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(document.querySelector('iframe')).toBeNull()
    await expect(renderLocalPlantuml('x'.repeat(100_001))).rejects.toThrow('too large')
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('releases a renderer that never replies instead of leaving a permanent loading state', async () => {
    vi.useFakeTimers()
    const result = renderLocalPlantuml('pending')
    const rejection = expect(result).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(20_000)
    await rejection
    expect(document.querySelector('iframe')).toBeNull()
  })
})
