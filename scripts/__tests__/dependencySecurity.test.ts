import { readdir, mkdirSync, mkdtempSync, rmdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import * as z from 'zod'

const requireFrom = (parent: string) => createRequire(import.meta.resolve(parent))

describe('backported dependency security fixes', () => {
  it('Zod rejects oversized bounded arrays before building per-element errors', () => {
    const result = z.array(z.string()).max(1).safeParse(Array(2000).fill(0))
    expect(result.success).toBe(false)
    if (result.success) throw new Error('Oversized array was accepted')
    expect(result.error.issues).toHaveLength(1)
    expect(result.error.issues[0].code).toBe('too_big')
  })

  it('HTML conversion dependency keeps copied prototype keys inert', () => {
    const merge = requireFrom('html-to-text')('deepmerge-ts').deepmerge as (
      target: Record<string, unknown>,
      source: Record<string, unknown>
    ) => Record<string, unknown>
    const malicious = JSON.parse('{"__proto__":{"polluted":true},"safe":{"value":1}}')

    for (const result of [merge(malicious, {}), merge(Object.create(null), malicious)]) {
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
      expect(result.polluted).toBeUndefined()
      expect(Object.hasOwn(result, '__proto__')).toBe(true)
      expect(result.safe).toEqual({ value: 1 })
    }
  })

  it('minimatch bounds generated patterns while preserving matches below the cap', () => {
    const utils = requireFrom('eslint-plugin-import-zod').resolve('@typescript-eslint/utils')
    const estree = createRequire(utils).resolve('@typescript-eslint/typescript-estree')
    const contexts = [requireFrom('@earendil-works/pi-coding-agent'), createRequire(estree)]
    for (const context of contexts) {
      const { Minimatch } = context('minimatch') as {
        Minimatch: new (
          pattern: string,
          options: { optimizationLevel: number; braceExpandMax: number }
        ) => { set: unknown[][]; match(path: string): boolean }
      }
      const options = { optimizationLevel: 2, braceExpandMax: 64 }
      const bounded = new Minimatch(Array(8).fill('**/../a/b').join('/'), options)
      expect(bounded.set.length).toBeLessThanOrEqual(64)
      const ordinary = new Minimatch('**/../a/b/**/../c/d', options)
      expect(ordinary.match('../a/b/../c/d')).toBe(true)
      expect(ordinary.match('x/a/b/y/c/d')).toBe(true)
    }
  })

  it('glob stops directory I/O after cancellation', async () => {
    const { glob } = requireFrom('i18next-cli')('glob') as {
      glob(pattern: string, options: Record<string, unknown>): Promise<string[]>
    }
    const root = mkdtempSync(join(tmpdir(), 'cherry-glob-abort-'))
    const directories: string[] = []
    const controller = new AbortController()
    let reads = 0
    try {
      for (let parent = 0; parent < 3; parent++) {
        const directory = join(root, String(parent))
        mkdirSync(directory)
        directories.push(directory)
        for (let child = 0; child < 3; child++) {
          const nested = join(directory, String(child))
          mkdirSync(nested)
          directories.push(nested)
        }
      }
      const io = {
        readdir(...args: unknown[]) {
          reads++
          const callback = args.pop() as (...values: unknown[]) => void
          return Reflect.apply(readdir, undefined, [
            ...args,
            (...values: unknown[]) => {
              if (!controller.signal.aborted) controller.abort(new Error('test cancellation'))
              callback(...values)
            }
          ])
        }
      }
      await expect(glob('**/*', { cwd: root, signal: controller.signal, fs: io })).rejects.toThrow('test cancellation')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(reads).toBe(1)
    } finally {
      for (const directory of directories.reverse()) rmdirSync(directory)
      rmdirSync(root)
    }
  })
})
