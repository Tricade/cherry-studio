import { mergeAttributes } from '@tiptap/core'
import katex from 'katex'
import { describe, expect, it } from 'vitest'

describe('editor dependency security', () => {
  it('does not inherit executable DOM attributes from a supplied __proto__ key', () => {
    const attributes = mergeAttributes({ class: 'note' }, JSON.parse('{"__proto__":{"onclick":"alert(1)"}}'))

    expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype)
    expect(attributes.onclick).toBeUndefined()
    expect(attributes.class).toBe('note')
  })

  it('keeps KaTeX trust disabled when Object.prototype has been polluted', () => {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'trust')
    Object.defineProperty(Object.prototype, 'trust', { value: true, configurable: true, writable: true })
    try {
      const html = katex.renderToString('\\href{javascript:alert(1)}{click}', { throwOnError: false })
      expect(html).not.toContain('href="javascript:')
    } finally {
      if (previous) Object.defineProperty(Object.prototype, 'trust', previous)
      else Reflect.deleteProperty(Object.prototype, 'trust')
    }
  })
})
