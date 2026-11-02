import { act, cleanup, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderLocalPlantuml } from '../localPlantuml'
import PlantUmlPreview from '../PlantUmlPreview'

vi.mock('../localPlantuml', () => ({ renderLocalPlantuml: vi.fn() }))
vi.mock('@renderer/components/ActionTools', () => ({
  useImageTools: () => ({ pan: vi.fn(), zoom: vi.fn(), copy: vi.fn(), download: vi.fn(), dialog: vi.fn() })
}))

const svg = (text: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><text>${text}</text></svg>`
const finishDebounce = () => act(() => vi.advanceTimersByTimeAsync(350))

describe('PlantUmlPreview', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-us')
    vi.useFakeTimers()
    vi.mocked(renderLocalPlantuml).mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('displays the locally rendered diagram and keeps it visible when the next source fails', async () => {
    vi.mocked(renderLocalPlantuml)
      .mockResolvedValueOnce(svg('Local diagram'))
      .mockRejectedValueOnce(new Error('Syntax error'))
    const view = render(<PlantUmlPreview>{'@startuml\nAlice -> Bob\n@enduml'}</PlantUmlPreview>)
    await finishDebounce()

    const diagram = () => view.container.querySelector('.plantuml-preview')?.shadowRoot?.querySelector('svg')
    expect(diagram()).toHaveTextContent('Local diagram')

    view.rerender(<PlantUmlPreview>{'@startuml\ninvalid\n@enduml'}</PlantUmlPreview>)
    await finishDebounce()
    expect(screen.getByText(/Local diagram rendering failed/)).toHaveTextContent('Syntax error')
    expect(diagram()).toHaveTextContent('Local diagram')
  })

  it('does not replace a newer diagram with a stale result and cancels rendering on unmount', async () => {
    let resolveOld!: (value: string) => void
    let oldSignal: AbortSignal | undefined
    vi.mocked(renderLocalPlantuml)
      .mockImplementationOnce((_source, signal) => {
        oldSignal = signal
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      })
      .mockResolvedValueOnce(svg('New diagram'))
    const view = render(<PlantUmlPreview>{'old'}</PlantUmlPreview>)
    await finishDebounce()
    view.rerender(<PlantUmlPreview>{'new'}</PlantUmlPreview>)
    await finishDebounce()
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => resolveOld(svg('Old diagram')))
    expect(view.container.querySelector('.plantuml-preview')?.shadowRoot?.querySelector('svg')).toHaveTextContent(
      'New diagram'
    )

    let pendingSignal: AbortSignal | undefined
    vi.mocked(renderLocalPlantuml).mockImplementationOnce((_source, signal) => {
      pendingSignal = signal
      return new Promise(() => {})
    })
    view.rerender(<PlantUmlPreview>{'pending'}</PlantUmlPreview>)
    await finishDebounce()
    view.unmount()
    expect(pendingSignal?.aborted).toBe(true)
  })
})
