import { describe, expect, it } from 'vitest'

import { createDependencySnapshot } from '../dependencyGraph.mjs'

const context = {
  sha: 'a'.repeat(40),
  ref: 'refs/heads/main',
  repository: 'Tricade/cherry-studio',
  runId: '123',
  runAttempt: '1',
  scanned: '2026-11-02T00:00:00.000Z'
}

function projectBom() {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.7',
    metadata: { component: { 'bom-ref': 'project', purl: 'pkg:npm/cherry-studio@2.1.10' } },
    components: [
      { 'bom-ref': 'sdk', purl: 'pkg:npm/%40mistralai/mistralai@1.11.0' },
      { 'bom-ref': 'validator', purl: 'pkg:npm/zod@3.25.76' },
      { 'bom-ref': 'windows', purl: 'pkg:npm/%40esbuild/win32-x64@0.25.0' },
      { 'bom-ref': 'linux', purl: 'pkg:npm/%40esbuild/linux-x64@0.25.0' }
    ],
    dependencies: [
      { ref: 'project', dependsOn: ['sdk'] },
      { ref: 'sdk', dependsOn: ['validator', 'windows', 'linux'] },
      { ref: 'validator', dependsOn: [] },
      { ref: 'windows', dependsOn: [] },
      { ref: 'linux', dependsOn: [] }
    ]
  }
}

describe('dependency graph submission', () => {
  it('retains workspace root edges regardless of document order and marks each importer dependency as direct', () => {
    const application = projectBom()
    application.dependencies[1].dependsOn = []
    const workspace = projectBom()
    workspace.metadata.component = { 'bom-ref': 'workspace', purl: 'pkg:npm/%40mistralai/mistralai@1.11.0' }
    workspace.components.shift()
    workspace.dependencies = [
      { ref: 'workspace', dependsOn: ['validator', 'windows', 'linux'] },
      ...workspace.dependencies.slice(2)
    ]

    const snapshot = createDependencySnapshot([workspace, application], context)
    expect(createDependencySnapshot([application, workspace], context)).toEqual(snapshot)
    const packages = snapshot.manifests['pnpm-lock.yaml'].resolved
    expect(Object.keys(packages)).toHaveLength(4)
    expect(packages['pkg:npm/%40mistralai/mistralai@1.11.0'].dependencies).toEqual([
      'pkg:npm/%40esbuild/linux-x64@0.25.0',
      'pkg:npm/%40esbuild/win32-x64@0.25.0',
      'pkg:npm/zod@3.25.76'
    ])
    expect(packages['pkg:npm/zod@3.25.76'].relationship).toBe('direct')
  })

  it('keeps transitive versions and every optional platform while excluding the application itself', () => {
    const snapshot = createDependencySnapshot([projectBom()], context)
    const packages = snapshot.manifests['pnpm-lock.yaml'].resolved
    expect(Object.keys(packages)).toHaveLength(4)
    expect(packages['pkg:npm/cherry-studio@2.1.10']).toBeUndefined()
    expect(packages['pkg:npm/%40mistralai/mistralai@1.11.0']).toEqual({
      package_url: 'pkg:npm/%40mistralai/mistralai@1.11.0',
      relationship: 'direct',
      dependencies: [
        'pkg:npm/%40esbuild/linux-x64@0.25.0',
        'pkg:npm/%40esbuild/win32-x64@0.25.0',
        'pkg:npm/zod@3.25.76'
      ]
    })
    expect(packages['pkg:npm/zod@3.25.76']).toEqual({
      package_url: 'pkg:npm/zod@3.25.76',
      relationship: 'indirect',
      dependencies: []
    })
    expect(snapshot).toMatchObject({ sha: context.sha, ref: context.ref, job: { correlator: 'pnpm-project-lockfile' } })
  })

  it('unions peer-context edges for one package without erasing its direct relationship or making a self-edge', () => {
    const bom = projectBom()
    bom.components.push({ 'bom-ref': 'sdk-peer', purl: 'pkg:npm/%40mistralai/mistralai@1.11.0' })
    bom.dependencies[1].dependsOn = ['validator', 'sdk-peer']
    bom.dependencies.push({ ref: 'sdk-peer', dependsOn: ['windows', 'linux'] })
    const packages = createDependencySnapshot([bom], context).manifests['pnpm-lock.yaml'].resolved
    expect(Object.keys(packages)).toHaveLength(4)
    expect(packages['pkg:npm/%40mistralai/mistralai@1.11.0'].relationship).toBe('direct')
    expect(packages['pkg:npm/%40mistralai/mistralai@1.11.0'].dependencies).toEqual([
      'pkg:npm/%40esbuild/linux-x64@0.25.0',
      'pkg:npm/%40esbuild/win32-x64@0.25.0',
      'pkg:npm/zod@3.25.76'
    ])
  })

  it.each(['child', 'parent', 'missing-record', 'missing-purl', 'duplicate-component', 'duplicate-record', 'empty'])(
    'rejects a %s inventory error instead of submitting a misleading partial graph',
    (failure) => {
      const bom = projectBom()
      if (failure === 'child') bom.dependencies[1].dependsOn.push('unknown')
      if (failure === 'parent') bom.dependencies.push({ ref: 'unknown', dependsOn: [] })
      if (failure === 'missing-record') bom.dependencies.pop()
      if (failure === 'missing-purl') bom.components[1].purl = ''
      if (failure === 'duplicate-component') bom.components.push(bom.components[1])
      if (failure === 'duplicate-record') bom.dependencies.push(bom.dependencies[1])
      if (failure === 'empty') bom.components = []
      expect(() => createDependencySnapshot([bom], context)).toThrow()
    }
  )

  it('rejects an unsupported exporter schema and missing commit identity', () => {
    expect(() => createDependencySnapshot([{ ...projectBom(), specVersion: '2.0' }], context)).toThrow()
    expect(() => createDependencySnapshot([projectBom()], { ...context, sha: '' })).toThrow()
  })

  it('rejects duplicate workspaces and references missing from their own document', () => {
    expect(() => createDependencySnapshot([projectBom(), projectBom()], context)).toThrow('Duplicate workspace')
    const workspace = projectBom()
    workspace.metadata.component = { 'bom-ref': 'workspace', purl: 'pkg:npm/workspace@1.0.0' }
    workspace.dependencies[0].ref = 'workspace'
    workspace.components.pop()
    workspace.dependencies.pop()
    expect(() => createDependencySnapshot([projectBom(), workspace], context)).toThrow('Unknown child: linux')
  })

  it('permits a workspace without dependencies but rejects an entirely empty inventory', () => {
    const empty = projectBom()
    empty.components = []
    empty.dependencies = [{ ref: 'project', dependsOn: [] }]
    empty.metadata.component.purl = 'pkg:npm/empty@1.0.0'
    expect(createDependencySnapshot([empty, projectBom()], context)).toEqual(
      createDependencySnapshot([projectBom()], context)
    )
    expect(() => createDependencySnapshot([empty], context)).toThrow('empty dependency inventory')
    expect(() => createDependencySnapshot([], context)).toThrow('empty workspace inventory')
  })
})
