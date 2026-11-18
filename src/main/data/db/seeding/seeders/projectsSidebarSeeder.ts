import { and, eq } from 'drizzle-orm'

import { preferenceTable } from '@data/db/schemas/preference'
import {
  createSidebarShortcutId,
  type SidebarShortcutItem,
  type SidebarShortcutTarget
} from '@shared/data/preference/preferenceTypes'

import type { DbType, ISeeder } from '../../types'

const target = { kind: 'resource', locator: { providerId: 'core.app', resourceId: 'projects' } } as const
const projectsShortcut: SidebarShortcutItem = { type: 'shortcut', id: createSidebarShortcutId(target), target }

function isAppShortcut(item: unknown, appId: string): boolean {
  if (!item || typeof item !== 'object' || !('target' in item)) return false
  const locator = (item.target as Partial<SidebarShortcutTarget> | null)?.locator
  return locator?.providerId === 'core.app' && locator.resourceId === appId
}

export class ProjectsSidebarSeeder implements ISeeder {
  readonly name = 'projects-sidebar'
  readonly version = '1'
  readonly description = 'Add Projects to existing sidebar shortcuts once'

  run(db: DbType): void {
    const preference = and(eq(preferenceTable.scope, 'default'), eq(preferenceTable.key, 'ui.sidebar_shortcut'))
    const row = db.select({ value: preferenceTable.value }).from(preferenceTable).where(preference).get()
    const shortcuts = row?.value
    if (!Array.isArray(shortcuts) || !shortcuts.length || shortcuts.some((item) => isAppShortcut(item, 'projects')))
      return

    const agentsIndex = shortcuts.findIndex((item) => isAppShortcut(item, 'agents'))
    const index = agentsIndex < 0 ? shortcuts.length : agentsIndex + 1
    db.update(preferenceTable)
      .set({ value: [...shortcuts.slice(0, index), projectsShortcut, ...shortcuts.slice(index)] })
      .where(preference)
      .run()
  }
}
