import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { chromium, _electron as electron } from 'playwright'

// Native dialog automation is confined to the disposable macOS runner.
assert.equal(process.env.CI, 'true', 'Signed acceptance runs in CI only')
assert.equal(process.platform, 'darwin')
const bundle = resolve('dist/mac-arm64/Overlay.app')
const executable = join(bundle, 'Contents/MacOS/Overlay')
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
const directory = await mkdtemp(join(tmpdir(), 'overlay-signed-acceptance-'))
const evidence = resolve('test-results/signed-acceptance')
await mkdir(evidence, { recursive: true })
const result = { sourceSha: process.env.RELEASE_SOURCE_SHA, profiles: [] }
let origin
const server = createServer((request, response) => {
  if (request.url === '/api/auth/session') {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ authenticated: true }))
    return
  }
  if (request.url === '/login')
    response.setHeader('Set-Cookie', 'signed-qa=retained; HttpOnly; SameSite=Lax; Path=/')
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><title>Signed Overlay acceptance</title><h1>Signed shell</h1><iframe src="about:blank"></iframe><textarea aria-label="Scratch composer"></textarea>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
origin = `http://127.0.0.1:${server.address().port}`
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function poll(read, label, timeout = 40_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read().catch(() => undefined)
    if (value) return value
    await delay(200)
  }
  throw new Error(`Timed out: ${label}`)
}
async function seedLegacy(profile) {
  const fixture = join(directory, 'legacy.cjs')
  const oldPage = join(bundle, 'Contents/Resources/app.asar/out/renderer/index.html')
  await writeFile(fixture, `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({webPreferences:{sandbox:true}});w.loadFile(${JSON.stringify(oldPage)})})`)
  const legacy = await electron.launch({ args: [fixture, `--user-data-dir=${profile}`] })
  try {
    const page = await legacy.firstWindow()
    await page.waitForLoadState('load')
    await page.evaluate(() => {
      localStorage.setItem('transcriptions', JSON.stringify([{ id: 'signed-upgrade', text: 'Retain this transcript' }]))
      localStorage.setItem('overlay-settings', JSON.stringify({ selectedModelId: 'parakeet_v2', apiKey: 'excluded-secret-fixture' }))
    })
  } finally { await legacy.close() }
  await writeFile(join(profile, 'settings.json'), '{}')
  await mkdir(join(profile, 'recordings'), { recursive: true })
  await writeFile(join(profile, 'recordings/old.wav'), 'retained recording fixture')
  await writeFile(join(profile, 'knowledge-journal.json'), 'retained journal fixture')
}
async function launch(profile, upgrade = false) {
  await rm(join(profile, 'DevToolsActivePort'), { force: true })
  const child = spawn(executable, [`--user-data-dir=${profile}`, '--remote-debugging-port=0'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, APP_SERVER_URL: origin },
    stdio: 'ignore',
  })
  child.on('error', () => {})
  const port = await poll(async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0], 'signed Chromium endpoint')
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  if (upgrade) {
    await poll(async () => {
      try {
        execFileSync('/usr/bin/osascript', ['-e', 'tell application "System Events" to tell process "Overlay" to click button "Continue" of window 1'], { stdio: 'ignore', timeout: 3000 })
      } catch { /* Wait for the real upgrade notice. */ }
      return browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith(origin))
    }, 'signed upgrade notice and main window')
  }
  const page = await poll(async () => browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith(origin)), 'signed main window')
  await page.waitForLoadState('domcontentloaded')
  return { child, browser, page }
}
async function close(launched) {
  const exited = once(launched.child, 'exit')
  await launched.browser.close()
  await Promise.race([exited, delay(10_000).then(() => { throw new Error('Signed app did not quit') })])
}
try {
  for (const kind of ['clean', 'upgrade']) {
    const profile = join(directory, kind)
    await mkdir(profile)
    if (kind === 'upgrade') await seedLegacy(profile)
    let launched
    try {
      launched = await launch(profile, kind === 'upgrade')
      const { page, browser } = launched
      const identity = await page.evaluate(async () => ({
        handshake: await window.overlayDesktop.handshake(), node: typeof window.require,
      }))
      assert.equal(identity.handshake.bridgeVersion, 1)
      assert.equal(identity.handshake.surface, 'main')
      assert.equal(identity.node, 'undefined')
      const frame = page.frames().find(frame => frame !== page.mainFrame())
      assert.equal(await frame.evaluate(() => 'overlayDesktop' in window), false)
      assert.equal(await page.evaluate(async () => {
        try { await window.overlayDesktop.call('window.openExternal', { url: 'file:///etc/passwd' }); return false }
        catch { return true }
      }), true)
      await page.goto(origin + '/login')
      await page.goto(origin + '/app/work')
      for (const kind of ['chat', 'notes'])
        await page.evaluate(kind => window.overlayDesktop.call('panels.show', { kind }), kind)
      await poll(async () => browser.contexts().flatMap(context => context.pages()).filter(page => page.url().includes('surface=panel')).length === 2, 'both signed panels')
      await page.screenshot({ path: join(evidence, `${kind}.png`) })
      await page.evaluate(() => window.overlayDesktop.call('auth.signedOut', undefined))
      await poll(async () => !browser.contexts().flatMap(context => context.pages()).some(page => page.url().includes('surface=panel')), 'signed sign-out closes panels')
      assert.equal((await page.evaluate(() => window.overlayDesktop.call('transcription.status'))).recording, false)
      if (kind === 'upgrade') {
        const exported = join(profile, 'legacy-desktop-export/transcripts-and-settings.json')
        assert.deepEqual(JSON.parse(await readFile(exported, 'utf8')), {
          transcriptions: [{ id: 'signed-upgrade', text: 'Retain this transcript' }],
          settings: { selectedModelId: 'parakeet_v2' },
        })
        assert.equal((await stat(exported)).mode & 0o077, 0)
        assert.equal(await readFile(join(profile, 'recordings/old.wav'), 'utf8'), 'retained recording fixture')
        assert.equal(await readFile(join(profile, 'knowledge-journal.json'), 'utf8'), 'retained journal fixture')
      }
      await page.evaluate(() => window.overlayDesktop.call('panels.show', { kind: 'chat' }))
      await close(launched)
      launched = await launch(profile)
      assert.ok((await launched.browser.contexts()[0].cookies(origin)).some(cookie => cookie.name === 'signed-qa' && cookie.value === 'retained'))
      result.profiles.push({ kind, sandbox: true, panels: true, signOut: true, restart: true, migration: kind === 'upgrade' })
    } finally {
      if (launched && launched.child.exitCode === null) {
        await launched.browser.close().catch(() => {})
        if (launched.child.exitCode === null) launched.child.kill('SIGKILL')
      }
    }
  }
  await writeFile(join(evidence, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
