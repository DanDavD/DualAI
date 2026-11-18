import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import {
  ElectronBridgeApi,
  IPC_CHANNELS,
  ScreenSourceInfo,
  CaptureBounds,
  TranscriptPayload
} from '../types/ipc'
import { AudioLevelMetric } from '../types/audio'

const electronBridgeApi: ElectronBridgeApi = {
  // Window Controls
  minimizeWindow: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE)
  },
  maximizeWindow: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE)
  },
  closeWindow: (): void => {
    ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE)
  },
  isWindowMaximized: async (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED)
  },

  // Hardware & Loopback Sources
  getDesktopSources: async (): Promise<ScreenSourceInfo[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_GET_SOURCES)
  },
  captureScreenRegion: async (bounds: CaptureBounds): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.AUDIO_CAPTURE_LOOPBACK, bounds)
  },

  // HUD Controls
  openHud: async (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.HUD_OPEN)
  },
  closeHud: async (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.HUD_CLOSE)
  },
  setHudOpacity: async (opacity: number): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.HUD_SET_OPACITY, opacity)
  },
  setHudClickThrough: async (enabled: boolean): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.HUD_SET_CLICK_THROUGH, enabled)
  },
  sendHudTranscript: (payload: TranscriptPayload): void => {
    ipcRenderer.send(IPC_CHANNELS.HUD_UPDATE_TRANSCRIPT, payload)
  },

  // Event Listeners (Main -> Renderer)
  onShortcutMute: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.SHORTCUT_MUTE_TOGGLE, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SHORTCUT_MUTE_TOGGLE, handler)
    }
  },
  onShortcutSwapLanguages: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.SHORTCUT_SWAP_LANGUAGES, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SHORTCUT_SWAP_LANGUAGES, handler)
    }
  },
  onShortcutToggleHud: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.SHORTCUT_TOGGLE_HUD, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SHORTCUT_TOGGLE_HUD, handler)
    }
  },
  onShortcutTriggerSnip: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.SHORTCUT_TRIGGER_SNIP, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SHORTCUT_TRIGGER_SNIP, handler)
    }
  },
  onSystemAudioMetrics: (callback: (metric: AudioLevelMetric) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, metric: AudioLevelMetric): void => callback(metric)
    ipcRenderer.on(IPC_CHANNELS.AUDIO_CAPTURE_LOOPBACK, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.AUDIO_CAPTURE_LOOPBACK, handler)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', electronBridgeApi)
  } catch (error) {
    console.error('[DUALAI] ContextBridge exposure failed:', error)
  }
} else {
  // @ts-ignore (fallback environment)
  window.electronAPI = electronBridgeApi
}
