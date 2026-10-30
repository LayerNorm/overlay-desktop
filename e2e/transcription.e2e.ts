import { _electron as electron, expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DesktopBridge } from '../packages/overlay-desktop-bridge/src/index'

test('a pinned local model transcribes synthetic speech through the native bridge', async () => {
  test.setTimeout(15 * 60_000)
  const directory = mkdtempSync(join(tmpdir(), 'overlay-asr-smoke-'))
  const audio = join(directory, 'speech.wav')
  const offlineHook = join(directory, 'offline.cjs')
  // Deny networking only to the actual ASR helper, after the model download.
  // The app still needs the trusted HTTP fixture to exercise its real preload.
  writeFileSync(
    offlineHook,
    `const cp=require('node:child_process');const original=cp.execFile;globalThis.offlineTranscriptions=0;cp.execFile=function(file,args,options,callback){if(file.endsWith('/whisperkit-cli')){globalThis.offlineTranscriptions++;return original('/usr/bin/sandbox-exec',['-p','(version 1)(allow default)(deny network*)',file,...args],options,callback)}return original(file,args,options,callback)}`
  )
  execFileSync('/usr/bin/say', [
    '-o',
    join(directory, 'speech.aiff'),
    'The desktop application keeps all of my work together.'
  ])
  execFileSync('/usr/bin/afconvert', [
    '-f',
    'WAVE',
    '-d',
    'LEI16@16000',
    '-c',
    '1',
    join(directory, 'speech.aiff'),
    audio
  ])
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<h1>Local dictation smoke</h1>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({
      args: ['-r', offlineHook, '.', `--user-data-dir=${join(directory, 'profile')}`],
      env: { ...process.env, APP_SERVER_URL: origin }
    })
    await expect
      .poll(() => app!.windows().some((page) => page.url().startsWith(origin)), { timeout: 30_000 })
      .toBe(true)
    const page = app.windows().find((page) => page.url().startsWith(origin))!
    await page.evaluate(async () => {
      const bridge = (window as unknown as { overlayDesktop: DesktopBridge }).overlayDesktop
      await bridge.call('transcription.downloadModel', { id: 'openai_whisper-base' })
    })
    const models = await page.evaluate(() =>
      (window as unknown as { overlayDesktop: DesktopBridge }).overlayDesktop.call(
        'transcription.listModels',
        undefined
      )
    )
    expect(models.find((model) => model.id === 'openai_whisper-base')?.downloaded).toBe(true)
    const result = await page.evaluate(
      async (bytes) =>
        (window as unknown as { overlayDesktop: DesktopBridge }).overlayDesktop.call(
          'transcription.transcribe',
          { audio: Uint8Array.from(bytes), mime: 'audio/wav', model: 'openai_whisper-base' }
        ),
      [...readFileSync(audio)]
    )
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { offlineTranscriptions: number }).offlineTranscriptions
      )
    ).toBe(1)
    expect(result.text.toLowerCase()).toContain('desktop')
    expect(result.text.toLowerCase()).toContain('work together')
  } finally {
    await app?.close().catch(() => {})
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
