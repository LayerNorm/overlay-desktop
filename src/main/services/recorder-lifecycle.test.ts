import { afterEach, expect, it, vi } from 'vitest'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
function microphone() {
  const track = { stop: vi.fn(), onended: null }
  return { getTracks: () => [track], track }
}
async function harness() {
  vi.resetModules()
  const pending: ReturnType<typeof deferred<ReturnType<typeof microphone>>>[] = []
  const connected: unknown[] = []
  const deviceEvents = new EventTarget()
  const enumerateDevices = vi.fn<
    () => Promise<{ kind: string; deviceId: string; label: string }[]>
  >(async () => [])
  const getUserMedia = vi.fn((_constraints: unknown) => {
    const next = deferred<ReturnType<typeof microphone>>()
    pending.push(next)
    return next.promise
  })
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  vi.stubGlobal('navigator', {
    mediaDevices: {
      enumerateDevices,
      addEventListener: deviceEvents.addEventListener.bind(deviceEvents),
      getUserMedia
    }
  })
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'suspended'
      audioWorklet = { addModule: async () => {} }
      destination = {}
      suspend = async () => {
        this.state = 'suspended'
      }
      resume = async () => {
        this.state = 'running'
      }
      close = async () => {}
      createMediaStreamSource = (stream: unknown) => {
        connected.push(stream)
        return node()
      }
      createAnalyser = () => node()
      createConstantSource = () => ({
        ...node(),
        offset: { value: 0 },
        start: () => {},
        stop: () => {}
      })
    }
  )
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port: {
        onmessage: ((event: { data: Float32Array }) => void) | null
        close(): void
        postMessage(): void
      } = { onmessage: null, close: () => {}, postMessage: () => {} }
      constructor() {
        queueMicrotask(() => this.port.onmessage?.({ data: new Float32Array(256) }))
      }
      connect = () => {}
      disconnect = () => {}
    }
  )
  const { captureAudio, prepareAudio, prepareMicrophone } =
    await import('../../native/dictation-audio.js')
  const start = () => captureAudio({ onReady: vi.fn(), onFallback: vi.fn(), onError: vi.fn() })
  return {
    start,
    pending,
    connected,
    prepareAudio,
    prepareMicrophone,
    enumerateDevices,
    getUserMedia,
    deviceEvents
  }
}
afterEach(() => vi.unstubAllGlobals())
it('cancellation before permission resolves releases the late microphone without connecting it', async () => {
  const h = await harness(),
    mic = microphone()
  const take = h.start()
  await vi.waitFor(() => expect(h.pending).toHaveLength(1))
  take.cancel()
  h.pending[0].resolve(mic)
  await expect(take.ready).rejects.toThrow()
  expect(mic.track.stop).toHaveBeenCalled()
  expect(h.connected).toHaveLength(0)
})
it('a late old microphone cannot replace or disconnect a newer take', async () => {
  const h = await harness(),
    old = microphone(),
    next = microphone()
  const first = h.start()
  await vi.waitFor(() => expect(h.pending).toHaveLength(1))
  first.cancel()
  const second = h.start()
  await vi.waitFor(() => expect(h.pending).toHaveLength(2))
  h.pending[1].resolve(next)
  await second.ready
  h.pending[0].resolve(old)
  await expect(first.ready).rejects.toThrow()
  expect(h.connected).toEqual([next])
  expect(old.track.stop).toHaveBeenCalled()
  expect(next.track.stop).not.toHaveBeenCalled()
  second.cancel()
  expect(next.track.stop).toHaveBeenCalled()
})

it('prepares and suspends the processor without acquiring a microphone', async () => {
  const h = await harness()
  h.prepareMicrophone()
  const context = await h.prepareAudio()
  expect(context.state).toBe('suspended')
  expect(h.pending).toHaveLength(0)
  expect(h.connected).toHaveLength(0)
})

it('opens the default microphone without awaiting a pending initial device scan', async () => {
  const h = await harness()
  h.enumerateDevices.mockReturnValue(new Promise(() => {}))
  const take = h.start()
  expect(h.pending).toHaveLength(1)
  expect(h.getUserMedia).toHaveBeenCalledWith({ audio: { channelCount: 1, sampleRate: 16000 } })
  h.pending[0].resolve(microphone())
  await take.ready
  take.cancel()
})

it('uses the cached built-in microphone while a refresh is pending', async () => {
  const h = await harness()
  h.enumerateDevices.mockResolvedValue([
    { kind: 'audioinput', deviceId: 'built-in', label: 'MacBook Pro Microphone' }
  ])
  h.prepareMicrophone()
  await Promise.resolve()
  h.enumerateDevices.mockReturnValue(new Promise(() => {}))
  h.deviceEvents.dispatchEvent(new Event('devicechange'))
  const take = h.start()
  expect(h.getUserMedia).toHaveBeenCalledWith({
    audio: { channelCount: 1, sampleRate: 16000, deviceId: { exact: 'built-in' } }
  })
  h.pending[0].resolve(microphone())
  await take.ready
  take.cancel()
})

it('keeps the newest device change when an older scan finishes late', async () => {
  const h = await harness()
  const old = deferred<Awaited<ReturnType<typeof h.enumerateDevices>>>()
  h.enumerateDevices.mockReturnValueOnce(old.promise)
  h.prepareMicrophone()
  h.enumerateDevices.mockResolvedValue([
    { kind: 'audioinput', deviceId: 'new-built-in', label: 'Built-in Microphone' }
  ])
  h.deviceEvents.dispatchEvent(new Event('devicechange'))
  await Promise.resolve()
  old.resolve([{ kind: 'audioinput', deviceId: 'old-built-in', label: 'Built-in Microphone' }])
  await Promise.resolve()
  const take = h.start()
  expect(h.getUserMedia).toHaveBeenCalledWith({
    audio: { channelCount: 1, sampleRate: 16000, deviceId: { exact: 'new-built-in' } }
  })
  h.pending[0].resolve(microphone())
  await take.ready
  take.cancel()
})

it('forgets a cached microphone that fails while device discovery is unavailable', async () => {
  const h = await harness()
  h.enumerateDevices.mockResolvedValue([
    { kind: 'audioinput', deviceId: 'removed', label: 'Built-in Microphone' }
  ])
  h.prepareMicrophone()
  await Promise.resolve()
  h.enumerateDevices.mockReturnValue(new Promise(() => {}))
  h.getUserMedia.mockRejectedValueOnce(
    Object.assign(new Error('Removed'), { name: 'NotFoundError' })
  )
  const first = h.start()
  await vi.waitFor(() => expect(h.pending).toHaveLength(1))
  h.pending[0].resolve(microphone())
  await first.ready
  first.cancel()
  const second = h.start()
  expect(h.getUserMedia).toHaveBeenLastCalledWith({ audio: { channelCount: 1, sampleRate: 16000 } })
  h.pending[1].resolve(microphone())
  await second.ready
  second.cancel()
})
