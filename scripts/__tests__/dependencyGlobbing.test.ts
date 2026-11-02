import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Linter } from 'eslint'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const from = (parent: NodeJS.Require, name: string) => createRequire(parent.resolve(name))
const builder = from(from(require, 'electron-builder'), 'app-builder-lib')
const preview = createRequire(resolve('packages/file-preview/package.json'))
const archiver = from(from(preview, 'exceljs'), 'archiver')
const eslint = from(require, 'eslint')
const fixtures: string[] = []
const posix = (path: string) => path.replaceAll('\\', '/')

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'cherry-globbing-'))
  fixtures.push(root)
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  return root
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('cherry-globbing-')) {
      throw new Error('Fixture cleanup escaped the temporary directory')
    }
    rmSync(root, { recursive: true, force: true })
  }
})

describe('packaging and cleanup glob consumers', () => {
  it('ASAR preserves file bytes, dotfiles, ignored files and unpacked native paths', async () => {
    const asar = require('@electron/asar')
    const root = fixture({
      'source/a.txt': 'first',
      'source/z.txt': 'last',
      'source/.hidden': 'dot',
      'source/skip.log': 'ignored',
      'source/native/addon.node': 'native bytes',
      'source/assets/nested/data.json': '{"value":1}'
    })
    const destination = join(root, 'fixture.asar')
    await asar.createPackageWithOptions(join(root, 'source'), destination, {
      unpack: '*.node',
      unpackDir: join('assets', 'nested'),
      globOptions: { ignore: '**/*.log' }
    })
    const files = asar.listPackage(destination).map(posix)
    expect(files).toEqual([
      '/.hidden',
      '/a.txt',
      '/assets',
      '/assets/nested',
      '/assets/nested/data.json',
      '/native',
      '/native/addon.node',
      '/z.txt'
    ])
    expect(asar.extractFile(destination, 'a.txt').toString()).toBe('first')
    expect(asar.extractFile(destination, '.hidden').toString()).toBe('dot')
    expect(readFileSync(join(destination + '.unpacked', 'native/addon.node'), 'utf8')).toBe('native bytes')
    expect(readFileSync(join(destination + '.unpacked', 'assets/nested/data.json'), 'utf8')).toBe('{"value":1}')
    expect(asar.statFile(destination, join('assets', 'nested', 'data.json')).unpacked).toBe(true)
  })

  it('ASAR retains directory links without archiving duplicate descendants or dropping prefix siblings', async () => {
    const asar = require('@electron/asar')
    const root = fixture({ 'source/target/data.txt': 'target', 'source/link-sibling/keep.txt': 'sibling' })
    symlinkSync(
      process.platform === 'win32' ? join(root, 'source/target') : 'target',
      join(root, 'source/link'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    const destination = join(root, 'links.asar')
    await asar.createPackageWithOptions(join(root, 'source'), destination, { globOptions: { follow: true } })
    const files = asar.listPackage(destination).map(posix)
    expect(files).toContain('/link')
    expect(files).not.toContain('/link/data.txt')
    expect(files).toContain('/link-sibling/keep.txt')
    expect(resolve(root, 'source', asar.statFile(destination, 'link', false).link)).toBe(join(root, 'source/target'))
    expect(asar.extractFile(destination, join('target', 'data.txt')).toString()).toBe('target')
  })

  it('ASAR keeps case-sensitive glob defaults and supports explicit case-insensitive matching', async () => {
    const asar = require('@electron/asar')
    const root = fixture({ 'source/a.tmp': 'a', 'source/keep.TMP': 'uppercase', 'source/keep.txt': 'keep' })
    const destination = join(root, 'case-sensitive.asar')
    await asar.createPackageWithOptions(join(root, 'source'), destination, { pattern: '/*.tmp' })
    expect(asar.listPackage(destination).map(posix)).toEqual(['/a.tmp'])

    const insensitiveDestination = join(root, 'case-insensitive.asar')
    await asar.createPackageWithOptions(join(root, 'source'), insensitiveDestination, {
      pattern: '/*.tmp',
      globOptions: { nocase: true }
    })
    expect(asar.listPackage(insensitiveDestination).map(posix).sort()).toEqual(['/a.tmp', '/keep.TMP'])
  })

  it('ASAR does not restore ignored files or directory children through nonull', async () => {
    const asar = require('@electron/asar')
    const root = fixture({ 'source/secret.txt': 'excluded bytes', 'source/ignored/existing.txt': 'excluded child' })
    const destination = join(root, 'ignored.asar')
    await asar.createPackageWithOptions(join(root, 'source'), destination, {
      pattern: '/secret.txt',
      globOptions: { nonull: true, ignore: '**/secret.txt' }
    })
    expect(asar.listPackage(destination)).toEqual([])
    for (const child of ['existing.txt', 'missing.txt']) {
      const childDestination = join(root, `ignored-${child}.asar`)
      await asar.createPackageWithOptions(join(root, 'source'), childDestination, {
        pattern: `/ignored/${child}`,
        globOptions: { nonull: true, ignore: '**/ignored/**' }
      })
      expect(asar.listPackage(childDestination)).toEqual([])
    }
  })

  it('ASAR expands native brace patterns before applying nonull', async () => {
    const asar = require('@electron/asar')
    const root = fixture({ 'source/a.txt': 'a', 'source/b.txt': 'b', 'source/keep.txt': 'keep' })
    const destination = join(root, 'braces.asar')
    await asar.createPackageWithOptions(join(root, 'source'), destination, {
      pattern: join('/', '{b,a}.txt'),
      globOptions: { nonull: true }
    })
    expect(asar.listPackage(destination).map(posix)).toEqual(['/a.txt', '/b.txt'])
    expect(asar.extractFile(destination, 'a.txt').toString()).toBe('a')
    expect(asar.extractFile(destination, 'b.txt').toString()).toBe('b')
  })

  for (const [name, context] of [
    ['devtools', from(require, 'electron-devtools-installer')],
    ['Windows installer temp files', from(from(builder, 'electron-winstaller'), 'temp')]
  ] as const) {
    it(`${name}: asynchronous cleanup removes only matching files and completes on no match`, async () => {
      const rimraf = context('rimraf')
      const root = fixture({ 'nested/a.tmp': 'a', 'nested/b.tmp': 'b', 'nested/keep.txt': 'keep' })
      const remove = (pattern: string) =>
        new Promise<void>((resolve, reject) => {
          rimraf(pattern, (error: Error | null) => (error ? reject(error) : resolve()))
        })
      await remove(join(root, 'nested', '*.tmp'))
      await remove(join(root, 'missing', '*.tmp'))
      expect(existsSync(join(root, 'nested/a.tmp'))).toBe(false)
      expect(existsSync(join(root, 'nested/b.tmp'))).toBe(false)
      expect(readFileSync(join(root, 'nested/keep.txt'), 'utf8')).toBe('keep')
    })

    it(`${name}: synchronous cleanup respects literal paths and disabled globbing`, () => {
      const rimraf = context('rimraf')
      const root = fixture({ 'nested/a.tmp': 'a', 'nested/keep.txt': 'keep', '[literal]/keep.txt': 'literal' })
      rimraf.sync(join(root, 'nested', '*.tmp'))
      rimraf.sync(join(root, '[literal]'), { disableGlob: true })
      expect(existsSync(join(root, 'nested/a.tmp'))).toBe(false)
      expect(existsSync(join(root, '[literal]'))).toBe(false)
      expect(readFileSync(join(root, 'nested/keep.txt'), 'utf8')).toBe('keep')
    })

    for (const mode of ['async', 'sync'] as const) {
      const remove = (pattern: string, options: { glob?: { nocase: boolean } } = {}) => {
        const rimraf = context('rimraf')
        if (mode === 'sync') {
          rimraf.sync(pattern, options)
          return Promise.resolve()
        }
        return new Promise<void>((resolve, reject) => {
          rimraf(pattern, options, (error: Error | null) => (error ? reject(error) : resolve()))
        })
      }

      it(`${name}: ${mode} cleanup keeps case-sensitive defaults and honors explicit nocase`, async () => {
        const root = fixture({ 'nested/a.tmp': 'a', 'nested/keep.TMP': 'uppercase', 'nested/keep.txt': 'keep' })
        await remove(join(root, 'nested', '*.tmp'))
        expect(existsSync(join(root, 'nested/a.tmp'))).toBe(false)
        expect(existsSync(join(root, 'nested/keep.TMP'))).toBe(true)

        await remove(join(root, 'nested', '*.tmp'), { glob: { nocase: true } })
        expect(existsSync(join(root, 'nested/keep.TMP'))).toBe(false)
        expect(readFileSync(join(root, 'nested/keep.txt'), 'utf8')).toBe('keep')
      })

      it(`${name}: ${mode} cleanup expands brace-only patterns without deleting other files`, async () => {
        const root = fixture({ 'nested/a.tmp': 'a', 'nested/b.tmp': 'b', 'nested/keep.tmp': 'keep' })
        await remove(join(root, 'nested', '{a,b}.tmp'))
        expect(existsSync(join(root, 'nested/a.tmp'))).toBe(false)
        expect(existsSync(join(root, 'nested/b.tmp'))).toBe(false)
        expect(readFileSync(join(root, 'nested/keep.tmp'), 'utf8')).toBe('keep')
      })
    }
  }

  for (const [name, context] of [
    ['archiver', archiver],
    ['zip-stream', from(archiver, 'zip-stream')]
  ] as const) {
    it(`${name}: expansion retains ordering, exclusions, native separators and destination mapping`, () => {
      const { file } = context('archiver-utils')
      const root = fixture({
        'source/z.txt': 'z',
        'source/a.txt': 'a',
        'source/.hidden.txt': 'dot',
        'source/skip.txt': 'skip'
      })
      const options = { cwd: root, dot: true, filter: 'isFile' }
      expect(file.expand(options, [join('source', '*.txt'), '!source/skip.txt']).map(posix)).toEqual([
        'source/.hidden.txt',
        'source/a.txt',
        'source/z.txt'
      ])
      expect(file.expandMapping(['source/a.txt'], 'output', { cwd: root, flatten: true, ext: '.md' })).toEqual([
        { src: [posix(join(root, 'source/a.txt'))], dest: 'output/a.md' }
      ])
      expect(file.expand({ cwd: root }, 'missing/*.txt')).toEqual([])
      expect(file.expand({ cwd: root, nonull: true }, 'missing/*.txt')).toEqual(['missing/*.txt'])
      expect(file.expand({ cwd: root, nonull: true }, 'missing/{b,a}.txt')).toEqual(['missing/a.txt', 'missing/b.txt'])
    })

    it(`${name}: expansion keeps case-sensitive defaults and honors explicit nocase`, () => {
      const { file } = context('archiver-utils')
      const root = fixture({ 'source/a.tmp': 'a', 'source/keep.TMP': 'uppercase', 'source/keep.txt': 'keep' })
      expect(file.expand({ cwd: root }, join('source', '*.tmp'))).toEqual(['source/a.tmp'])
      expect(file.expand({ cwd: root, nocase: true }, join('source', '*.tmp'))).toEqual([
        'source/a.tmp',
        'source/keep.TMP'
      ])
    })

    it(`${name}: nonull does not restore ignored files or directory children`, () => {
      const { file } = context('archiver-utils')
      const root = fixture({ 'source/secret.txt': 'excluded bytes', 'source/ignored/existing.txt': 'excluded child' })
      expect(file.expand({ cwd: root, nonull: true, ignore: '**/secret.txt' }, 'source/secret.txt')).toEqual([])
      for (const child of ['existing.txt', 'missing.txt']) {
        expect(
          file.expand({ cwd: root, nonull: true, ignore: 'source/ignored/**' }, `source/ignored/${child}`)
        ).toEqual([])
      }
    })

    it(`${name}: nonull retains normalized alternatives for native brace patterns`, () => {
      const { file } = context('archiver-utils')
      const root = fixture({})
      expect(file.expand({ cwd: root, nonull: true }, join('missing', '{b,a}.txt'))).toEqual([
        'missing/a.txt',
        'missing/b.txt'
      ])
    })
  }

  it('directory comparison retains include, exclude, dotfiles and async/sync agreement', async () => {
    const compare = from(builder, '@electron/universal')('dir-compare')
    const root = fixture({
      'left/nested/a.txt': 'same',
      'right/nested/a.txt': 'same',
      'left/nested/.hidden.txt': 'left',
      'right/nested/.hidden.txt': 'right',
      'left/nested/ignored.txt': 'left',
      'right/nested/ignored.txt': 'right',
      'left/a.js': 'left',
      'right/a.js': 'right'
    })
    const options = { compareContent: true, includeFilter: join('**', 'nested', '*.txt'), excludeFilter: 'ignored.txt' }
    for (const result of [
      compare.compareSync(join(root, 'left'), join(root, 'right'), options),
      await compare.compare(join(root, 'left'), join(root, 'right'), options)
    ]) {
      expect(result.same).toBe(false)
      expect(result.distinct).toBe(1)
      expect(
        result.diffSet
          .filter((item: { state: string }) => item.state === 'distinct')
          .map((item: { name1: string }) => item.name1)
      ).toEqual(['.hidden.txt'])
    }
  })

  for (const [name, context] of [
    ['archive reader', archiver],
    ['app builder', builder]
  ] as const) {
    it(`${name}: readdir glob honors ignore and skipped subtrees`, async () => {
      const readdirGlob = context('readdir-glob')
      const root = fixture({
        'src/a.ts': 'a',
        'src/.hidden.ts': 'dot',
        'src/ignored.ts': 'ignored',
        'skip/b.ts': 'skip'
      })
      const matches = await new Promise<string[]>((resolve, reject) => {
        readdirGlob(
          root,
          { pattern: '**/*.ts', dot: true, nodir: true, ignore: '**/ignored.ts', skip: 'skip' },
          (error: Error | null, files: string[]) => (error ? reject(error) : resolve(files))
        )
      })
      expect(matches.sort()).toEqual(['src/.hidden.ts', 'src/a.ts'])
    })
  }

  it('file lists retain explicit paths, glob options and no-match behavior', () => {
    const { FileList } = from(from(builder, 'ejs'), 'jake')('filelist')
    const root = fixture({ 'a.txt': 'a', 'b.md': 'b', '.hidden.txt': 'dot' })
    const list = new FileList()
    list.include(posix(join(root, '*.{txt,md}')), { dot: true, windowsPathsNoEscape: true })
    expect(list.toArray().map(posix).sort()).toEqual(
      [posix(join(root, '.hidden.txt')), posix(join(root, 'a.txt')), posix(join(root, 'b.md'))].sort()
    )
    const missing = new FileList()
    missing.include(posix(join(root, '*.js')), { windowsPathsNoEscape: true })
    expect(missing.toArray()).toEqual([])
  })

  it('app-builder keeps ancestors, literal directories, exclusions and dotfiles in its packaged file selection', () => {
    const { FileMatcher } = builder('./fileMatcher.js')
    const root = fixture({
      'src/deep/app.js': '',
      'src/deep/skip.js': '',
      'src/.hidden.js': '',
      'assets/icon.svg': '',
      'node_modules/dependency/index.js': ''
    })
    const matcher = new FileMatcher(root, join(root, 'output'), (value: string) => value, [
      'src/**/*.js',
      '!**/skip.js',
      'assets'
    ])
    const filter = matcher.createFilter()
    for (const path of ['src', 'src/deep', 'src/deep/app.js', 'src/.hidden.js', 'assets', 'assets/icon.svg']) {
      expect(filter(join(root, path), statSync(join(root, path))), path).toBe(true)
    }
    expect(filter(join(root, 'src/deep/skip.js'), statSync(join(root, 'src/deep/skip.js')))).toBe(false)
    expect(filter(join(root, 'node_modules'), statSync(join(root, 'node_modules')))).toBe(false)
  })

  it('modern promise and synchronous glob consumers retain absolute results and ignored subtrees', async () => {
    const context = from(require, 'i18next-cli')
    const { glob, globSync } = context('glob')
    const root = fixture({ 'src/a.ts': '', 'src/nested/b.tsx': '', 'src/skip/hidden.ts': '', 'src/data.json': '' })
    const options = { cwd: root, absolute: true, nodir: true, ignore: ['**/skip/**'] }
    const expected = [posix(join(root, 'src/a.ts')), posix(join(root, 'src/nested/b.tsx'))]
    expect((await glob('**/*.{ts,tsx}', options)).map(posix).sort()).toEqual(expected)
    expect(globSync('**/*.{ts,tsx}', options).map(posix).sort()).toEqual(expected)
  })
})

describe('application pattern consumers', () => {
  it('Pi model patterns retain provider scoping, case insensitivity and no-match diagnostics', async () => {
    const entry = import.meta.resolve('@earendil-works/pi-coding-agent')
    const { resolveModelScopeFromModels } = await import(new URL('./core/model-resolver.js', entry).href)
    const models = [
      { provider: 'alpha', id: 'coder-fast', name: 'Coder Fast' },
      { provider: 'alpha', id: 'coder-pro', name: 'Coder Pro' },
      { provider: 'beta', id: 'coder-fast', name: 'Beta Coder' }
    ]
    const result = resolveModelScopeFromModels(['ALPHA/CODER-*', 'missing-*'], models)
    expect(
      result.scopedModels.map(
        (item: { model: { provider: string; id: string } }) => `${item.model.provider}/${item.model.id}`
      )
    ).toEqual(['alpha/coder-fast', 'alpha/coder-pro'])
    expect(result.diagnostics.map((item: { code: string }) => item.code)).toEqual(['no-match'])
  })

  it('WebDAV directory filtering retains basename matches and excludes dotfiles by default', async () => {
    const { createClient } = await import('webdav')
    const names = ['a.txt', 'b.md', '.hidden.txt']
    const xml = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${names
      .map(
        (name) =>
          `<d:response><d:href>/docs/${name}</d:href><d:propstat><d:prop><d:displayname>${name}</d:displayname><d:resourcetype/><d:getcontentlength>1</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
      )
      .join('')}</d:multistatus>`
    const server = createServer((_request, response) => {
      response.writeHead(207, { 'Content-Type': 'application/xml' })
      response.end(xml)
    })
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing loopback address')
      const client = createClient(`http://127.0.0.1:${address.port}`)
      const files = await client.getDirectoryContents('/docs', { glob: '*.txt' })
      expect(files).toEqual([expect.objectContaining({ filename: '/docs/a.txt', basename: 'a.txt' })])
      expect(await client.getDirectoryContents('/docs', { glob: '*.missing' })).toEqual([])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })
})

describe('lint configuration and import boundaries', () => {
  for (const mode of ['require', 'import'] as const) {
    it(`${mode}: legacy override files and exclusions retain matching semantics`, async () => {
      const legacy =
        mode === 'require'
          ? eslint('@eslint/eslintrc')
          : await import(pathToFileURL(join(dirname(eslint.resolve('@eslint/eslintrc')), '../lib/index.js')).href)
      const root = fixture({})
      const configs = new legacy.Legacy.ConfigArrayFactory().create(
        {
          overrides: [
            { files: [join('src', '**', '*.js')], excludedFiles: ['**/skip.js'], settings: { selected: true } },
            { files: ['./*.js'], settings: { top: true } }
          ]
        },
        { cwd: root, basePath: root }
      )
      expect(configs.extractConfig(join(root, 'src/.hidden.js')).settings).toEqual({ selected: true })
      expect(configs.extractConfig(join(root, 'src/skip.js')).settings).toEqual({})
      expect(configs.extractConfig(join(root, 'top.js')).settings).toEqual({ top: true })
      expect(configs.extractConfig(join(root, 'nested/top.js')).settings).toEqual({})
    })

    it(`${mode}: import boundaries enforce allowed and forbidden internal modules`, async () => {
      const imported = mode === 'require' ? require('eslint-plugin-import-x') : await import('eslint-plugin-import-x')
      const plugin = imported.default ?? imported
      const root = fixture({ 'index.js': '', 'feature/public.js': '', 'feature/private.js': '' })
      const linter = new Linter({ cwd: root })
      const lint = (module: string, options: { allow?: string[]; forbid?: string[] }) =>
        linter.verify(
          `import value from ${JSON.stringify(module)};`,
          [{ plugins: { boundary: plugin }, rules: { 'boundary/no-internal-modules': ['error', options] } }],
          { filename: join(root, 'index.js') }
        )
      expect(lint('./feature/public.js', { allow: ['**/public.js'] })).toEqual([])
      expect(lint('./feature/private.js', { allow: ['**/public.js'] }).map((item) => item.messageId)).toEqual([
        'noAllowed'
      ])
      expect(lint('./feature/private.js', { forbid: ['**/private.js'] }).map((item) => item.messageId)).toEqual([
        'noAllowed'
      ])
      expect(lint('./feature/public.js', { forbid: ['**/private.js', '', '#comment'] })).toEqual([])
      expect(lint('./feature/public.js', { allow: [posix(join(root, 'feature/public.js'))] })).toEqual([])
    })

    it(`${mode}: flat config keeps dotfiles, global ignores and negated file patterns`, async () => {
      const configArrayRoot = resolve(dirname(eslint.resolve('@eslint/config-array')), '../..')
      const packageJson = JSON.parse(readFileSync(join(configArrayRoot, 'package.json'), 'utf8')) as {
        exports: { import: { default: string } }
      }
      const { ConfigArray } =
        mode === 'require'
          ? eslint('@eslint/config-array')
          : await import(pathToFileURL(resolve(configArrayRoot, packageJson.exports.import.default)).href)
      const root = fixture({})
      const configs = new ConfigArray([{ ignores: ['ignored/**'] }, { files: [['**/*.js', '!**/skip.js']] }], {
        basePath: root
      })
      configs.normalizeSync()
      expect(configs.getConfig(join(root, '.hidden.js'))).toEqual({})
      expect(configs.getConfig(join(root, 'nested/a.js'))).toEqual({})
      expect(configs.getConfig(join(root, 'nested/skip.js'))).toBeUndefined()
      expect(configs.getConfig(join(root, 'ignored/a.js'))).toBeUndefined()
    })
  }

  it('legacy ESLint enumerates native absolute globs without losing nested files', () => {
    const { FileEnumerator } = eslint('./cli-engine/file-enumerator.js')
    const root = fixture({ 'src/a.js': '', 'src/nested/b.js': '', 'src/data.txt': '' })
    const configArrayFactory = new (eslint('@eslint/eslintrc').Legacy.CascadingConfigArrayFactory)({
      cwd: root,
      useEslintrc: false,
      baseConfig: { env: { es6: true } }
    })
    const enumerator = new FileEnumerator({ cwd: root, configArrayFactory })
    const files = [...enumerator.iterateFiles([join(root, 'src', '**', '*.js')])]
      .map((item) => posix(item.filePath))
      .sort()
    expect(files).toEqual([posix(join(root, 'src/a.js')), posix(join(root, 'src/nested/b.js'))])
  })
})
