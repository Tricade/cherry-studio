import { createRequire } from 'node:module'

import { beforeAll, describe, expect, it } from 'vitest'
import type * as LegacyZodModule from 'zod/v3'

type LegacyZod = typeof LegacyZodModule
type Schema = LegacyZodModule.ZodTypeAny

const rootRequire = createRequire(import.meta.url)
const distributions = [
  { name: 'Zod 4 bundled v3 CJS', load: async () => rootRequire('zod/v3') as LegacyZod },
  { name: 'Zod 4 bundled v3 ESM', load: () => import('zod/v3') }
]
const collections: { name: string; schema: (z: LegacyZod, item: Schema) => Schema; input: () => unknown }[] = [
  { name: 'array max', schema: (z, item) => z.array(item).max(2, 'collection cap'), input: () => Array(2000).fill(0) },
  {
    name: 'array length',
    schema: (z, item) => z.array(item).length(2, 'collection cap'),
    input: () => Array(2000).fill(0)
  },
  {
    name: 'set max',
    schema: (z, item) => z.set(item).max(2, 'collection cap'),
    input: () => new Set(Array.from({ length: 2000 }, (_, index) => index))
  },
  {
    name: 'set size',
    schema: (z, item) => z.set(item).size(2, 'collection cap'),
    input: () => new Set(Array.from({ length: 2000 }, (_, index) => index))
  }
]

describe.each(distributions)('$name collection bounds', ({ load }) => {
  let z: LegacyZod
  beforeAll(async () => {
    z = await load()
  })

  describe.each(['sync', 'async'] as const)('%s validation', (mode) => {
    it.each(collections)('rejects oversized $name before any element work', async ({ schema, input }) => {
      let visits = 0
      let refinements = 0
      const item = z.preprocess((value) => {
        visits++
        return mode === 'async' ? Promise.resolve(value) : value
      }, z.string())
      const bounded = schema(z, item).refine(() => {
        refinements++
        return true
      })
      const result = mode === 'async' ? await bounded.safeParseAsync(input()) : bounded.safeParse(input())

      expect(visits).toBe(0)
      expect(refinements).toBe(0)
      expect(result.success).toBe(false)
      if (result.success) throw new Error('Oversized collection was accepted')
      expect(result.error.issues).toHaveLength(1)
      expect(result.error.issues[0]).toMatchObject({ code: 'too_big', message: 'collection cap', path: [] })
    })
  })

  it('preserves transforms at the size boundary', async () => {
    const item = z.string().transform((value) => value.toUpperCase())
    expect(z.array(item).length(2).parse(['a', 'b'])).toEqual(['A', 'B'])
    expect(
      z
        .set(item)
        .max(2)
        .parse(new Set(['a', 'b']))
    ).toEqual(new Set(['A', 'B']))
    const asyncItem = z.string().transform(async (value) => value.toUpperCase())
    await expect(z.array(asyncItem).max(2).parseAsync(['a', 'b'])).resolves.toEqual(['A', 'B'])
    await expect(
      z
        .set(asyncItem)
        .size(2)
        .parseAsync(new Set(['a', 'b']))
    ).resolves.toEqual(new Set(['A', 'B']))
  })

  it('keeps unbounded and lower-bound-only collections unchanged', () => {
    const values = Array.from({ length: 256 }, (_, index) => String(index))
    const item = z.string().transform((value) => Number(value))
    expect(z.array(item).parse(values)).toEqual(values.map(Number))
    expect(z.set(item).min(1).parse(new Set(values))).toEqual(new Set(values.map(Number)))
    const shortArray = z.array(z.string()).length(2).safeParse([0])
    const shortSet = z
      .set(z.string())
      .min(2)
      .safeParse(new Set([0]))
    for (const result of [shortArray, shortSet]) {
      expect(result.success).toBe(false)
      if (result.success) throw new Error('Undersized invalid collection was accepted')
      expect(result.error.issues.map((issue) => issue.code)).toEqual(['too_small', 'invalid_type'])
    }
  })

  it('accepts a valid union alternative after an oversized branch fails', async () => {
    const values = Array(256).fill('valid')
    const array = z.union([z.array(z.string()).max(1), z.array(z.string())])
    const set = z.union([z.set(z.number()).max(1), z.set(z.number()).max(3)])
    expect(array.parse(values)).toEqual(values)
    await expect(array.parseAsync(values)).resolves.toEqual(values)
    expect(set.parse(new Set([1, 2]))).toEqual(new Set([1, 2]))
  })

  it('retains size diagnostics and nested paths when upper bounds overlap', () => {
    const schema = z.object({ items: z.array(z.string()).length(2, 'exact limit').max(1, 'max limit') })
    const result = schema.safeParse({ items: Array(2000).fill(0) })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('Oversized nested array was accepted')
    expect(result.error.issues).toHaveLength(2)
    expect(result.error.issues).toMatchObject([
      { code: 'too_big', message: 'exact limit', path: ['items'], exact: true },
      { code: 'too_big', message: 'max limit', path: ['items'], exact: false }
    ])
  })
})
