import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createElement, Fragment, type ComponentType, type SVGProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { resolveActiveLogoDirs, resolveIconTypes, svgrTransform } from '../icons-generate'
import { resolveIconComponentModule } from '../icons-generate-avatars'

async function generateIcon(svg: string) {
  const source = await svgrTransform(svg, 'FixtureIcon')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const generated = { exports: {} as { FixtureIcon: ComponentType<SVGProps<SVGSVGElement>> } }
  new Function('module', 'exports', 'require', outputText)(generated, generated.exports, createRequire(import.meta.url))
  return generated.exports.FixtureIcon
}

describe('SVG component generation', () => {
  it('preserves artwork and scopes references per instance while stripping embedded HTML', async () => {
    const Icon = await generateIcon(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 24">
      <defs>
        <linearGradient id="paint"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient>
        <clipPath id="clip"><path d="M 0 0 L 20 0 L 20 20 Z"/></clipPath>
      </defs>
      <path id="shape" d="M 1 2 L 20 2 L 20 18 Z" fill="url(#paint)" clip-path="url(#clip)"/>
      <use href="#shape"/>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">untrusted HTML</div></foreignObject>
    </svg>`)
    const markup = renderToStaticMarkup(
      createElement(Fragment, null, createElement(Icon, { width: 48 }), createElement(Icon, { width: 64 }))
    )
    const icons = [...markup.matchAll(/<svg\b[^>]*>.*?<\/svg>/gs)].map(([svg]) => svg)
    expect(icons).toHaveLength(2)
    const allIds = new Set<string>()
    for (const svg of icons) {
      expect(svg).toContain('viewBox="0 0 32 24"')
      expect(svg).toContain('d="M 1 2 L 20 2 L 20 18 Z"')
      expect(svg).not.toContain('foreignObject')
      expect(svg).not.toContain('untrusted HTML')
      const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id))
      const references = [...svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map(
        ([, urlId, hrefId]) => urlId ?? hrefId
      )
      expect(ids.size).toBeGreaterThan(0)
      expect(references).toHaveLength(3)
      for (const id of references) expect(ids.has(id)).toBe(true)
      for (const id of ids) {
        expect(allIds.has(id)).toBe(false)
        allIds.add(id)
      }
    }
    expect(icons[0]).toContain('width="48"')
    expect(icons[1]).toContain('width="64"')
  })

  it('derives a missing viewBox from source dimensions and keeps scalable icon dimensions', async () => {
    const Icon = await generateIcon('<svg width="32" height="24"><path d="M 1 2 L 20 2 L 20 18 Z"/></svg>')
    const markup = renderToStaticMarkup(createElement(Icon))
    expect(markup).toContain('viewBox="0 0 32 24"')
    expect(markup).toContain('width="1em"')
    expect(markup).toContain('height="1em"')
  })
})

describe('resolveIconTypes', () => {
  it('generates every icon group when no type is requested', () => {
    expect(resolveIconTypes(null)).toEqual(['icons', 'providers', 'models'])
  })

  it('generates only the requested icon group', () => {
    expect(resolveIconTypes('providers')).toEqual(['providers'])
  })
})

describe('resolveActiveLogoDirs', () => {
  it('preserves the hand-written OpenCode provider alongside generated providers', () => {
    expect(resolveActiveLogoDirs('providers', ['openai'])).toEqual(new Set(['openai', 'opencode']))
  })
})

describe('resolveIconComponentModule', () => {
  it('uses named modules for new icons while preserving legacy index.tsx modules', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cherry-ui-icons-'))
    const newIconDir = join(baseDir, 'new-icon')
    const legacyIconDir = join(baseDir, 'legacy-icon')
    mkdirSync(newIconDir)
    mkdirSync(legacyIconDir)
    writeFileSync(join(legacyIconDir, 'index.tsx'), '')

    try {
      expect(resolveIconComponentModule(baseDir, 'new-icon')).toEqual({
        outPath: join(newIconDir, 'new-icon.tsx'),
        modulePath: './new-icon/new-icon'
      })
      expect(resolveIconComponentModule(baseDir, 'legacy-icon')).toEqual({
        outPath: join(legacyIconDir, 'index.tsx'),
        modulePath: undefined
      })
    } finally {
      rmSync(baseDir, { recursive: true, force: true })
    }
  })
})
