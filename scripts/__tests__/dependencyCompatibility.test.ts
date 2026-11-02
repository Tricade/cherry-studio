import { createReadStream, mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

import Ansi from 'ansi-to-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

const requireFrom = (parent: string) => createRequire(import.meta.resolve(parent))

describe('security update consumer compatibility', () => {
  it('the CSV reader retains quoted fields and Unicode with its new parser', async () => {
    const { CSVReader } = await import('@vectorstores/readers/csv')
    const documents = await new CSVReader().loadDataAsContent(
      new TextEncoder().encode('name,value\n"hello, world",世界\n')
    )
    expect(documents.map((document) => document.text)).toEqual(['name, value\nhello, world, 世界'])
  })

  it('ANSI fuzzy links retain their label and target with the updated linkifier', () => {
    const html = renderToStaticMarkup(createElement(Ansi, { linkify: 'fuzzy' }, 'visit https://example.com/cherry'))
    expect(html).toContain('href="https://example.com/cherry"')
    expect(html).toContain('>https://example.com/cherry</a>')
  })

  it('the native installer tar API preserves bytes and strips the archive root', async () => {
    const unpdf = createRequire(requireFrom('@vectorstores/readers/pdf').resolve('unpdf'))
    const canvas = createRequire(unpdf.resolve('canvas'))
    const installer = createRequire(canvas.resolve('@mapbox/node-pre-gyp'))
    const tar = installer('tar') as {
      create(options: Record<string, unknown>, paths: string[]): Promise<void>
      extract(options: Record<string, unknown>): NodeJS.ReadWriteStream
    }
    const root = mkdtempSync(join(tmpdir(), 'cherry-installer-tar-'))
    const source = join(root, 'package')
    const destination = join(root, 'out')
    const archive = join(root, 'native.tar.gz')
    const payload = Buffer.from([0, 255, 10, 13, 42])
    mkdirSync(source)
    mkdirSync(destination)
    writeFileSync(join(source, 'native.node'), payload)
    try {
      await tar.create({ cwd: root, file: archive, gzip: true }, ['package'])
      await pipeline(createReadStream(archive), tar.extract({ cwd: destination, strip: 1 }))
      expect(readFileSync(join(destination, 'native.node'))).toEqual(payload)
    } finally {
      unlinkSync(join(source, 'native.node'))
      unlinkSync(join(destination, 'native.node'))
      unlinkSync(archive)
      rmdirSync(source)
      rmdirSync(destination)
      rmdirSync(root)
    }
  })

  it('the devtools Node adapter handles a real loopback HTTP request', async () => {
    const { getRequestListener } = requireFrom('@ai-sdk/devtools')('@hono/node-server') as {
      getRequestListener(handler: (request: Request) => Promise<Response>): Parameters<typeof createServer>[1]
    }
    const listener = getRequestListener(async (request) => Response.json({ body: await request.text() }))
    const server = createServer(listener)
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No loopback port')
      const response = await fetch(`http://127.0.0.1:${address.port}/probe`, { method: 'POST', body: '世界' })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ body: '世界' })
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })
})
