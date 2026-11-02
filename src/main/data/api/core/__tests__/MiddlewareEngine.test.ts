import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataRequest, DataResponse } from '@shared/data/api/types'

import { MiddlewareEngine } from '../MiddlewareEngine'

describe('DataApi request logging privacy', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each([
    { apiKey: 'private-provider-key', messages: [{ content: 'private-chat-content' }] },
    'private-chat-content'
  ])('keeps request contents out of logs without changing downstream input: %j', async (body) => {
    const request: DataRequest = {
      id: 'privacy-request',
      method: 'POST',
      path: '/providers',
      params: { search: 'private-query-content', nested: { value: 'private-opaque-value' } },
      body
    }
    const expectedInput = structuredClone({ params: request.params, body: request.body })
    const response: DataResponse = { id: request.id, status: 200 }
    const engine = new MiddlewareEngine()
    engine.use({
      name: 'consume-request',
      priority: 20,
      execute: async (req, res, next) => {
        res.data = { params: req.params, body: req.body }
        await next()
      }
    })

    await engine.executeMiddlewares({ request, response, data: new Map() })

    expect(response.data).toEqual(expectedInput)
    expect(response.error).toBeUndefined()
    const logged = JSON.stringify(
      (['debug', 'verbose', 'silly', 'info', 'warn', 'error'] as const).flatMap(
        (level) => mockMainLoggerService[level].mock.calls
      )
    )
    for (const secret of [
      'private-provider-key',
      'private-chat-content',
      'private-query-content',
      'private-opaque-value'
    ]) {
      expect(logged).not.toContain(secret)
    }
    expect(mockMainLoggerService.debug.mock.calls).toContainEqual([
      expect.stringContaining('Incoming request:'),
      { id: request.id }
    ])
    expect(mockMainLoggerService.debug.mock.calls).toContainEqual([
      expect.stringContaining('Request completed:'),
      { id: request.id, status: 200 }
    ])
  })
})
