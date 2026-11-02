import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

import { build, type Plugin } from 'vite'

const VIRTUAL_ID = 'virtual:plantuml-sandbox-url'
const DEV_PATH = '/__plantuml-sandbox.html'

export function plantumlSandboxPlugin(): Plugin {
  let development = false
  let bundle: Promise<string> | undefined
  const getBundle = () =>
    (bundle ??= build({
      configFile: false,
      publicDir: false,
      define: { 'import.meta.url': 'document.baseURI' },
      logLevel: 'warn',
      build: {
        license: { fileName: 'plantuml-licenses.txt' },
        rolldownOptions: { output: { comments: { legal: true } } },
        write: false,
        lib: {
          entry: resolve('src/renderer/components/Preview/plantumlSandbox.ts'),
          name: 'CherryPlantumlSandbox',
          formats: ['iife'],
          fileName: 'plantuml-sandbox'
        },
        minify: true
      }
    }).then((result) => {
      if ('on' in result) throw new Error('Unexpected PlantUML watch build')
      const outputs = Array.isArray(result) ? result : [result]
      const files = outputs.flatMap((output) => output.output)
      const chunks = files.filter((output) => output.type === 'chunk')
      if (chunks.length !== 1) throw new Error('PlantUML sandbox must be a single self-contained script')
      const license = files.find((output) => output.type === 'asset' && output.fileName === 'plantuml-licenses.txt')
      if (!license || license.type !== 'asset') throw new Error('PlantUML bundle license notice is missing')
      const notices = Buffer.from(license.source)
        .toString('utf8')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
      const code = chunks[0].code.replace(/<\/script/gi, '<\\/script')
      const hash = createHash('sha256').update(code).digest('base64')
      return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"></head><body><template id="third-party-notices">${notices}</template><script>${code}</script></body></html>`
    }))

  return {
    name: 'cherry-plantuml-sandbox',
    configResolved(config) {
      development = config.command === 'serve'
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? `\0${VIRTUAL_ID}` : undefined
    },
    async load(id) {
      if (id !== `\0${VIRTUAL_ID}`) return
      if (development) return `export default ${JSON.stringify(DEV_PATH)}`
      const reference = this.emitFile({ type: 'asset', name: 'plantuml-sandbox.html', source: await getBundle() })
      return `export default import.meta.ROLLUP_FILE_URL_${reference}`
    },
    configureServer(server) {
      server.middlewares.use(DEV_PATH, (_request, response, next) => {
        void getBundle()
          .then((code) => {
            response.setHeader('Content-Type', 'text/html; charset=utf-8')
            response.setHeader('Cache-Control', 'no-store')
            response.end(code)
          })
          .catch(next)
      })
    }
  }
}
