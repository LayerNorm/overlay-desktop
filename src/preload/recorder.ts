import { contextBridge, ipcRenderer } from 'electron'
if (process.isMainFrame && location.protocol === 'file:')
  contextBridge.exposeInMainWorld('recorder', {
    onStart: (callback: (model: string) => void) => {
      ipcRenderer.on('recorder:start', (_event, model) => callback(model))
    },
    onStop: (callback: () => void) => {
      ipcRenderer.on('recorder:stop', callback)
    },
    onCancel: (callback: () => void) => {
      ipcRenderer.on('recorder:cancel', callback)
    },
    transcribe: (input: unknown) => ipcRenderer.invoke('recorder:transcribe', input),
    cancel: () => ipcRenderer.send('recorder:cancel')
  })
