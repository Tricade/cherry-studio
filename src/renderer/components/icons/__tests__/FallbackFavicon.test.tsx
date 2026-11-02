import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import FallbackFavicon from '../FallbackFavicon'

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('local link icons', () => {
  it('never requests a linked domain or a remote icon, even with a previously cached remote source', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    localStorage.setItem(
      'favicon_src_private.example',
      JSON.stringify({ src: 'https://icon.horse/icon/private.example', at: Date.now() })
    )

    const { container, rerender } = render(<FallbackFavicon hostname="private.example" alt="Private site" />)
    expect(screen.getByRole('img', { name: 'Private site' })).toHaveTextContent('P')
    rerender(<FallbackFavicon hostname="second.example" alt="Second site" />)
    expect(screen.getByRole('img', { name: 'Second site' })).toHaveTextContent('S')
    // Decorative images have no img role; check resource-bearing elements as well as fetch.
    expect(container.querySelector('img')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the supplied local fallback without loading an image', () => {
    render(<FallbackFavicon hostname="example.com" alt="" fallback={<span>Local fallback</span>} />)
    expect(screen.getByText('Local fallback')).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
  })
})
