import { HTTPClient, Mistral } from '@mistralai/mistralai'
import { HTTPValidationError } from '@mistralai/mistralai/models/errors/httpvalidationerror.js'
import { ResponseValidationError } from '@mistralai/mistralai/models/errors/responsevalidationerror.js'
import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/v4'

const page = { index: 0, markdown: 'OCR text', images: [], dimensions: null }
const request = {
  model: 'mistral-ocr-latest',
  document: { type: 'image_url' as const, imageUrl: 'data:image/png;base64,AA==' }
}

function clientForResponse(body: unknown, status = 200) {
  return new Mistral({
    apiKey: 'synthetic-test-key',
    httpClient: new HTTPClient({
      fetcher: async () => Response.json(body, { status })
    })
  })
}

function clientFor(pages: unknown[]) {
  return clientForResponse({ pages, model: 'mistral-ocr-latest', usage_info: { pages_processed: pages.length } })
}

describe('Mistral OCR response validation budget', () => {
  it('preserves document upload, signed URL, deletion, endpoint and cancellation transport', async () => {
    const requests: Request[] = []
    const client = new Mistral({
      apiKey: 'synthetic-test-key',
      serverURL: 'https://synthetic.invalid',
      httpClient: new HTTPClient({
        fetcher: async (input, init) => {
          const received = new Request(input, init)
          requests.push(received)
          expect(new URL(received.url).origin).toBe('https://synthetic.invalid')
          expect(received.headers.get('authorization')).toBe('Bearer synthetic-test-key')
          const path = new URL(received.url).pathname
          if (received.method === 'POST' && path === '/v1/files') {
            const form = await received.formData()
            expect(form.get('purpose')).toBe('ocr')
            const file = form.get('file') as File
            expect(file.name).toBe('document.pdf')
            expect(await file.text()).toBe('synthetic PDF contents')
            return Response.json({
              id: 'file-test',
              object: 'file',
              bytes: 22,
              created_at: 1,
              filename: 'document.pdf',
              purpose: 'ocr',
              sample_type: 'instruct',
              source: 'upload'
            })
          }
          if (received.method === 'GET' && path === '/v1/files/file-test/url') {
            return Response.json({ url: 'https://synthetic.invalid/document.pdf' })
          }
          if (received.method === 'DELETE' && path === '/v1/files/file-test') {
            return Response.json({ id: 'file-test', object: 'file', deleted: true })
          }
          throw new Error(`Unexpected transport request: ${received.method} ${path}`)
        }
      })
    })
    const controller = new AbortController()
    const options = { signal: controller.signal }
    const uploaded = await client.files.upload(
      {
        file: { fileName: 'document.pdf', content: new TextEncoder().encode('synthetic PDF contents') },
        purpose: 'ocr'
      },
      options
    )
    expect(uploaded.id).toBe('file-test')
    expect(uploaded.sizeBytes).toBe(22)
    expect((await client.files.getSignedUrl({ fileId: uploaded.id }, options)).url).toBe(
      'https://synthetic.invalid/document.pdf'
    )
    expect((await client.files.delete({ fileId: uploaded.id }, options)).deleted).toBe(true)
    expect(requests).toHaveLength(3)
    controller.abort()
    expect(requests.every((received) => received.signal.aborted)).toBe(true)
  })

  it.each(['pages', 'nested images', 'HTTP 422'])('stops visiting invalid %s after the first failure', async (kind) => {
    let visits = 0
    const items = Array(2000).fill(null)
    for (let index = 0; index < items.length; index++) {
      Object.defineProperty(items, index, {
        get: () => {
          visits++
          return null
        }
      })
    }
    const status = kind === 'HTTP 422' ? 422 : 200
    const body =
      status === 422
        ? { detail: items }
        : {
            pages: kind === 'pages' ? items : [{ ...page, images: items }],
            model: 'mistral-ocr-latest',
            usage_info: { pages_processed: 1 }
          }
    const marker = '{"synthetic":"ocr-budget"}'
    const parse = JSON.parse
    const parser = vi
      .spyOn(JSON, 'parse')
      .mockImplementation((text, reviver) => (text === marker ? body : parse(text, reviver)))
    const client = new Mistral({
      apiKey: 'synthetic-test-key',
      httpClient: new HTTPClient({
        fetcher: async () => new Response(marker, { status, headers: { 'Content-Type': 'application/json' } })
      })
    })
    try {
      await expect(client.ocr.process(request)).rejects.toBeInstanceOf(ResponseValidationError)
      expect(visits).toBe(1)
    } finally {
      parser.mockRestore()
    }
  })

  it.each([
    { name: 'pages', pages: Array(2000).fill(null) },
    { name: 'nested images', pages: [{ ...page, images: Array(2000).fill(null) }] }
  ])('bounds error amplification from invalid $name', async ({ pages }) => {
    const failure: unknown = await clientFor(pages)
      .ocr.process(request)
      .then(
        () => undefined,
        (error: unknown) => error
      )
    expect(failure).toBeInstanceOf(ResponseValidationError)
    if (!(failure instanceof ResponseValidationError)) throw new Error('Expected an OCR validation failure')
    const cause = failure.cause as { issues: unknown[] }
    expect(cause.issues.length).toBeGreaterThan(0)
    expect(cause.issues.length).toBeLessThanOrEqual(100)
  })

  it('accepts more valid OCR pages than the diagnostic budget', async () => {
    const result = await clientFor(Array(256).fill(page)).ocr.process(request)
    expect(result.pages).toHaveLength(256)
    expect(result.pages[255].markdown).toBe('OCR text')
    expect(result.usageInfo.pagesProcessed).toBe(256)
  })

  it('also bounds diagnostics from a malformed HTTP 422 error body', async () => {
    const failure: unknown = await clientForResponse({ detail: Array(2000).fill(null) }, 422)
      .ocr.process(request)
      .then(
        () => undefined,
        (error: unknown) => error
      )
    expect(failure).toBeInstanceOf(ResponseValidationError)
    if (!(failure instanceof ResponseValidationError)) throw new Error('Expected an OCR validation failure')
    const cause = failure.cause as { issues: unknown[] }
    expect(cause.issues.length).toBeGreaterThan(0)
    expect(cause.issues.length).toBeLessThanOrEqual(100)
  })

  it('preserves the structured API error for a valid HTTP 422 response', async () => {
    const client = clientForResponse(
      { detail: [{ loc: ['body', 'document'], msg: 'invalid document', type: 'value_error' }] },
      422
    )
    const failure: unknown = await client.ocr.process(request).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(HTTPValidationError)
    if (!(failure instanceof HTTPValidationError)) throw new Error('Expected the structured API validation error')
    expect(failure.detail?.[0].msg).toBe('invalid document')
  })

  it('preserves valid union responses outside the OCR operation', async () => {
    const matchers = await import('@mistralai/mistralai/lib/matchers.js')
    const values = Array(256).fill(42)
    const schema = z.union([z.array(z.string()), z.array(z.number())])
    const [result] = await matchers.match(matchers.json(200, schema))(
      Response.json(values),
      new Request('https://synthetic.invalid')
    )
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(values)
  })
})
