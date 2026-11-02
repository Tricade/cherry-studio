import { setupTestDatabase } from '@test-helpers/db'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('SQLite identifier escaping', () => {
  const database = setupTestDatabase()

  it('cannot turn an identifier into an attacker-selected subquery', () => {
    expect(database.db.get(sql`select ${sql.identifier('value')} from (select 123 as value)`)).toEqual({ value: 123 })

    let result: Record<string, unknown> | undefined
    try {
      result = database.db.get(sql`select ${sql.identifier('value" FROM (SELECT 456 AS value) --')}`)
    } catch {
      // SQLite builds may reject unknown quoted identifiers instead of treating them as strings.
    }
    expect(Object.values(result ?? {})).not.toContain(456)
  })
})
