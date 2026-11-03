import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { SherpaTts } from '../utilityEntries/SherpaTts'

let directory: string
const originalEspeakDataPath = process.env.ESPEAK_DATA_PATH

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  if (originalEspeakDataPath === undefined) delete process.env.ESPEAK_DATA_PATH
  else process.env.ESPEAK_DATA_PATH = originalEspeakDataPath
})

it('generates a WAV through the sandbox-compatible Sherpa contract with both lexicons', async () => {
  directory = await mkdtemp(join(tmpdir(), 'kokoro-runtime-'))
  const packageDir = join(directory, 'node_modules', 'sherpa-onnx-node')
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    join(packageDir, 'index.js'),
    `
    const fs = require('node:fs');
    module.exports = {
      OfflineTts: { createAsync: async config => {
        if (config.model.vits) return { generate: request => {
          if (request.sid !== 0 || request.enableExternalBuffer !== false) throw Error('Invalid German voice request');
          return { samples: new Float32Array([0, 0.5]), sampleRate: 22050 };
        }};
        const lexicon = config.model.kokoro.lexicon;
        if (!lexicon.includes('lexicon-zh.txt') || !lexicon.includes('lexicon-us-en.txt') || config.model.kokoro.lang)
          throw Error('Mixed language frontend unavailable');
        if (process.env.ESPEAK_DATA_PATH !== config.model.kokoro.dataDir)
          throw Error('eSpeak data path is not available to the native runtime');
        return { generate: request => {
          if (request.enableExternalBuffer !== false) throw Error('External buffers are not allowed');
          if (request.text !== '你好 Hello') throw Error('Mixed text was changed');
          return { samples: new Float32Array([0, 0.5]), sampleRate: 24000 };
        }};
      }},
      writeWave: (filename, audio) => {
        const wav = Buffer.alloc(44 + audio.samples.length * 2);
        wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
        wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22); wav.writeUInt32LE(audio.sampleRate, 24);
        wav.writeUInt32LE(audio.sampleRate * 2, 28); wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
        fs.writeFileSync(filename, wav);
      }
    };
  `
  )
  const outputPath = join(directory, 'speech.wav')
  const runtime = new SherpaTts(directory)
  await runtime.synthesize(
    {
      architecture: 'kokoro',
      modelDir: directory,
      text: '你好 Hello',
      voice: '3',
      language: 'zh-CN',
      speed: 1,
      outputPath
    },
    new AbortController().signal
  )
  expect(process.env.ESPEAK_DATA_PATH).toBe(join(directory, 'espeak-ng-data'))
  const audio = await readFile(outputPath)
  expect(audio.toString('ascii', 0, 4)).toBe('RIFF')
  expect(audio.readUInt32LE(24)).toBe(24000)
  expect(audio.readUInt32LE(4) + 8).toBe(audio.length)
  expect(audio.readUInt32LE(40)).toBeGreaterThan(0)
  await runtime.synthesize(
    {
      architecture: 'vits',
      modelDir: join(directory, 'css10'),
      text: 'Grüße aus Köln',
      voice: '0',
      language: 'de-DE',
      speed: 1,
      outputPath
    },
    new AbortController().signal
  )
  expect((await readFile(outputPath)).readUInt32LE(24)).toBe(22050)
})
