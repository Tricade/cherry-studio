import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JsonStreamReader } from '../JsonStreamReader'

describe('JsonStreamReader', () => {
  let directory: string
  let file: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'cherry-json-reader-'))
    file = join(directory, 'records.json')
  })

  afterEach(() => {
    unlinkSync(file)
    rmdirSync(directory)
  })

  it('counts and samples a streamed array without changing nested values', async () => {
    const records = [{ text: '世界 🍒', nested: [true, null, 2] }, { text: 'second' }, { text: 'third' }]
    writeFileSync(file, JSON.stringify(records))
    const reader = new JsonStreamReader(file)

    expect(await reader.count()).toBe(3)
    expect(await reader.readSample(2)).toEqual(records.slice(0, 2))
  })

  it('waits for asynchronous batches and includes the final partial batch', async () => {
    writeFileSync(file, '[1,2,3,4,5]')
    const batches: { values: number[]; index: number }[] = []

    const count = await new JsonStreamReader(file).readInBatches<number>(2, async (values, index) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      batches.push({ values, index })
    })

    expect(count).toBe(5)
    expect(batches).toEqual([
      { values: [1, 2], index: 0 },
      { values: [3, 4], index: 1 },
      { values: [5], index: 2 }
    ])
  })

  it('keeps an attacker-controlled __proto__ field as data', async () => {
    writeFileSync(file, '[{"__proto__":{"polluted":true},"value":"safe"}]')
    const [record] = await new JsonStreamReader(file).readSample<Record<string, unknown>>(1)

    expect(Object.getPrototypeOf(record)).toBe(Object.prototype)
    expect(Object.hasOwn(record, '__proto__')).toBe(true)
    expect(record.polluted).toBeUndefined()
    expect(record.value).toBe('safe')
  })
})
