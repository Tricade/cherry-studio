import { createRequire } from 'node:module'

import { Mistral } from '@mistralai/mistralai'
import { HTTPClient } from '@mistralai/mistralai/lib/http.js'
import { ResponseValidationError } from '@mistralai/mistralai/models/errors/responsevalidationerror.js'
import { describe, expect, it } from 'vitest'
import * as legacyZod from 'zod/v3'

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

  it('preserves valid union responses outside the OCR operation', async () => {
    const sdkRequire = createRequire(import.meta.resolve('@mistralai/mistralai'))
    const matchers = sdkRequire('./lib/matchers.js') as {
      json(code: number, schema: unknown): unknown
      match(
        matcher: unknown
      ): (response: Response, request: Request) => Promise<[{ ok: boolean; value?: unknown }, unknown]>
    }
    const values = Array(256).fill(42)
    const schema = legacyZod.union([legacyZod.array(legacyZod.string()), legacyZod.array(legacyZod.number())])
    const [result] = await matchers.match(matchers.json(200, schema))(
      Response.json(values),
      new Request('https://synthetic.invalid')
    )
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(values)
  })
})
