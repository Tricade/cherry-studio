import assert from 'node:assert/strict'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Combine pnpm's per-workspace SBOMs without changing versions or guessing dependency scopes. */
export function createDependencySnapshot(boms, context) {
  assert(Array.isArray(boms) && boms.length > 0, 'Refusing an empty workspace inventory')
  assert(/^[a-f0-9]{40,64}$/.test(context.sha), 'Missing or invalid commit SHA')
  assert(context.ref?.startsWith('refs/'), 'Missing Git ref')
  assert(/^[\w.-]+\/[\w.-]+$/.test(context.repository), 'Missing GitHub repository')
  assert(context.runId && context.runAttempt, 'Missing workflow run identity')
  assert(Number.isFinite(Date.parse(context.scanned)), 'Missing scan timestamp')

  const resolved = new Map()
  const roots = new Set()
  const graphs = boms.map((bom) => {
    assert.equal(bom.bomFormat, 'CycloneDX', 'Expected a CycloneDX SBOM')
    assert.equal(bom.specVersion, '1.7', 'Review the adapter when pnpm changes its SBOM schema')
    assert(Array.isArray(bom.components), 'Missing dependency inventory')
    assert(Array.isArray(bom.dependencies), 'Missing dependency relationships')
    const root = bom.metadata?.component?.['bom-ref']
    const rootPurl = bom.metadata?.component?.purl
    assert(typeof root === 'string' && root.length > 0, 'Missing project root')
    assert(typeof rootPurl === 'string' && rootPurl.startsWith('pkg:npm/'), 'Missing workspace PURL')
    assert(!roots.has(rootPurl), `Duplicate workspace: ${rootPurl}`)
    roots.add(rootPurl)
    const packages = new Map()
    for (const component of bom.components) {
      const ref = component['bom-ref']
      assert(typeof ref === 'string' && ref.length > 0 && ref !== root, 'Invalid dependency reference')
      assert(!packages.has(ref), `Duplicate component reference: ${ref}`)
      assert(typeof component.purl === 'string' && component.purl.startsWith('pkg:npm/'), `Missing npm PURL: ${ref}`)
      packages.set(ref, component.purl)
      if (!resolved.has(component.purl)) {
        resolved.set(component.purl, { package_url: component.purl, relationship: 'indirect', dependencies: new Set() })
      }
    }
    return { root, rootPurl, packages, dependencies: bom.dependencies }
  })
  assert(resolved.size > 0, 'Refusing an empty dependency inventory')

  for (const { root, rootPurl, packages, dependencies } of graphs) {
    const seen = new Set()
    for (const dependency of dependencies) {
      assert(dependency.ref === root || packages.has(dependency.ref), `Unknown parent: ${dependency.ref}`)
      assert(!seen.has(dependency.ref), `Duplicate dependency record: ${dependency.ref}`)
      assert(Array.isArray(dependency.dependsOn), `Missing child list: ${dependency.ref}`)
      seen.add(dependency.ref)
      const parentPurl = dependency.ref === root ? rootPurl : packages.get(dependency.ref)
      for (const child of dependency.dependsOn) {
        assert(packages.has(child), `Unknown child: ${child}`)
        const childPurl = packages.get(child)
        if (dependency.ref === root) resolved.get(childPurl).relationship = 'direct'
        // A workspace root can also be another importer's dependency; preserve its outgoing edges.
        if (parentPurl !== childPurl) resolved.get(parentPurl)?.dependencies.add(childPurl)
      }
    }
    assert(seen.has(root), 'Missing root relationships')
    for (const ref of packages.keys()) assert(seen.has(ref), `Missing dependency record: ${ref}`)
  }
  assert(
    [...resolved.values()].some((entry) => entry.relationship === 'direct'),
    'Missing direct dependencies'
  )

  return {
    version: 0,
    sha: context.sha,
    ref: context.ref,
    job: {
      id: `${context.runId}:${context.runAttempt}`,
      correlator: 'pnpm-project-lockfile',
      html_url: `https://github.com/${context.repository}/actions/runs/${context.runId}`
    },
    detector: {
      name: 'cherry-pnpm-sbom',
      version: '1.0.0',
      url: `https://github.com/${context.repository}/blob/${context.sha}/scripts/dependencyGraph.mjs`
    },
    scanned: context.scanned,
    manifests: {
      'pnpm-lock.yaml': {
        name: 'pnpm-lock.yaml',
        file: { source_location: 'pnpm-lock.yaml' },
        resolved: Object.fromEntries(
          [...resolved.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([purl, entry]) => [purl, { ...entry, dependencies: [...entry.dependencies].sort() }])
        )
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2)
  assert(input && output && process.argv.length === 4, 'Usage: dependencyGraph.mjs <sbom-directory> <snapshot.json>')
  const boms = readdirSync(input)
    .filter((name) => name.endsWith('.cdx.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(resolve(input, name), 'utf8')))
  const snapshot = createDependencySnapshot(boms, {
    sha: process.env.GITHUB_SHA,
    ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    scanned: new Date().toISOString()
  })
  writeFileSync(output, `${JSON.stringify(snapshot)}\n`)
  const entries = Object.values(snapshot.manifests['pnpm-lock.yaml'].resolved)
  process.stdout.write(
    `Dependency snapshot: ${entries.length} packages, ${entries.reduce((sum, entry) => sum + entry.dependencies.length, 0)} edges\n`
  )
}
